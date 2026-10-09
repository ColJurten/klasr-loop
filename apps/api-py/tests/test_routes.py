import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from conftest import register
from core.security import password_matches, TokenEncryptionService
from db.models import (
    User,
    Membership,
    Organization,
    DriveConnection,
    Document,
    ClassificationProposal,
    ActionHistory,
    Folder,
    Job,
)
from jobs.service import JobsService


def test_auth_register_credentials_and_validation(api):
    client, _, engine = api
    identity = register(client)
    assert set(identity) == {"userId", "organizationId", "membershipId", "role"}
    assert identity["role"] == "ADMIN"
    with Session(engine) as session:
        user = session.get(User, identity["userId"])
        assert user.password_hash.startswith("$2b$12$") and password_matches(
            "correct horse battery", user.password_hash
        )
        assert user.name == "Owner"
    credentials = dict(email="OWNER@example.com", password="correct horse battery")
    assert client.post("/auth/credentials", json=credentials).json() == identity
    for change in ({"password": "incorrect password"}, {"email": "missing@example.com"}):
        response = client.post("/auth/credentials", json={**credentials, **change})
        assert response.status_code == 201 and response.json() is None
    response = client.post("/auth/register", json={**credentials, "displayName": "Other"})
    assert response.status_code == 409 and response.json()["message"] == "email_registered"
    for change in (
        {"email": "invalid"},
        {"password": "short"},
        {"password": "x" * 129},
        {"displayName": ""},
        {"displayName": "x" * 121},
        {"extra": True},
    ):
        response = client.post(
            "/auth/register",
            json=dict(
                email="new@example.com", password="correct horse battery", displayName="Owner"
            )
            | change,
        )
        assert response.status_code == 400, response.text
        assert "correct horse" not in response.text


def test_onboarding_connection_and_local_password(api):
    client, app, engine = api
    dto = dict(
        email="oauth@example.com",
        displayName="OAuth",
        provider="google",
        emailVerified=True,
        providerAccountId="synthetic-account",
        refreshToken="synthetic-refresh",
        scopes=["drive"],
    )
    response = client.post("/auth/onboarding", json=dto)
    assert response.status_code == 201, response.text
    identity = response.json()
    assert (
        client.post(
            "/auth/onboarding", json={k: v for k, v in dto.items() if k != "refreshToken"}
        ).json()
        == identity
    )
    with Session(engine) as session:
        connection = session.scalar(select(DriveConnection))
        assert connection.encrypted_token.startswith("v1.")
        assert (
            TokenEncryptionService(app.state.settings.token_encryption_key).decrypt(
                connection.encrypted_token
            )
            == "synthetic-refresh"
        )
        assert connection.scopes == ["drive"]
    assert client.get("/auth/local-password").status_code == 401
    headers = {
        "x-user-id": identity["userId"],
        "x-organization-id": identity["organizationId"],
        "x-membership-id": identity["membershipId"],
    }
    assert client.get("/auth/local-password", headers=headers).json() == {"eligible": True}
    assert client.get(
        "/auth/local-password", headers={**headers, "x-membership-id": "foreign"}
    ).json() == {"eligible": False}
    response = client.post(
        "/auth/local-password", headers=headers, json={"password": "correct horse battery"}
    )
    assert response.status_code == 201 and response.json() == {"enrolled": True}
    assert client.get("/auth/local-password", headers=headers).json() == {"eligible": False}
    assert (
        client.post(
            "/auth/local-password", headers=headers, json={"password": "correct horse battery"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/auth/credentials", json={"email": dto["email"], "password": "correct horse battery"}
        ).json()
        == identity
    )
    assert client.post("/auth/onboarding", json=dto).status_code == 500


def test_onboarding_failures_and_acceptance_ineligible(api):
    client, _, engine = api
    dto = dict(email="unverified@example.com", provider="google")
    assert client.post("/auth/onboarding", json=dto).status_code == 500
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0
    dto.update(emailVerified=True, providerAccountId="account")
    assert (
        client.post("/auth/onboarding", json=dto).json()["message"]
        == "Missing Google refresh token"
    )
    dto.update(providerAccountId="acceptance", refreshToken="synthetic")
    identity = client.post("/auth/onboarding", json=dto).json()
    headers = {
        "x-user-id": identity["userId"],
        "x-organization-id": identity["organizationId"],
        "x-membership-id": identity["membershipId"],
    }
    assert client.get("/auth/local-password", headers=headers).json() == {"eligible": False}


def test_organizations_serialization_and_atomic_owner(api):
    client, _, engine = api
    response = client.post(
        "/organizations", json={"name": "Cabinet", "ownerEmail": "ORG@example.com"}
    )
    assert response.status_code == 201
    row = response.json()
    assert set(row) == {"id", "name", "createdAt", "referenceRootExternalId", "referenceRootName"}
    assert row["createdAt"].endswith("Z") and row["referenceRootName"] is None
    assert client.get("/organizations/" + row["id"]).json() == row
    assert client.get("/organizations/absent").status_code == 404
    assert client.get("/organizations/absent").json()["message"] == "Organization not found"
    assert (
        client.post(
            "/organizations", json={"name": "Again", "ownerEmail": "org@example.com"}
        ).status_code
        == 500
    )
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Organization)) == 1
        assert session.scalar(select(User)).email == "org@example.com"
        assert session.scalar(select(Membership)).role == "ADMIN"


