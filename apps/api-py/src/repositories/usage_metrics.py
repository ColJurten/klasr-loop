from datetime import datetime, timezone
from sqlalchemy import select, func
from db.models import UsageMetric, Document, ClassificationProposal

FIELDS = {
    "documentsIn": "documents_in",
    "ruleMatches": "rule_matches",
    "llmCalls": "llm_calls",
    "ocrRuns": "ocr_runs",
}


class UsageMetricsRepository:
    def __init__(self, session):
        self.session = session

    def increment(self, organization_id, **deltas):
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        insert = sqlite_insert if self.session.bind.dialect.name == "sqlite" else pg_insert
        values = {FIELDS[key]: value for key, value in deltas.items()}
        statement = insert(UsageMetric).values(
            organization_id=organization_id, day=datetime.now(timezone.utc).date(), **values
        )
        self.session.execute(
            statement.on_conflict_do_update(
                index_elements=[UsageMetric.organization_id, UsageMetric.day],
                set_={
                    getattr(UsageMetric, key): getattr(UsageMetric, key) + value
                    for key, value in values.items()
                },
            )
        )

    def totals(self, organization_id):
        def count(model, condition):
            return (
                self.session.scalar(
                    select(func.count())
                    .select_from(model)
                    .where(model.organization_id == organization_id, condition)
                )
                or 0
            )

        result = dict(
            pending=count(ClassificationProposal, ClassificationProposal.status == "PENDING"),
            analyzing=count(Document, Document.status == "PENDING"),
            classified=count(Document, Document.status == "CLASSIFIED"),
            outcomes=count(
                Document, Document.status.in_(["PROPOSED", "CLASSIFIED", "MANUAL", "IGNORED"])
            ),
        )
        for public, field in FIELDS.items():
            result[public] = (
                self.session.scalar(
                    select(func.sum(getattr(UsageMetric, field))).where(
                        UsageMetric.organization_id == organization_id
                    )
                )
                or 0
            )
        return result
