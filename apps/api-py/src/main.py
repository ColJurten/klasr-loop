from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from core.settings import get_settings


def create_app() -> FastAPI:
    app = FastAPI(title="Klasr API")
    app.state.settings = get_settings()

    def error(status: int, message: str) -> JSONResponse:
        return JSONResponse(
            status_code=status, content={"error": {"status": status, "message": message}}
        )

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        return error(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError):
        return error(422, "Validation error")

    @app.middleware("http")
    async def errors(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            return error(500, "Internal server error")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
