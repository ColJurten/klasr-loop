from fastapi import APIRouter, Depends
from routers.dependencies import context
from services.documents import DocumentsService
from db.models import DocumentStatus

router = APIRouter(prefix="/organizations/{organization_id}/documents")


@router.get("")
def list_documents(
    organization_id: str,
    status: DocumentStatus | None = None,
    ctx=Depends(context, scope="function"),
):
    return DocumentsService(ctx.session).list(organization_id, status)


@router.get("/{document_id}")
def get_document(organization_id: str, document_id: str, ctx=Depends(context, scope="function")):
    return DocumentsService(ctx.session).get(organization_id, document_id)
