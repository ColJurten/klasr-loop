from fastapi import APIRouter, Depends, Header
from routers.dependencies import context

router = APIRouter(prefix="/organizations/{organization_id}/sync")


@router.post("", status_code=201)
async def sync(
    organization_id: str,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.launch(organization_id, x_user_id)
