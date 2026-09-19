import core.py314_compat  # noqa: F401 — PEP 649 shim for pydantic.v1 on 3.14
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from core.settings import Settings
from db.models import Base
from db.session import make_engine
from main import create_app


@pytest.fixture
def api(tmp_path):
    settings = Settings(
        database_url=f'sqlite:///{tmp_path / "integration.db"}',
        local_mvp=True,
        INTERNAL_API_SECRET="test-internal",
        TOKEN_ENCRYPTION_KEY="ab" * 32,
        NODE_ENV="test",
    )
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    app = create_app(settings)
    app.state.engine = engine
    with TestClient(app, headers={"x-internal-secret": "test-internal"}) as client:
        yield client, app, engine


def register(client, email="owner@example.com"):
    response = client.post(
        "/auth/register",
        json=dict(email=email, password="correct horse battery", displayName="Owner"),
    )
    assert response.status_code == 201, response.text
    identity = response.json()
    client.headers["x-user-id"] = identity["userId"]
    return identity


@pytest.fixture
def tenant(api):
    client, app, engine = api
    identity = register(client)
    return client, app, engine, identity, "/organizations/" + identity["organizationId"]


@pytest.fixture
def session(api):
    with Session(api[2], expire_on_commit=False) as session:
        yield session
