from fastapi import APIRouter, Depends
from routers.dependencies import context, identity
from routers.dto import OnboardDTO, RegisterDTO, CredentialsDTO, PasswordDTO
from services.auth import AuthService

router = APIRouter(prefix="/auth")


@router.post("/onboarding", status_code=201)
def onboard(dto: OnboardDTO, ctx=Depends(context, scope="function")):
    return AuthService(ctx.session, ctx.settings).onboard(dto)


@router.post("/register", status_code=201)
def register(dto: RegisterDTO, ctx=Depends(context, scope="function")):
    return AuthService(ctx.session, ctx.settings).register(dto)


@router.post("/credentials", status_code=201)
def credentials(dto: CredentialsDTO, ctx=Depends(context, scope="function")):
    return AuthService(ctx.session, ctx.settings).authenticate(dto)


@router.get("/local-password")
def eligible(session_identity=Depends(identity), ctx=Depends(context, scope="function")):
    return {"eligible": AuthService(ctx.session, ctx.settings).eligible(session_identity)}


@router.post("/local-password", status_code=201)
def enroll(
    dto: PasswordDTO, session_identity=Depends(identity), ctx=Depends(context, scope="function")
):
    return AuthService(ctx.session, ctx.settings).enroll(session_identity, dto.password)
