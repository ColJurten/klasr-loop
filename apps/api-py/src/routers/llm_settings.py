from fastapi import APIRouter, Depends
from routers.dependencies import context
from routers.dto import LlmDTO
from services.llm_settings import LlmSettingsService

router = APIRouter(prefix="/organizations/{organization_id}/llm-settings")


def service(ctx):
    return LlmSettingsService(ctx.session, ctx.settings, ctx.providers)


@router.get("")
def get(organization_id: str, ctx=Depends(context, scope="function")):
    return service(ctx).get(organization_id)


@router.post("/models", status_code=201)
async def discover(organization_id: str, dto: LlmDTO, ctx=Depends(context, scope="function")):
    return await service(ctx).discover(dto)


@router.put("")
async def save(organization_id: str, dto: LlmDTO, ctx=Depends(context, scope="function")):
    return await service(ctx).save(organization_id, dto)


@router.delete("")
def remove(organization_id: str, ctx=Depends(context, scope="function")):
    return service(ctx).remove(organization_id)
