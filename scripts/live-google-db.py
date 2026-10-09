"""Private database probes for the live Google runner."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api-py/src"))

from core.settings import Settings  # noqa: E402
from core.security import password_matches  # noqa: E402
from db.models import (  # noqa: E402
    ActionHistory,
    ClassificationProposal,
    ClassificationRule,
    Document,
    DriveConnection,
    Folder,
    Job,
    LlmSetting,
    Membership,
    Notification,
    Organization,
    RuleCondition,
    UsageMetric,
    User,
)
from db.session import make_engine  # noqa: E402


def utc_iso(value):
    aware = value.replace(tzinfo=timezone.utc)
    return aware.isoformat().replace("+00:00", "Z")


def tenant(session):
    return session.execute(
        select(Organization.id, DriveConnection.last_sync_at)
        .join(Membership, Membership.organization_id == Organization.id)
        .join(User, User.id == Membership.user_id)
        .join(DriveConnection, DriveConnection.user_id == User.id)
        .where(User.email == "google-staging-acceptance@klasr.test")
    ).first()


def clear(session, organization_id):
    rule_ids = select(ClassificationRule.id).where(
        ClassificationRule.organization_id == organization_id
    )
    for model in (
        ActionHistory,
        ClassificationProposal,
        Job,
        Document,
        RuleCondition,
        ClassificationRule,
        Folder,
        Notification,
        UsageMetric,
        LlmSetting,
    ):
        condition = (
            model.rule_id.in_(rule_ids)
            if model is RuleCondition
            else model.organization_id == organization_id
        )
        session.execute(delete(model).where(condition))
    session.execute(
        update(Organization)
        .where(Organization.id == organization_id)
        .values(reference_root_external_id=None, reference_root_name=None)
    )
    session.commit()


def user_state(session, email, password=""):
    users = session.scalars(
        select(User).where(User.email == email.strip().lower())
    ).all()
    memberships = (
        session.scalars(
            select(Membership).where(
                Membership.user_id.in_([user.id for user in users])
            )
        ).all()
        if users
        else []
    )
    organization_ids = {membership.organization_id for membership in memberships}
    password_hash = users[0].password_hash if users else None
    return {
        "users": len(users),
        "organizations": len(organization_ids),
        "ownerMemberships": sum(
            membership.role == "ADMIN" for membership in memberships
        ),
        "identityRecords": len(users),
        "duplicateIdentityRecords": max(0, len(users) - 1),
        "passwordPresent": bool(password_hash),
        "bcryptFormat": bool(password_hash and password_hash.startswith("$2b$12$")),
        "passwordValid": bool(
            password_hash and password_matches(password, password_hash)
        ),
    }


def cleanup_user(session, email):
    users = session.scalars(
        select(User).where(User.email == email.strip().lower())
    ).all()
    memberships = (
        session.scalars(
            select(Membership).where(
                Membership.user_id.in_([user.id for user in users])
            )
        ).all()
        if users
        else []
    )
    organization_ids = {membership.organization_id for membership in memberships}
    for organization_id in organization_ids:
        clear(session, organization_id)
    user_ids = [user.id for user in users]
    if user_ids:
        session.execute(
            delete(DriveConnection).where(DriveConnection.user_id.in_(user_ids))
        )
        session.execute(delete(Membership).where(Membership.user_id.in_(user_ids)))
    if organization_ids:
        session.execute(
            delete(Organization).where(Organization.id.in_(organization_ids))
        )
    if user_ids:
        session.execute(delete(User).where(User.id.in_(user_ids)))
    session.commit()
    return len(
        session.scalars(select(User).where(User.email == email.strip().lower())).all()
    )


def main():
    command = sys.argv[1]
    engine = make_engine(Settings().database_url)
    with Session(engine) as session:
        if command in ("e2e-user", "e2e-cleanup"):
            payload = json.load(sys.stdin)
            result = (
                user_state(session, payload["email"], payload.get("password", ""))
                if command == "e2e-user"
                else cleanup_user(session, payload["email"])
            )
            print(json.dumps(result, separators=(",", ":")))
            return
        row = tenant(session)
        if command == "tenant":
            result = (
                {
                    "organizationId": row.id,
                    "lastSyncAt": (
                        utc_iso(row.last_sync_at)
                        if row.last_sync_at
                        else None  # noqa: E501
                    ),
                }
                if row
                else None
            )
        else:
            organization_id = sys.argv[2]
            if command in ("reset", "cleanup"):
                clear(session, organization_id)
                result = True
            elif command == "connection":
                connection = session.scalar(
                    select(DriveConnection).where(
                        DriveConnection.organization_id == organization_id
                    )
                )
                result = {
                    "present": bool(connection),
                    "lastSyncAt": (
                        utc_iso(connection.last_sync_at)
                        if connection and connection.last_sync_at
                        else None
                    ),
                }
            elif command == "proposal":
                external_id = sys.argv[3]
                proposal = (
                    session.execute(
                        select(ClassificationProposal)
                        .join(
                            Document,
                            Document.id == ClassificationProposal.document_id,
                        )
                        .where(
                            ClassificationProposal.organization_id
                            == organization_id,  # noqa: E501
                            Document.external_id == external_id,
                        )
                        .order_by(ClassificationProposal.created_at.desc())
                    )
                    .scalars()
                    .first()
                )
                result = (
                    {
                        "destinationPath": proposal.destination_path,
                        "modelUsed": proposal.model_used,
                        "rationale": proposal.rationale,
                        "reviewRequired": proposal.review_required,
                        "reviewReason": proposal.review_reason,
                    }
                    if proposal
                    else None
                )
            elif command == "count":
                model = {
                    "rules": ClassificationRule,
                    "settings": LlmSetting,
                    "documents": Document,
                }[sys.argv[3]]
                statement = select(model).where(
                    model.organization_id == organization_id
                )
                if len(sys.argv) > 4:
                    statement = statement.where(
                        Document.status.in_(sys.argv[4].split(","))
                    )
                result = len(session.scalars(statement).all())
            elif command == "failed":
                started_at = datetime.fromisoformat(  # noqa: E501
                    sys.argv[3].replace("Z", "+00:00")
                )
                started_at = started_at.astimezone(timezone.utc)
                started_at = started_at.replace(tzinfo=None)
                result = bool(
                    session.scalar(
                        select(Job.id)
                        .where(
                            Job.organization_id == organization_id,
                            Job.status == "failed",
                            Job.created_at >= started_at,
                        )
                        .limit(1)
                    )
                )
            else:
                raise ValueError("unknown command")
    engine.dispose()
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
