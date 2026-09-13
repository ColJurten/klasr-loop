from fastapi import APIRouter, Depends, Header
from routers.dependencies import context
from services.dashboard import DashboardService

router = APIRouter(prefix="/organizations/{organization_id}/dashboard")


@router.get("")
async def get(
    organization_id: str,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await DashboardService(ctx.session, ctx.settings, ctx.jobs, ctx.sync).get(
        organization_id, x_user_id
    )
