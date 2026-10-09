from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from db.models import Analysis

RESULT_ALLOWED = {
    "proposed_name": (str,),
    "destination": (str,),
    "confidence": (int, float),
    "rationale": (str, type(None)),
    "model_info": (dict,),
}

MODEL_INFO_ALLOWED = {"model_used": str, "quality": str, "source": str, "llm_calls_used": int}


class AnalysesRepository:
    allowed = {"proposed_name", "destination", "confidence", "rationale", "model_info"}

    def __init__(self, engine, ttl_days: int = 30):
        self.engine = engine
        self.ttl_days = ttl_days

    async def initialize(self) -> None:
        pass

    async def record(self, *, organization_id, document_id, status, payload: dict) -> None:
        unknown = payload.keys() - self.allowed
        if unknown:
            raise ValueError(f"non-result analysis fields rejected: {sorted(unknown)}")
        if any(type(value) not in RESULT_ALLOWED[key] for key, value in payload.items()):
            raise ValueError("non-result analysis values rejected")
        if "model_info" in payload:
            model_info = payload["model_info"]
            if not isinstance(model_info, dict) or model_info.keys() - MODEL_INFO_ALLOWED.keys():
                raise ValueError("non-result model_info fields rejected")
            if any(type(value) is not MODEL_INFO_ALLOWED[key] for key, value in model_info.items()):
                raise ValueError("non-result model_info values rejected")
        with Session(self.engine) as session:
            session.add(
                Analysis(
                    organization_id=organization_id,
                    document_id=document_id,
                    status=status,
                    payload=payload,
                    expires_at=datetime.now(timezone.utc) + timedelta(days=self.ttl_days),
                )
            )
            session.commit()

    async def find_by_document(self, organization_id, document_id) -> list[dict]:
        with Session(self.engine) as session:
            rows = session.scalars(
                select(Analysis)
                .where(
                    Analysis.organization_id == organization_id,
                    Analysis.document_id == document_id,
                )
                .order_by(Analysis.created_at.desc())
            ).all()
            return [
                dict(
                    status=row.status,
                    payload=row.payload,
                    created_at=row.created_at,
                    expires_at=row.expires_at,
                )
                for row in rows
            ]

    async def update_status(self, organization_id, analysis_id, status) -> bool:
        with Session(self.engine) as session:
            result = session.execute(
                update(Analysis)
                .where(Analysis.id == analysis_id, Analysis.organization_id == organization_id)
                .values(status=status)
            )
            session.commit()
            return result.rowcount > 0

    async def purge_organization(self, organization_id) -> int:
        with Session(self.engine) as session:
            result = session.execute(
                delete(Analysis).where(Analysis.organization_id == organization_id)
            )
            session.commit()
            return result.rowcount

    async def purge_expired(self) -> int:
        with Session(self.engine) as session:
            result = session.execute(delete(Analysis).where(Analysis.expires_at < func.now()))
            session.commit()
            return result.rowcount
