"""Private database probes for the live Google runner."""

import json
import sys
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api-py/src"))

from core.settings import Settings  # noqa: E402
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


def main():
    command = sys.argv[1]
    engine = make_engine(Settings().database_url)
    with Session(engine) as session:
        row = tenant(session)
        if command == "tenant":
            result = (
                {
                    "organizationId": row.id,
                    "lastSyncAt": (
                        row.last_sync_at.isoformat()
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
                        connection.last_sync_at.isoformat()
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
                        "modelUsed": proposal.model_used,
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
                result = bool(
                    session.scalar(
                        select(Job.id)
                        .where(
                            Job.organization_id == organization_id,
                            Job.status == "failed",
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
