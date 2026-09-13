from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, update
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
    for retry_count in (2, 3):
        job = jobs.claim()
        job.leased_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        jobs.reap_expired()
        expected = JobStatus.READY if retry_count == 2 else JobStatus.FAILED
        assert job.status == expected and job.retry_count == retry_count
    assert jobs.failed_analysis_count("org") == 1
    assert set(jobs.queue_state()) == {
        "queued",
        "ready",
        "active",
        "failed",
        "inlineWorker",
        "consuming",
    }
    assert jobs.complete(job) is False
    assert jobs.enqueue(payload) is not None
    session.close()


def test_worker_immediately_retries_failure():
    _, jobs = service()
    jobs.enqueue({"organizationId": "org", "documentId": "doc"})

    def fail(_payload):
        raise RuntimeError

    assert jobs.work_once(fail)
    assert jobs.queue_state()["ready"] == 1


def test_stale_worker_cannot_finish_reclaimed_job():
    session, jobs = service()
    jobs.enqueue({"organizationId": "org", "documentId": "doc"})
    stale = jobs.claim()
    old_lease = stale.leased_until
    session.execute(
        update(type(stale))
        .where(type(stale).id == stale.id)
        .values(leased_until=old_lease + timedelta(minutes=1))
        .execution_options(synchronize_session=False)
    )
    assert jobs.complete(stale) is False
    session.refresh(stale)
    assert stale.status == JobStatus.ACTIVE
