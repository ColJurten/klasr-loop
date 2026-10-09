from pathlib import Path
import re
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Enum, create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from core.settings import Settings
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


def test_postgres_adoption_adds_llm_updated_at_default_and_save(monkeypatch):
    source = Settings().database_url
    if not source.startswith("postgresql"):
        pytest.skip("PostgreSQL is not configured")
    database = "klasr_test_" + uuid.uuid4().hex
    url = make_url(source)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database}"'))
    except OperationalError:
        admin.dispose()
        pytest.skip("PostgreSQL is unavailable")

    engine = None
    try:
        scratch_url = url.set(database=database).render_as_string(hide_password=False)
        monkeypatch.setenv("KLASR_DATABASE_URL", scratch_url)
        from alembic import command
        from alembic.config import Config

        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        config.set_main_option("script_location", str(Path(__file__).parents[1] / "alembic"))
        command.upgrade(config, "20260913_0002")
        engine = create_engine(scratch_url)
        with engine.begin() as connection:
            connection.execute(
                text('ALTER TABLE "LlmSetting" ALTER COLUMN "updatedAt" DROP DEFAULT')
            )
        assert (
            next(
                column
                for column in inspect(engine).get_columns("LlmSetting")
                if column["name"] == "updatedAt"
            )["default"]
            is None
        )

        command.upgrade(config, "head")
        updated_at = next(
            column
            for column in inspect(engine).get_columns("LlmSetting")
            if column["name"] == "updatedAt"
        )
        assert updated_at["nullable"] is False and updated_at["default"] == "now()"

        settings = Settings(
            KLASR_DATABASE_URL=scratch_url,
            INTERNAL_API_SECRET="test-internal",
            TOKEN_ENCRYPTION_KEY="ab" * 32,
            NODE_ENV="test",
        )
        app = create_app(settings)
        app.state.engine = engine

        class Providers:
            async def endpoint(self, _config):
                return "https://api.openai.com/v1"

            async def validate(self, _config):
                pass

        app.state.providers = Providers()
        with TestClient(app, headers={"x-internal-secret": "test-internal"}) as client:
            identity = client.post(
                "/auth/register",
                json=dict(
                    email="owner@example.com",
                    password="correct horse battery",
                    displayName="Owner",
                ),
            ).json()
            client.headers["x-user-id"] = identity["userId"]
            response = client.put(
                f'/organizations/{identity["organizationId"]}/llm-settings',
                json=dict(provider="openai", apiKey="synthetic", model="model"),
            )
            assert response.status_code == 200, response.text
            assert response.json()["configured"] is True
        engine = None  # TestClient lifespan disposed it.

        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{database}" WITH (FORCE)'))
            connection.execute(text(f'CREATE DATABASE "{database}"'))
        command.upgrade(config, "head")
        engine = create_engine(scratch_url)
        assert (
            next(
                column
                for column in inspect(engine).get_columns("LlmSetting")
                if column["name"] == "updatedAt"
            )["default"]
            == "now()"
        )
        engine.dispose()
        engine = None
        command.downgrade(config, "20260913_0002")
        engine = create_engine(scratch_url)
        assert (
            next(
                column
                for column in inspect(engine).get_columns("LlmSetting")
                if column["name"] == "updatedAt"
            )["default"]
            is None
        )
    finally:
        if engine:
            engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{database}" WITH (FORCE)'))
        admin.dispose()


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
