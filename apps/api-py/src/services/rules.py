from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from repositories.rules import RulesRepository


class RulesService:
    def __init__(self, session):
        self.repository = RulesRepository(session)

    def list(self, organization_id):
        return self.repository.list(organization_id)

    def create(self, organization_id, dto):
        message = f"A rule already exists at priority {dto.priority} for this organization"
        if self.repository.exists(organization_id, dto.priority):
            raise HTTPException(409, message)
        try:
            return self.repository.create(organization_id, dto)
        except IntegrityError:
            if self.repository.exists(organization_id, dto.priority):
                raise HTTPException(409, message) from None
            raise
