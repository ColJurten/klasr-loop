import pytest
import httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from core.settings import Settings
from db.models import Base
from db.session import make_engine
from main import create_app
from core.security import TokenEncryptionService
from repositories.drive_connections import DriveConnectionsRepository

GOOGLE_ITEMS = [
    dict(
        id="reference-root",
        name="Cabinet",
        mimeType="application/vnd.google-apps.folder",
        parents=[],
    ),
    dict(
        id="accounting",
        name="Comptabilité",
        mimeType="application/vnd.google-apps.folder",
        parents=["reference-root"],
    ),
    dict(
        id="electricity",
        name="Électricité",
        mimeType="application/vnd.google-apps.folder",
        parents=["accounting"],
    ),
    dict(
        id="bank",
        name="Banque",
        mimeType="application/vnd.google-apps.folder",
        parents=["accounting"],
    ),
    dict(
        id="social",
        name="Social",
        mimeType="application/vnd.google-apps.folder",
        parents=["reference-root"],
    ),
    dict(
        id="payroll", name="Paie", mimeType="application/vnd.google-apps.folder", parents=["social"]
    ),
    dict(id="inbox", name="À classer", mimeType="application/vnd.google-apps.folder", parents=[]),
    dict(
        id="nested-inbox",
        name="Sous-lot",
        mimeType="application/vnd.google-apps.folder",
        parents=["inbox"],
    ),
    dict(
        id="invoice", name="facture.pdf", mimeType="application/pdf", size="128", parents=["inbox"]
    ),
    dict(
        id="statement", name="releve.pdf", mimeType="application/pdf", size="128", parents=["inbox"]
    ),
    dict(
        id="pay-slip", name="paie.png", mimeType="image/png", size="128", parents=["nested-inbox"]
    ),
    dict(
        id="contract", name="contrat.pdf", mimeType="application/pdf", size="128", parents=["inbox"]
    ),
]


@pytest.fixture
def api(tmp_path):
    settings = Settings(
        database_url=f'sqlite:///{tmp_path / "integration.db"}',
        INTERNAL_API_SECRET="test-internal",
        TOKEN_ENCRYPTION_KEY="ab" * 32,
        NODE_ENV="test",
    )
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    app = create_app(settings)
    app.state.engine = engine
    app.state.google_requests = []

    def google(request):
        app.state.google_requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "mock-access"})
        if request.method == "PATCH":
            return httpx.Response(200, json={"id": request.url.path.rsplit("/", 1)[-1]})
        if request.url.params.get("fields") == "parents":
            return httpx.Response(200, json={"parents": ["inbox"]})
        query = request.url.params.get("q", "")
        items = GOOGLE_ITEMS
        if " in parents" in query:
            parent = query.split("'", 2)[1].replace("\\'", "'")
            items = [
                item
                for item in items
                if (
                    not item.get("parents")
                    if parent == "root"
                    else parent in item.get("parents", [])
                )
            ]
        return httpx.Response(200, json={"files": items})

    app.state.http_transport = httpx.MockTransport(google)
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
    with Session(engine) as session:
        token = TokenEncryptionService(app.state.settings.token_encryption_key).encrypt(
            "mock-refresh"
        )
        DriveConnectionsRepository(session).upsert(
            identity["organizationId"], identity["userId"], "mock-google-account", token, ["drive"]
        )
        session.commit()
    return client, app, engine, identity, "/organizations/" + identity["organizationId"]


@pytest.fixture
def session(api):
    with Session(api[2], expire_on_commit=False) as session:
        yield session
