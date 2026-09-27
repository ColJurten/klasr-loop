from fastapi import APIRouter, Depends
from routers.dependencies import context
from routers.dto import RuleDTO
from services.rules import RulesService

router = APIRouter(prefix="/organizations/{organization_id}/rules")


@router.get("")
def list_rules(organization_id: str, ctx=Depends(context, scope="function")):
    return RulesService(ctx.session).list(organization_id)


@router.post("", status_code=201)
def create(organization_id: str, dto: RuleDTO, ctx=Depends(context, scope="function")):
    return RulesService(ctx.session).create(organization_id, dto)
