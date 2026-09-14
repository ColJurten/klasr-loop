from datetime import datetime, timezone
from sqlalchemy import select, update
from db.models import DriveConnection


class DriveConnectionsRepository:
    def __init__(self, session):
        self.session = session

    def find(self, organization_id, user_id):
        return self.session.scalar(
            select(DriveConnection).where(
                DriveConnection.organization_id == organization_id,
                DriveConnection.user_id == user_id,
            )
        )

    def upsert(self, organization_id, user_id, external_id, encrypted_token, scopes):
        row = self.session.scalar(select(DriveConnection).where(DriveConnection.user_id == user_id))
        if not row:
            row = DriveConnection(user_id=user_id)
            self.session.add(row)
        row.organization_id = organization_id
        row.provider = "GOOGLE_DRIVE"
        row.external_id = external_id
        row.encrypted_token = encrypted_token
        row.scopes = scopes
        row.connected_at = datetime.now(timezone.utc)
        self.session.flush()
        return row

    def touch(self, organization_id, user_id):
        self.session.execute(
            update(DriveConnection)
            .where(
                DriveConnection.organization_id == organization_id,
                DriveConnection.user_id == user_id,
            )
            .values(last_sync_at=datetime.now(timezone.utc))
        )
