from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db.models import Job, JobStatus

LEASE = timedelta(minutes=15)


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
            self.session.flush()
        return job

    def complete(self, job: Job) -> None:
        job.status = JobStatus.COMPLETED
        job.leased_until = None
        self.session.flush()

    def fail(self, job: Job) -> None:
        job.retry_count += 1
        job.status = JobStatus.FAILED if job.retry_count >= job.retry_limit else JobStatus.READY
        job.leased_until = None
        job.run_at = datetime.now(timezone.utc)
        self.session.flush()

    def reap_expired(self) -> int:
        jobs = self.session.scalars(
            select(Job).where(
                Job.status == JobStatus.ACTIVE,
                Job.leased_until < datetime.now(timezone.utc),
            )
        ).all()
        for job in jobs:
            self.fail(job)
        return len(jobs)

    def work_once(self, handler: Callable[[dict], None]) -> bool:
        job = self.claim()
        if not job:
            return False
        try:
            handler(job.payload)
        except Exception:
            self.fail(job)
        else:
            self.complete(job)
        return True

    def queue_state(self) -> dict[str, int | bool]:
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
            )
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
