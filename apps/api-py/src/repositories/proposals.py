from datetime import datetime, timezone
from sqlalchemy import select, update
from db.models import ClassificationProposal as Proposal, Document, ActionHistory
from repositories.serialization import serialize


class ProposalsRepository:
    def __init__(self, session):
        self.session = session

    def list(self, organization_id, history=False):
        model = ActionHistory if history else Proposal
        query = (
            select(model, Document)
            .join(
                Document,
                (Document.id == model.document_id) & (Document.organization_id == organization_id),
            )
            .where(model.organization_id == organization_id)
        )
        query = (
            query.order_by(model.executed_at.desc()).limit(20)
            if history
            else query.where(model.status == "PENDING").order_by(model.created_at.desc())
        )
        return [
            {**serialize(row), "document": serialize(document)}
            for row, document in self.session.execute(query)
        ]

    def claim(self, organization_id, proposal_id, status):
        changed = self.session.execute(
            update(Proposal)
            .where(
                Proposal.organization_id == organization_id,
                Proposal.id == proposal_id,
                Proposal.status == "PENDING",
            )
            .values(status=status)
        ).rowcount
        self.session.commit()
        if not changed:
            return None
        return self.session.execute(
            select(Proposal, Document)
            .join(
                Document,
                (Document.id == Proposal.document_id)
                & (Document.organization_id == organization_id),
            )
            .where(
                Proposal.organization_id == organization_id,
                Proposal.id == proposal_id,
                Proposal.status == status,
            )
        ).first()

    def restore(self, organization_id, proposal_id, status):
        self.session.rollback()
        self.session.execute(
            update(Proposal)
            .where(
                Proposal.organization_id == organization_id,
                Proposal.id == proposal_id,
                Proposal.status == status,
            )
            .values(status="PENDING")
        )
        self.session.commit()

    def decide(
        self,
        organization_id,
        proposal_id,
        document_id,
        previous_name,
        *,
        destination=None,
        name=None,
        corrected=False,
        actor_id=None,
    ):
        ignoring = destination is None
        with self.session.begin_nested():
            changed = self.session.execute(
                update(Proposal)
                .where(
                    Proposal.organization_id == organization_id,
                    Proposal.id == proposal_id,
                    Proposal.status == ("IGNORING" if ignoring else "CONFIRMING"),
                )
                .values(
                    status="IGNORED" if ignoring else "OVERRIDDEN" if corrected else "CONFIRMED",
                    decided_at=datetime.now(timezone.utc),
                    final_name=name,
                    final_destination_path=destination.path if destination else None,
                    final_destination_folder_external_id=(
                        destination.external_id if destination else None
                    ),
                )
            ).rowcount
            if changed != 1:
                raise RuntimeError("Claimed proposal was not persisted")
            values = {"status": "IGNORED" if ignoring else "CLASSIFIED"}
            if not ignoring:
                values["name"] = name
            self.session.execute(
                update(Document)
                .where(Document.organization_id == organization_id, Document.id == document_id)
                .values(**values)
            )
            self.session.add(
                ActionHistory(
                    organization_id=organization_id,
                    document_id=document_id,
                    action="IGNORED" if ignoring else "MOVE_RENAME",
                    from_name=previous_name,
                    to_name=name,
                    to_path=destination.path if destination else None,
                    actor_id=actor_id,
                )
            )
            self.session.flush()
        self.session.commit()

    def create(self, organization_id, document_id, **values):
        row = Proposal(organization_id=organization_id, document_id=document_id, **values)
        self.session.add(row)
        self.session.flush()
        return row
