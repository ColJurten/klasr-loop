from sqlalchemy import select, delete
from db.models import LlmSetting


class LlmSettingsRepository:
    def __init__(self, session):
        self.session = session

    def find(self, organization_id):
        return self.session.scalar(
            select(LlmSetting).where(LlmSetting.organization_id == organization_id)
        )

    def upsert(self, organization_id, **values):
        row = self.find(organization_id)
        if not row:
            row = LlmSetting(organization_id=organization_id)
            self.session.add(row)
        for key, value in values.items():
            setattr(row, key, value)
        self.session.flush()
        return row

    def delete(self, organization_id):
        self.session.execute(
            delete(LlmSetting).where(LlmSetting.organization_id == organization_id)
        )
