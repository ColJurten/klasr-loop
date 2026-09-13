from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from db.models import Base, JobStatus
from jobs import JobsService


def service():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    return session, JobsService(session)


def test_dedupe_retries_lease_and_observability():
    session, jobs = service()
    payload = {"organizationId": "org", "documentId": "doc"}
    first = jobs.enqueue(payload)
    assert first and jobs.enqueue(payload) is None
    job = jobs.claim()
    assert job.status == JobStatus.ACTIVE
    job.leased_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    jobs.reap_expired()
    assert job.status == JobStatus.READY and job.retry_count == 1
    job = jobs.claim()
    job.leased_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    jobs.reap_expired()
    assert job.status == JobStatus.FAILED
    assert jobs.failed_analysis_count("org") == 1
    assert set(jobs.queue_state()) == {
        "queued",
        "ready",
        "active",
        "failed",
        "inlineWorker",
        "consuming",
    }
    jobs.complete(job)
    assert jobs.enqueue(payload) is not None
    session.close()


def test_worker_immediately_retries_failure():
    _, jobs = service()
    jobs.enqueue({"organizationId": "org", "documentId": "doc"})

    def fail(_payload):
        raise RuntimeError

    assert jobs.work_once(fail)
    assert jobs.queue_state()["ready"] == 1
