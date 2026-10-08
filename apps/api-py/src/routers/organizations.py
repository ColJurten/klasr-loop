from fastapi import APIRouter, Depends
from routers.dependencies import context
from routers.dto import OrganizationDTO
from services.organizations import OrganizationsService

router = APIRouter(prefix="/organizations")


@router.post("", status_code=201)
def create(dto: OrganizationDTO, ctx=Depends(context, scope="function")):
    return OrganizationsService(ctx.session).create(dto)


@router.get("/{organization_id}")
def get(organization_id: str, ctx=Depends(context, scope="function")):
    return OrganizationsService(ctx.session).get(organization_id)