def test_google_drive_all_routes_sync_and_document_queries(tenant):
    client, _, engine, identity, base = tenant
    choices = client.get(base + "/drive/reference-folders").json()
    assert len(choices) == 8 and set(choices[0]) == {"externalId", "name", "parentExternalId"}
    root_page = client.get(base + "/drive/items").json()
    assert len(root_page["items"]) == 2 and all(row["eligible"] for row in root_page["items"])
    assert root_page["nextPageToken"] is None
    files = client.get(base + "/drive/items?parentId=inbox").json()["items"]
    assert all(
        not row["eligible"] and row["reason"] == "reference-required"
        for row in files
        if row["type"] == "file"
    )
    assert (
        client.post(base + "/drive/reference-root", json={"folderExternalId": "absent"}).status_code
        == 404
    )
    response = client.post(
        base + "/drive/reference-root", json={"folderExternalId": "reference-root"}
    )
    assert response.status_code == 201
    assert len(response.json()["folders"]) == 5
    assert response.json()["folders"][0] == dict(
        externalId="accounting",
        name="Comptabilité",
        path="/Comptabilité",
        parentExternalId=None,
    )
    inputs = client.get(base + "/drive/input-items").json()
    assert len(inputs) == 11 and all("reason" not in row for row in inputs)
    root_page = client.get(base + "/drive/items?parentId=root&pageToken=0").json()
    root = next(row for row in root_page["items"] if row["externalId"] == "reference-root")
    assert root["reason"] == "reference-root" and root["eligible"] is False
    assert client.get(base + "/drive/items?pageToken=").status_code == 400
    assert client.get(base + "/drive/items?unknown=1").status_code == 400
    assert (
        client.post(base + "/drive/launch", json={"itemExternalId": "reference-root"}).status_code
        == 400
    )
    assert client.post(base + "/drive/launch", json={"itemExternalId": "absent"}).status_code == 404
    response = client.post(base + "/drive/launch", json={"itemExternalId": "inbox"})
    assert response.status_code == 201 and response.json() == {"enqueued": 4, "manual": 0}
    with Session(engine) as session:
        jobs = session.scalars(select(Job)).all()
        assert len(jobs) == 4
        assert all(
            job.payload
            == dict(
                organizationId=identity["organizationId"],
                userId=identity["userId"],
                documentId=job.document_id,
            )
            for job in jobs
        )
    documents = client.get(base + "/documents?status=PENDING").json()
    assert len(documents) == 4
    doc = documents[0]
    assert "mimeType" in doc and "sizeBytes" in doc and doc["folderId"] is None
    assert client.get(base + "/documents/" + doc["id"]).json() == doc
    assert client.get(base + "/documents/absent").json()["message"] == "Document not found"
    assert client.get("/api/v1" + base + "/documents").json() == documents


