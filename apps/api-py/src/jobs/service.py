from datetime import datetime, timedelta, timezone
import logging
import uuid
from typing import Callable

from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.models import Job, JobStatus

LEASE = timedelta(minutes=15)
logger = logging.getLogger(__name__)


class JobsService:
    def __init__(self, session: Session, inline_worker: bool = False, consuming: bool = False):
        self.session = session
        self.inline_worker = inline_worker
        self.consuming = consuming

    def enqueue(self, payload: dict, run_at: datetime | None = None) -> Job | None:
        job = Job(
            organization_id=payload["organizationId"],
            document_id=payload["documentId"],
            payload=payload,
            run_at=run_at or datetime.now(timezone.utc),
        )
        try:
            with self.session.begin_nested():
                self.session.add(job)
                self.session.flush()
        except IntegrityError:
            return None
        return job

    def claim(self) -> Job | None:
        now = datetime.now(timezone.utc)
        statement = (
            select(Job)
            .where(Job.status.in_([JobStatus.QUEUED, JobStatus.READY]), Job.run_at <= now)
            .order_by(Job.run_at, Job.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        job = self.session.scalar(statement)
        if job:
            job.status = JobStatus.ACTIVE
            job.leased_until = now + LEASE
            job.lease_token = uuid.uuid4().hex
            job.updated_at = now
            self.session.flush()
        return job

    def complete(self, job: Job) -> bool:
        return self._finish(job, status=JobStatus.COMPLETED)

    def fail(self, job: Job) -> bool:
        retry_count = job.retry_count + 1
        return self._finish(
            job,
            status=JobStatus.FAILED if retry_count > job.retry_limit else JobStatus.READY,
            retry_count=retry_count,
            run_at=datetime.now(timezone.utc),
        )

    def _finish(self, job: Job, **values) -> bool:
        token = job.lease_token
        now = datetime.now(timezone.utc)
        result = self.session.execute(
            update(Job)
            .where(
                Job.id == job.id,
                Job.status == JobStatus.ACTIVE,
                Job.lease_token == token,
            )
            .values(**values, leased_until=None, lease_token=None, updated_at=now)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount and job in self.session:
            self.session.expire(job)
        return bool(result.rowcount)

    def reap_expired(self) -> int:
        jobs = self.session.scalars(
            select(Job).where(
                Job.status == JobStatus.ACTIVE,
                Job.leased_until < datetime.now(timezone.utc),
            )
        ).all()
        return sum(self.fail(job) for job in jobs)

    def work_once(self, handler: Callable[[dict], None]) -> bool:
        job = self.claim()
        if not job:
            return False
        try:
            handler(job.payload)
        except Exception:
            self.fail(job)
        else:
            if not self.complete(job):
                logger.warning("lease lost for job %s", job.id)
        return True

    def queue_state(self, organization_id: str | None = None) -> dict[str, int | bool]:
        now = datetime.now(timezone.utc)
        counts = self.session.execute(
            select(
                func.sum(
                    case(
                        ((Job.status == JobStatus.QUEUED) & (Job.run_at > now), 1),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (
                            Job.status.in_([JobStatus.QUEUED, JobStatus.READY])
                            & (Job.run_at <= now),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(case((Job.status == JobStatus.ACTIVE, 1), else_=0)),
                func.sum(case((Job.status == JobStatus.FAILED, 1), else_=0)),
            ).where(Job.organization_id == organization_id if organization_id is not None else True)
        ).one()
        return {
            "queued": counts[0] or 0,
            "ready": counts[1] or 0,
            "active": counts[2] or 0,
            "failed": counts[3] or 0,
            "inlineWorker": self.inline_worker,
            "consuming": self.consuming,
        }

    def failed_analysis_count(self, organization_id: str) -> int:
        return (
            self.session.scalar(
                select(func.count())
                .select_from(Job)
                .where(
                    Job.name == "analysis",
                    Job.status == JobStatus.FAILED,
                    Job.organization_id == organization_id,
                )
            )
            or 0
        )
