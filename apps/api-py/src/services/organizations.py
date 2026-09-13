from fastapi import HTTPException
from repositories.organizations import OrganizationsRepository
from repositories.serialization import serialize


class OrganizationsService:
    def __init__(self, session):
        self.repository = OrganizationsRepository(session)

    def create(self, dto, **user):
        return serialize(self.repository.create(dto.name, dto.ownerEmail, **user))

    def get(self, organization_id):
        organization = self.repository.find(organization_id)
        if not organization:
            raise HTTPException(404, "Organization not found")
        return serialize(organization)
