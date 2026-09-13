from fastapi import APIRouter, Depends, Header
from routers.dependencies import context
from routers.dto import ConfirmDTO
from services.classification import ClassificationService

router = APIRouter(prefix="/organizations/{organization_id}/proposals")


@router.get("")
def list_proposals(organization_id: str, ctx=Depends(context, scope="function")):
    return ClassificationService(ctx.session, ctx.drive).list(organization_id)


@router.post("/{proposal_id}/confirm", status_code=201)
async def confirm(
    organization_id: str,
    proposal_id: str,
    dto: ConfirmDTO,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ClassificationService(ctx.session, ctx.drive).confirm(
        organization_id, proposal_id, dto, x_user_id
    )


@router.post("/{proposal_id}/ignore", status_code=201)
def ignore(organization_id: str, proposal_id: str, ctx=Depends(context, scope="function")):
    return ClassificationService(ctx.session, ctx.drive).ignore(organization_id, proposal_id)
