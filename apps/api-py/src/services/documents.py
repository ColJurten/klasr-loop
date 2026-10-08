from fastapi import HTTPException
from repositories.documents import DocumentsRepository
from repositories.serialization import serialize


class DocumentsService:
    def __init__(self, session):
        self.repository = DocumentsRepository(session)

    def list(self, organization_id, status=None):
        return serialize(self.repository.list(organization_id, status))

    def get(self, organization_id, document_id):
        row = self.repository.find(organization_id, document_id)
        if not row:
            raise HTTPException(404, "Document not found")
        return serialize(row)
