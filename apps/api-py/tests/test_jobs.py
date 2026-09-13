from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session

from db.models import Base, Job, JobStatus
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
    old_token = stale.lease_token
    # Simulate another worker reclaiming: overwrite lease_token in the DB directly.
    new_token = "reclaimed-by-other-worker"
    session.execute(
        update(Job)
        .where(Job.id == stale.id)
        .values(lease_token=new_token)
        .execution_options(synchronize_session=False)
    )
    # The stale worker (holding the old token) cannot complete the job.
    stale.lease_token = old_token
    assert jobs.complete(stale) is False
    session.expire(stale)
    assert stale.status == JobStatus.ACTIVE
    session.close()


def test_lease_token_lifecycle():
    session, jobs = service()
    jobs.enqueue({"organizationId": "org", "documentId": "doc"})
    assert jobs.claim() is not None
    job = session.query(Job).first()
    assert job.lease_token is not None
    assert jobs.complete(job) is True
    session.refresh(job)
    assert job.lease_token is None
    session.close()