def test_dashboard_aggregate_and_tenant_isolation(tenant):
    client, app, engine, identity, base = tenant
    client.post(base + "/drive/reference-root", json={"folderExternalId": "reference-root"})
    client.post(base + "/drive/launch", json={"itemExternalId": "inbox"})
    second = register(client, "second@example.com")
    other = "/organizations/" + second["organizationId"]
    assert client.get(other + "/documents").json() == []
    first_doc = client.get(base + "/documents").json()[0]["id"]
    assert client.get(other + "/documents/" + first_doc).status_code == 404
    dashboard = client.get(base + "/dashboard").json()
    assert set(dashboard) == {
        "mode",
        "connection",
        "metrics",
        "queue",
        "analysisFailures",
        "referenceRoot",
        "folders",
        "inputItems",
        "proposals",
        "history",
    }
    assert dashboard["mode"] == "production" and dashboard["queue"]["ready"] == 4
    assert dashboard["metrics"] == dict(
        pending=0,
        analyzing=4,
        classified=0,
        outcomes=0,
        documentsIn=4,
        ruleMatches=0,
        llmCalls=0,
        ocrRuns=0,
    )
    other_dashboard = client.get(other + "/dashboard").json()
    assert other_dashboard["queue"]["ready"] == 0 and other_dashboard["folders"] == []
    assert client.get(other + "/proposals").json() == []
    with Session(engine) as session:
        jobs = JobsService(session)
        row = jobs.enqueue(
            dict(organizationId=second["organizationId"], documentId="synthetic-failed")
        )
        row.status = "failed"
        session.commit()
    assert client.get(base + "/dashboard").json()["analysisFailures"] == 0
    assert client.get(other + "/dashboard").json()["analysisFailures"] == 1
    assert client.get(base + "/dashboard").json()["inputItems"] == []
    assert client.get(base + "/dashboard").json()["mode"] == "production"
    app.state.settings.acceptance_google_service_account = True
    assert client.get(base + "/dashboard").json()["mode"] == "service-account-staging"


def add_proposal(engine, org, suffix="1"):
    with Session(engine) as session:
        folder = Folder(
            organization_id=org,
            external_id="destination-" + suffix,
            path="/Invoices" + suffix,
            name="Invoices",
            inherited=True,
        )
        document = Document(
            organization_id=org,
            external_id="file-" + suffix,
            name="scan.pdf",
            mime_type="application/pdf",
            size_bytes=5,
            status="PROPOSED",
        )
        session.add_all([folder, document])
        session.flush()
        proposal = ClassificationProposal(
            organization_id=org,
            document_id=document.id,
            proposed_name="invoice.pdf",
            destination_path=folder.path,
            destination_folder_external_id=folder.external_id,
            confidence=0.9,
            source="LLM",
            llm_calls_used=3,
        )
        session.add(proposal)
        session.commit()
        return proposal.id, document.id, folder.external_id


