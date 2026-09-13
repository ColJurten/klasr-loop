"""Standalone: python -m worker. The HTTP process may opt into this same loop."""

import asyncio
import signal

import httpx
from sqlalchemy.orm import Session
from core.settings import Settings
from db.session import make_engine
from jobs.service import JobsService
from mongo.analyses import AnalysesRepository
from services.analysis import AnalysisService
from services.drive import LocalDriveExecutor, drive_executor
from services.llm_settings import ProviderClientService


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
    except Exception:
        session.rollback()
        jobs.fail(job)
        session.commit()
    return True


async def run_worker(settings, engine, stop, local=None, analyses=None):
    settings.validate_runtime()
    local = local or LocalDriveExecutor()
    owned = analyses is None
    analyses = analyses or AnalysesRepository(
        settings.mongo_url, settings.mongo_database, settings.analyses_ttl_days
    )
    try:
        await analyses.initialize()
        async with httpx.AsyncClient() as client:
            while not stop.is_set():
                with Session(engine, expire_on_commit=False) as session:
                    drive = drive_executor(session, settings, client, local)
                    handler = AnalysisService(
                        session, settings, drive, ProviderClientService(settings, client), analyses
                    )
                    worked = await work_once(session, handler.analyze)
                if not worked:
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
