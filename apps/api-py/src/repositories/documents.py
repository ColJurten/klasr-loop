from sqlalchemy import select, update
from db.models import Document
from repositories.folders import FoldersRepository


class DocumentsRepository:
    def __init__(self, session):
        self.session = session

    def list(self, organization_id, status=None):
        query = select(Document).where(Document.organization_id == organization_id)
        if status:
            query = query.where(Document.status == status)
        return self.session.scalars(query.order_by(Document.detected_at.desc()).limit(50)).all()

    def find(self, organization_id, document_id, pending=False):
        query = select(Document).where(
            Document.organization_id == organization_id, Document.id == document_id
        )
        if pending:
            query = query.where(Document.status == "PENDING")
        return self.session.scalar(query)

    def upsert(self, organization_id, item, supported):
        row = self.session.scalar(
            select(Document).where(
                Document.organization_id == organization_id, Document.external_id == item["id"]
            )
        )
        if not row:
            row = Document(
                organization_id=organization_id, external_id=item["id"], status="PENDING"
            )
        folder = (
            FoldersRepository(self.session).find(organization_id, external_id=item["parents"][0])
            if item["parents"]
            else None
        )
        row.name, row.mime_type, row.size_bytes = item["name"], item["mimeType"], item["sizeBytes"]
        row.folder_id = folder.id if folder else None
        if not supported:
            row.status = "MANUAL"
        self.session.add(row)
        self.session.flush()
        return row

    def mark_proposed(self, organization_id, document_id):
        return self.session.execute(
            update(Document)
            .where(
                Document.organization_id == organization_id,
                Document.id == document_id,
                Document.status == "PENDING",
            )
            .values(status="PROPOSED")
        ).rowcount
