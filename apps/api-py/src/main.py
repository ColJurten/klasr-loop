import asyncio
from contextlib import asynccontextmanager
from http import HTTPStatus

from fastapi import FastAPI, Request, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from core.settings import Settings
from core.security import internal_service_guard
from db.session import make_engine
from routers import (
    auth,
    organizations,
    dashboard,
    documents,
    drive,
    proposals,
    rules,
    llm_settings,
)


def create_app(settings=None) -> FastAPI:
    settings = settings or Settings()
    settings.validate_runtime()

    @asynccontextmanager
    async def lifespan(app):
        task, stop = None, asyncio.Event()
        if settings.inline_worker:
            from worker import run_worker

            if not hasattr(app.state, "engine"):
                app.state.engine = make_engine(settings.database_url)
            task = asyncio.create_task(run_worker(settings, app.state.engine, stop))
        try:
            yield
        finally:
            stop.set()
            if task:
                await task
            if hasattr(app.state, "engine"):
                app.state.engine.dispose()

    app = FastAPI(
        title="Klasr API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
    )
    app.state.settings = settings

    def error(request, status, message):
        # Preserve the phase-1 health/unknown-path contract; domain errors match Nest.
        if not request.url.path.startswith(("/auth", "/organizations", "/api/v1/")):
            content = {"error": {"status": status, "message": message}}
        elif isinstance(message, dict):
            content = message
        else:
            content = {"message": message, "error": HTTPStatus(status).phrase, "statusCode": status}
        return JSONResponse(status_code=status, content=content)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return error(request, exc.status_code, exc.detail)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        messages = []
        for item in exc.errors():
            field = ".".join(str(part) for part in item["loc"][1:])
            kind = item["type"]
            ctx = item.get("ctx", {})
            if kind == "extra_forbidden":
                message = f"property {field} should not exist"
            elif kind == "string_too_short":
                message = f'{field} must be longer than or equal to {ctx["min_length"]} characters'
            elif kind == "string_too_long":
                message = f'{field} must be shorter than or equal to {ctx["max_length"]} characters'
            elif kind == "string_pattern_mismatch" and field == "destinationPath":
                message = "destinationPath must be an absolute path like /Comptabilité/Factures"
            else:
                message = f'{field} {item["msg"].removeprefix("Value error, ")}'
                if "must be an email" in message:
                    message = f"{field} must be an email"
            messages.append(message)
        return error(request, 400, messages)

    @app.middleware("http")
    async def errors(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            return error(request, 500, "Internal server error")

    async def health() -> dict[str, str]:
        return {"status": "ok"}

    for prefix in ("", "/api/v1"):
        app.add_api_route(prefix + "/health", health, methods=["GET"])

    for module in (
        auth,
        organizations,
        dashboard,
        documents,
        drive,
        proposals,
        rules,
        llm_settings,
    ):
        for prefix in ("", "/api/v1"):
            app.include_router(
                module.router, prefix=prefix, dependencies=[Depends(internal_service_guard)]
            )
    return app


app = create_app()
