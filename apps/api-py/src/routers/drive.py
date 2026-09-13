from fastapi import APIRouter, Depends, Header, Query
from routers.dependencies import context
from routers.dto import RootDTO, LaunchDTO

router = APIRouter(prefix="/organizations/{organization_id}/drive")


@router.get("/reference-folders")
async def reference_folders(
    organization_id: str,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.reference_folders(organization_id, x_user_id)


@router.post("/reference-root", status_code=201)
async def reference_root(
    organization_id: str,
    dto: RootDTO,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.select_root(organization_id, x_user_id, dto.folderExternalId)


@router.get("/input-items")
async def input_items(
    organization_id: str,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.input_items(organization_id, x_user_id)


@router.get("/items")
async def items(
    organization_id: str,
    parentId: str = Query(default="root", min_length=1, max_length=512),
    pageToken: str | None = Query(default=None, min_length=1, max_length=2048),
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.items(organization_id, x_user_id, parentId, pageToken)


@router.post("/launch", status_code=201)
async def launch(
    organization_id: str,
    dto: LaunchDTO,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.launch(organization_id, x_user_id, dto.itemExternalId)
