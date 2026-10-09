from typing import Literal
from urllib.parse import quote
from fastapi import Response
from fastapi.responses import StreamingResponse
from repositories.documents import DocumentsRepository
from services.drive import MAX_BYTES
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from routers.dependencies import context
from routers.dto import RootDTO, LaunchDTO

INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}

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
    request: Request,
    organization_id: str,
    parentId: str = Query(default="root", min_length=1, max_length=512),
    pageToken: str | None = Query(default=None, min_length=1, max_length=2048),
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    unknown = set(request.query_params) - {"parentId", "pageToken"}
    if unknown:
        raise HTTPException(400, [f"property {name} should not exist" for name in sorted(unknown)])
    return await ctx.sync.items(organization_id, x_user_id, parentId, pageToken)


@router.post("/launch", status_code=201)
async def launch(
    organization_id: str,
    dto: LaunchDTO,
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    return await ctx.sync.launch(organization_id, x_user_id, dto.itemExternalId)


@router.get("/files/{file_id}/preview")
async def file_preview(
    organization_id: str,
    file_id: str,
    variant: Literal["content", "thumbnail"] = "content",
    x_user_id: str = Header(default=""),
    ctx=Depends(context, scope="function"),
):
    if not ctx.settings.acceptance_google_service_account:
        raise HTTPException(404, "Preview not available")
    document = DocumentsRepository(ctx.session).find(organization_id, file_id)
    if not document:
        raise HTTPException(404, "Document not found")
    external_id = document.external_id
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if variant == "thumbnail":
        img, content_type = await ctx.drive.thumbnail(organization_id, x_user_id, external_id)
        return Response(content=img, media_type=content_type, headers=headers)
    data = await ctx.drive.file_metadata(organization_id, x_user_id, external_id)
    if data.get("mimeType") not in INLINE_TYPES:
        raise HTTPException(415, "Unsupported preview content type")
    if int(data.get("size", document.size_bytes)) > MAX_BYTES:
        raise HTTPException(413, "Document exceeds preview size limit")
    stream = ctx.drive.stream(organization_id, x_user_id, external_id)
    # Start the download before response headers so upstream failures keep their status.
    try:
        first = await anext(stream, b"")
    except BaseException:
        await stream.aclose()
        raise

    async def content():
        try:
            yield first
            async for chunk in stream:
                yield chunk
        finally:
            await stream.aclose()

    headers["Content-Disposition"] = f'inline; filename="{quote(data["name"])}"'
    return StreamingResponse(content(), media_type=data["mimeType"], headers=headers)
