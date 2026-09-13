from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

from db.models import Base
from main import create_app


def test_health_contract():
    client = TestClient(create_app())
    assert client.get("/health").json() == {"status": "ok"}
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
    """Phase 3 cutover: the NestJS Prisma schema (apps/api/prisma/schema.prisma)
    was deleted along with apps/api/. The Python SQLAlchemy models in db/models.py
    are now the single source of truth; there is no Prisma schema to compare against.
    The contract parity was verified in Phases 1-2 before cutover."""
    import pytest

    pytest.skip(
        "NestJS Prisma schema deleted in Phase 3 cutover "
        "— SQLAlchemy models are single source of truth"
    )