def test_proposal_confirm_ignore_claims_and_audit(tenant):
    client, app, engine, identity, base = tenant
    proposal_id, doc_id, folder_id = add_proposal(engine, identity["organizationId"])
    assert client.get(base + "/proposals").json()[0]["document"]["id"] == doc_id
    path = base + "/proposals/" + proposal_id
    assert client.post(path + "/confirm", json={"finalName": "../unsafe.pdf"}).status_code == 400
    assert (
        client.post(path + "/confirm", json={"destinationFolderExternalId": "foreign"}).status_code
        == 400
    )
    assert not any(request.method == "PATCH" for request in app.state.google_requests)
    response = client.post(path + "/confirm", json={"finalName": "corrected.pdf"})
    assert response.status_code == 201 and response.json() == {
        "executed": True,
        "destinationPath": "/Invoices1",
    }
    assert client.post(path + "/confirm", json={}).status_code == 409
    assert client.post(path + "/ignore").status_code == 409
    with Session(engine) as session:
        proposal = session.get(ClassificationProposal, proposal_id)
        assert proposal.status == "OVERRIDDEN" and proposal.final_name == "corrected.pdf"
        assert session.get(Document, doc_id).status == "CLASSIFIED"
        history = session.scalar(select(ActionHistory))
        assert history.actor_id == identity["userId"] and history.action == "MOVE_RENAME"
        assert history.to_path == "/Invoices1" and history.from_name == "scan.pdf"
    ignored_id, ignored_doc, _ = add_proposal(engine, identity["organizationId"], "2")
    count = len([request for request in app.state.google_requests if request.method == "PATCH"])
    assert client.post(base + "/proposals/" + ignored_id + "/ignore").json() == {"ignored": True}
    assert (
        len([request for request in app.state.google_requests if request.method == "PATCH"])
        == count
    )
    with Session(engine) as session:
        assert session.get(Document, ignored_doc).status == "IGNORED"
        row = session.scalar(select(ActionHistory).where(ActionHistory.document_id == ignored_doc))
        assert row.action == "IGNORED" and row.to_path is None and row.actor_id is None
    dashboard = client.get(base + "/dashboard").json()
    assert len(dashboard["history"]) == 2 and dashboard["metrics"]["classified"] == 1


def test_failed_drive_restores_claim_and_cross_tenant_denied(tenant):
    client, app, engine, identity, base = tenant
    proposal_id, _, _ = add_proposal(engine, identity["organizationId"])

    class BrokenDrive:
        async def move_and_rename(self, command):
            raise RuntimeError("synthetic provider failure")

    app.state.drive = BrokenDrive()
    assert client.post(base + "/proposals/" + proposal_id + "/confirm", json={}).status_code == 500
    with Session(engine) as session:
        assert session.get(ClassificationProposal, proposal_id).status == "PENDING"
        assert session.scalar(select(func.count()).select_from(ActionHistory)) == 0
    second = register(client, "other@example.com")
    other = "/organizations/" + second["organizationId"]
    assert client.post(other + "/proposals/" + proposal_id + "/confirm", json={}).status_code == 409
    assert client.post(other + "/proposals/" + proposal_id + "/ignore").status_code == 409
    assert len(client.get(base + "/proposals").json()) == 1


def test_rules_validation_priority_and_scoping(tenant):
    client, _, _, _, base = tenant
    dto = dict(
        priority=1,
        destinationPath="/Invoices",
        suggestedNameTemplate="invoice.pdf",
        conditions=[dict(field="CONTENT", operator="CONTAINS", value="invoice")],
    )
    response = client.post(base + "/rules", json=dto)
    assert response.status_code == 201
    rule = response.json()
    assert rule["enabled"] is True and rule["conditions"][0]["ruleId"] == rule["id"]
    assert client.get(base + "/rules").json() == [rule]
    conflict = client.post(base + "/rules", json=dto)
    assert (
        conflict.status_code == 409
        and conflict.json()["message"]
        == "A rule already exists at priority 1 for this organization"
    )
    for change in (
        {"priority": 0},
        {"priority": 1.5},
        {"priority": True},
        {"destinationPath": "relative"},
        {"conditions": []},
        {"conditions": [{"field": "BAD", "operator": "EQUALS", "value": "x"}]},
        {"conditions": [{"field": "FILENAME", "operator": "MATCH", "value": "x"}]},
    ):
        assert client.post(base + "/rules", json=dto | change).status_code == 400
    second = register(client, "rule-other@example.com")
    other = "/organizations/" + second["organizationId"]
    assert client.get(other + "/rules").json() == []
    assert client.post(other + "/rules", json=dto).status_code == 201


@pytest.mark.parametrize("flag", ["inline_worker", "acceptance_google_service_account"])
def test_production_mode_forbids_development_switches(flag):
    from main import create_app
    from core.settings import Settings

    with pytest.raises(ValueError, match="cannot run in production"):
        create_app(Settings(NODE_ENV="production", **{flag: True}))
