from pathlib import Path
import re

from fastapi.testclient import TestClient
from sqlalchemy import Enum, create_engine, inspect

from db.models import Base, LlmSetting
from main import create_app


def test_health_contract():
    client = TestClient(create_app())
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    assert client.get("/missing").json() == {"error": {"status": 404, "message": "Not Found"}}


def test_models_match_migration_on_fresh_sqlite(tmp_path, monkeypatch):
    database = tmp_path / "fresh.db"
    monkeypatch.setenv("KLASR_DATABASE_URL", f"sqlite:///{database}")
    from alembic import command
    from alembic.config import Config

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "alembic"))
    command.upgrade(config, "head")
    tables = set(inspect(create_engine(f"sqlite:///{database}")).get_table_names())
    assert tables == set(Base.metadata.tables) | {"alembic_version"}
    assert len(tables - {"jobs", "alembic_version"}) == 14


def test_initial_revision_adopts_existing_tables(tmp_path, monkeypatch):
    database = tmp_path / "existing.db"
    engine = create_engine(f"sqlite:///{database}")
    Base.metadata.create_all(engine, tables=[Base.metadata.tables["Organization"]])
    monkeypatch.setenv("KLASR_DATABASE_URL", f"sqlite:///{database}")
    from alembic import command
    from alembic.config import Config

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "alembic"))
    command.upgrade(config, "head")
    assert set(inspect(engine).get_table_names()) == set(Base.metadata.tables) | {"alembic_version"}


def test_prisma_schema_contract():
    prisma = (Path(__file__).parent / "fixtures/schema.prisma").read_text()
    enum_blocks = re.findall(r"enum (\w+) \{(.*?)\n\}", prisma, re.DOTALL)
    expected_enums = {
        name: [line.split()[0] for line in body.splitlines() if line.strip()]
        for name, body in enum_blocks
    }
    actual_enums = {
        column.type.name: column.type.enums
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, Enum) and table.name != "jobs"
    }
    assert actual_enums == expected_enums
    model_blocks = re.findall(r"model (\w+) \{(.*?)\n\}", prisma, re.DOTALL)
    scalar_types = {"String", "DateTime", "Boolean", "Int", "Float", "Json"} | set(expected_enums)
    expected_columns = {
        name: {
            parts[0]
            for line in body.splitlines()
            if len(parts := line.strip().split()) >= 2 and parts[1].rstrip("?[]") in scalar_types
        }
        for name, body in model_blocks
    }
    assert {
        name: set(table.columns.keys())
        for name, table in Base.metadata.tables.items()
        if name != "jobs"
    } == expected_columns
    expected_indexes = {
        f"{name}_{'_'.join(field.strip() for field in fields.split(','))}_idx"
        for name, body in model_blocks
        for fields in re.findall(r"@@index\(\[([^]]+)]\)", body)
    }
    assert {
        index.name
        for table in Base.metadata.tables.values()
        for index in table.indexes
        if not index.unique and table.name != "jobs"
    } == expected_indexes
    expected_foreign_keys = set()
    for model, body in model_blocks:
        field_types = {
            parts[0]: parts[1]
            for line in body.splitlines()
            if len(parts := line.strip().split()) >= 2
        }
        for target, field, reference, action in re.findall(
            r'(\w+)\??\s+@relation\((?:"[^"]+", )?fields: \[(\w+)], references: \[(\w+)]'
            r"(?:, onDelete: (\w+))?\)",
            body,
        ):
            action = action or ("SetNull" if field_types[field].endswith("?") else "Restrict")
            expected_foreign_keys.add(
                (model, field, target, reference, action.replace("SetNull", "SET NULL").upper())
            )
    actual_foreign_keys = {
        (table.name, column.name, key.column.table.name, key.column.name, key.ondelete)
        for table in Base.metadata.tables.values()
        if table.name != "jobs"
        for column in table.columns
        for key in column.foreign_keys
    }
    assert actual_foreign_keys == expected_foreign_keys
    updated_at = LlmSetting.__table__.c.updatedAt
    assert updated_at.server_default is not None and updated_at.onupdate is not None
