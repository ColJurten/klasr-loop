from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection


class AnalysesRepository:
    """Metadata-only NoSQL access; document content is rejected at this boundary."""

    allowed = {"organizationId", "documentId", "modelUsed", "quality", "createdAt"}

    def __init__(self, url: str, database: str = "klasr", ttl_days: int = 30):
        self.client = AsyncIOMotorClient(url)
        self.collection: AsyncIOMotorCollection = self.client[database]["analyses"]
        self.ttl_seconds = ttl_days * 24 * 3600

    async def initialize(self) -> None:
        await self.collection.create_index("createdAt", expireAfterSeconds=self.ttl_seconds)
        await self.collection.create_index([("organizationId", 1), ("documentId", 1)])

    async def record(self, metadata: dict[str, Any]) -> None:
        unknown = metadata.keys() - self.allowed
        if unknown:
            raise ValueError(f"non-metadata analysis fields rejected: {sorted(unknown)}")
        await self.collection.insert_one(
            {**metadata, "createdAt": metadata.get("createdAt", datetime.now(timezone.utc))}
        )

    async def find_by_document(self, organization_id: str, document_id: str) -> list[dict]:
        cursor = self.collection.find(
            {"organizationId": organization_id, "documentId": document_id}, {"_id": 0}
        ).sort("createdAt", -1)
        return await cursor.to_list(length=None)

    async def purge_organization(self, organization_id: str) -> int:
        result = await self.collection.delete_many({"organizationId": organization_id})
        return result.deleted_count

    def close(self) -> None:
        self.client.close()
