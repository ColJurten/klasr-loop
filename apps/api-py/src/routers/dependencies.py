from types import SimpleNamespace
from fastapi import Depends, Request, HTTPException
import httpx
from db.session import get_session
from jobs.service import JobsService
from services.drive import drive_executor
from services.sync import SyncService
from services.llm_settings import ProviderClientService


async def context(request: Request, session=Depends(get_session, scope="function")):
    settings = request.app.state.settings
    async with httpx.AsyncClient(
        transport=getattr(request.app.state, "http_transport", None)
    ) as client:
        drive = getattr(request.app.state, "drive", None) or drive_executor(
            session, settings, client
        )
        jobs = JobsService(
            session, settings.inline_worker, settings.inline_worker or settings.worker
        )
        providers = getattr(request.app.state, "providers", None) or ProviderClientService(
            settings, client
        )
        yield SimpleNamespace(
            session=session,
            settings=settings,
            drive=drive,
            jobs=jobs,
            providers=providers,
            sync=SyncService(session, drive, jobs),
        )


def identity(request: Request):
    values = tuple(
        request.headers.get(key) for key in ("x-user-id", "x-organization-id", "x-membership-id")
    )
    if not all(values):
        raise HTTPException(401, "authenticated_session_required")
    return values
