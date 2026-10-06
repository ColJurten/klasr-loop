"""Standalone: python -m worker. The HTTP process may opt into this same loop."""

import asyncio
import logging
import signal

import httpx
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from core.settings import Settings
from db.session import make_engine
from jobs.service import JobsService
from mongo.analyses import AnalysesRepository
from services.analysis import AnalysisService
from services.drive import drive_executor
from services.llm_settings import ProviderClientService

logger = logging.getLogger(__name__)
MAX_QUEUE_RETRIES = 5


async def work_once(session, handler):
    jobs = JobsService(session, consuming=True)
    jobs.reap_expired()
    job = jobs.claim()
    session.commit()  # Release the queue lock before doing I/O.
    if not job:
        return False
    session.expunge(job)  # Keep the claimed lease immutable across rollback/reclamation.
    try:
        await handler(job.payload)
        if jobs.complete(job):
            session.commit()
        else:
            session.rollback()
    except Exception as exc:
        session.rollback()
        jobs.fail(job)
        session.commit()
        logger.exception("job handler failed: %s", type(exc).__name__)
    return True


async def run_worker(settings, engine, stop, analyses=None):
    settings.validate_runtime()
    owned = analyses is None
    analyses = analyses or AnalysesRepository(
        settings.mongo_url, settings.mongo_database, settings.analyses_ttl_days
    )
    try:
        await analyses.initialize()
        async with httpx.AsyncClient() as client:
            retry_delay = 1
            retry_attempts = 0
            while not stop.is_set():
                try:
                    with Session(engine, expire_on_commit=False) as session:
                        drive = drive_executor(session, settings, client)
                        handler = AnalysisService(
                            session,
                            settings,
                            drive,
                            ProviderClientService(settings, client),
                            analyses,
                        )
                        worked = await work_once(session, handler.analyze)
                    retry_delay = 1
                    retry_attempts = 0
                except SQLAlchemyError as exc:
                    retry_attempts += 1
                    if retry_attempts >= MAX_QUEUE_RETRIES:
                        logger.exception(
                            "queue operation failed after %d attempts: %s",
                            retry_attempts,
                            type(exc).__name__,
                        )
                        raise
                    logger.warning(
                        "queue operation failed (attempt %d/%d); retrying in %ds: %s",
                        retry_attempts,
                        MAX_QUEUE_RETRIES,
                        retry_delay,
                        type(exc).__name__,
                    )
                    try:
                        await asyncio.wait_for(stop.wait(), timeout=retry_delay)
                    except TimeoutError:
                        pass
                    retry_delay = min(retry_delay * 2, 15)
                    continue
                if not worked and not stop.is_set():
                    try:
                        await asyncio.wait_for(stop.wait(), timeout=1)
                    except TimeoutError:
                        pass
    finally:
        if owned:
            analyses.close()


async def main():
    settings = Settings()
    settings.validate_runtime()
    engine = make_engine(settings.database_url)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await run_worker(settings, engine, stop)
    finally:
        engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
