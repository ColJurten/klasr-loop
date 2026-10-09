import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime as SADateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class StringArray(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(ARRAY(Text) if dialect.name == "postgresql" else JSON)


class JsonObject(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(JSONB() if dialect.name == "postgresql" else JSON())


class DateTime(TypeDecorator):
    impl = SADateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(
            TIMESTAMP(precision=3) if dialect.name == "postgresql" else SADateTime()
        )


class MemberRole(str, enum.Enum):
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class DriveProvider(str, enum.Enum):
    GOOGLE_DRIVE = "GOOGLE_DRIVE"
    ONEDRIVE = "ONEDRIVE"


class DocumentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROPOSED = "PROPOSED"
    CLASSIFIED = "CLASSIFIED"
    MANUAL = "MANUAL"
    IGNORED = "IGNORED"


class ProposalSource(str, enum.Enum):
    RULE = "RULE"
    LLM = "LLM"


class ProposalStatus(str, enum.Enum):
    PENDING = "PENDING"
    CONFIRMING = "CONFIRMING"
    IGNORING = "IGNORING"
    CONFIRMED = "CONFIRMED"
    OVERRIDDEN = "OVERRIDDEN"
    IGNORED = "IGNORED"


class ConditionField(str, enum.Enum):
    CONTENT = "CONTENT"
    FILENAME = "FILENAME"
    MIME_TYPE = "MIME_TYPE"


class ConditionOperator(str, enum.Enum):
    CONTAINS = "CONTAINS"
    EQUALS = "EQUALS"


class HistoryAction(str, enum.Enum):
    MOVE = "MOVE"
    RENAME = "RENAME"
    MOVE_RENAME = "MOVE_RENAME"
    IGNORED = "IGNORED"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    READY = "ready"
    ACTIVE = "active"
    FAILED = "failed"
    COMPLETED = "completed"


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "pk": "%(table_name)s_pkey",
            "fk": "%(table_name)s_%(column_0_N_name)s_fkey",
            "uq": "%(table_name)s_%(column_0_N_name)s_key",
            "ix": "%(table_name)s_%(column_0_N_name)s_idx",
        }
    )


def pk() -> Mapped[str]:
    return mapped_column(Text, primary_key=True, default=lambda: uuid.uuid4().hex)


def fk(target: str, ondelete: str = "RESTRICT") -> ForeignKey:
    return ForeignKey(target, ondelete=ondelete, onupdate="CASCADE")


class Organization(Base):
    __tablename__ = "Organization"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    reference_root_external_id: Mapped[str | None] = mapped_column("referenceRootExternalId", Text)
    reference_root_name: Mapped[str | None] = mapped_column("referenceRootName", Text)


class LlmSetting(Base):
    __tablename__ = "LlmSetting"
    id: Mapped[str] = pk()
    provider: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(Text)
    base_url: Mapped[str] = mapped_column("baseUrl", Text)
    encrypted_api_key: Mapped[str] = mapped_column("encryptedApiKey", Text)
    status: Mapped[str] = mapped_column(Text, server_default="VALID")
    validated_at: Mapped[datetime] = mapped_column("validatedAt", DateTime)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime, server_default=func.now(), onupdate=func.now()
    )
    organization_id: Mapped[str] = mapped_column(
        "organizationId", fk("Organization.id", "CASCADE"), unique=True
    )


class User(Base):
    __tablename__ = "User"
    id: Mapped[str] = pk()
    email: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column("passwordHash", Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())


class Membership(Base):
    __tablename__ = "Membership"
    __table_args__ = (
        UniqueConstraint("userId", "organizationId"),
        Index("Membership_organizationId_idx", "organizationId"),
    )
    id: Mapped[str] = pk()
    role: Mapped[MemberRole] = mapped_column(
        Enum(MemberRole, name="MemberRole"), server_default="MEMBER"
    )
    user_id: Mapped[str] = mapped_column("userId", fk("User.id"))
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class DriveConnection(Base):
    __tablename__ = "DriveConnection"
    __table_args__ = (Index("DriveConnection_organizationId_idx", "organizationId"),)
    id: Mapped[str] = pk()
    provider: Mapped[DriveProvider] = mapped_column(Enum(DriveProvider, name="DriveProvider"))
    external_id: Mapped[str] = mapped_column("externalId", Text)
    encrypted_token: Mapped[str] = mapped_column("encryptedToken", Text)
    scopes: Mapped[list[str]] = mapped_column(StringArray)
    connected_at: Mapped[datetime] = mapped_column(
        "connectedAt", DateTime, server_default=func.now()
    )
    last_sync_at: Mapped[datetime | None] = mapped_column("lastSyncAt", DateTime)
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))
    user_id: Mapped[str | None] = mapped_column("userId", fk("User.id", "SET NULL"), unique=True)


class Folder(Base):
    __tablename__ = "Folder"
    __table_args__ = (
        UniqueConstraint("organizationId", "externalId"),
        Index("Folder_organizationId_path_idx", "organizationId", "path"),
    )
    id: Mapped[str] = pk()
    external_id: Mapped[str] = mapped_column("externalId", Text)
    name: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[str | None] = mapped_column("parentId", fk("Folder.id", "SET NULL"))
    priority: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    inherited: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class Document(Base):
    __tablename__ = "Document"
    __table_args__ = (
        UniqueConstraint("organizationId", "externalId"),
        Index("Document_organizationId_status_idx", "organizationId", "status"),
    )
    id: Mapped[str] = pk()
    external_id: Mapped[str] = mapped_column("externalId", Text)
    name: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column("mimeType", Text)
    size_bytes: Mapped[int] = mapped_column("sizeBytes", Integer)
    status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus, name="DocumentStatus"), server_default="PENDING"
    )
    detected_at: Mapped[datetime] = mapped_column("detectedAt", DateTime, server_default=func.now())
    folder_id: Mapped[str | None] = mapped_column("folderId", fk("Folder.id", "SET NULL"))
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class ClassificationProposal(Base):
    __tablename__ = "ClassificationProposal"
    __table_args__ = (
        Index("ClassificationProposal_organizationId_status_idx", "organizationId", "status"),
    )
    id: Mapped[str] = pk()
    proposed_name: Mapped[str] = mapped_column("proposedName", Text)
    destination_path: Mapped[str] = mapped_column("destinationPath", Text)
    destination_folder_external_id: Mapped[str | None] = mapped_column(
        "destinationFolderExternalId", Text
    )
    confidence: Mapped[float] = mapped_column(Float)
    filename_confidence: Mapped[float | None] = mapped_column("filenameConfidence", Float)
    destination_confidence: Mapped[float | None] = mapped_column("destinationConfidence", Float)
    review_required: Mapped[bool] = mapped_column(
        "reviewRequired", Boolean, server_default=text("false")
    )
    review_reason: Mapped[str | None] = mapped_column("reviewReason", Text)
    source: Mapped[ProposalSource] = mapped_column(Enum(ProposalSource, name="ProposalSource"))
    model_used: Mapped[str | None] = mapped_column("modelUsed", Text)
    llm_calls_used: Mapped[int] = mapped_column("llmCallsUsed", Integer, server_default="0")
    status: Mapped[ProposalStatus] = mapped_column(
        Enum(ProposalStatus, name="ProposalStatus"), server_default="PENDING"
    )
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column("decidedAt", DateTime)
    final_name: Mapped[str | None] = mapped_column("finalName", Text)
    final_destination_path: Mapped[str | None] = mapped_column("finalDestinationPath", Text)
    final_destination_folder_external_id: Mapped[str | None] = mapped_column(
        "finalDestinationFolderExternalId", Text
    )
    document_id: Mapped[str] = mapped_column("documentId", fk("Document.id"))
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class ClassificationRule(Base):
    __tablename__ = "ClassificationRule"
    __table_args__ = (
        UniqueConstraint("organizationId", "priority"),
        Index("ClassificationRule_organizationId_enabled_idx", "organizationId", "enabled"),
    )
    id: Mapped[str] = pk()
    priority: Mapped[int] = mapped_column(Integer)
    destination_path: Mapped[str] = mapped_column("destinationPath", Text)
    suggested_name_template: Mapped[str | None] = mapped_column("suggestedNameTemplate", Text)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class RuleCondition(Base):
    __tablename__ = "RuleCondition"
    id: Mapped[str] = pk()
    field: Mapped[ConditionField] = mapped_column(Enum(ConditionField, name="ConditionField"))
    operator: Mapped[ConditionOperator] = mapped_column(
        Enum(ConditionOperator, name="ConditionOperator")
    )
    value: Mapped[str] = mapped_column(Text)
    rule_id: Mapped[str] = mapped_column("ruleId", fk("ClassificationRule.id", "CASCADE"))


class ActionHistory(Base):
    __tablename__ = "ActionHistory"
    __table_args__ = (
        Index("ActionHistory_organizationId_executedAt_idx", "organizationId", "executedAt"),
    )
    id: Mapped[str] = pk()
    action: Mapped[HistoryAction] = mapped_column(Enum(HistoryAction, name="HistoryAction"))
    from_path: Mapped[str | None] = mapped_column("fromPath", Text)
    to_path: Mapped[str | None] = mapped_column("toPath", Text)
    from_name: Mapped[str | None] = mapped_column("fromName", Text)
    to_name: Mapped[str | None] = mapped_column("toName", Text)
    executed_at: Mapped[datetime] = mapped_column("executedAt", DateTime, server_default=func.now())
    document_id: Mapped[str] = mapped_column("documentId", fk("Document.id"))
    actor_id: Mapped[str | None] = mapped_column("actorId", fk("User.id", "SET NULL"))
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class Notification(Base):
    __tablename__ = "Notification"
    __table_args__ = (Index("Notification_organizationId_readAt_idx", "organizationId", "readAt"),)
    id: Mapped[str] = pk()
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JsonObject)
    read_at: Mapped[datetime | None] = mapped_column("readAt", DateTime)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime, server_default=func.now())
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class UsageMetric(Base):
    __tablename__ = "UsageMetric"
    __table_args__ = (UniqueConstraint("organizationId", "day"),)
    id: Mapped[str] = pk()
    day: Mapped[date] = mapped_column(Date)
    documents_in: Mapped[int] = mapped_column("documentsIn", Integer, server_default="0")
    rule_matches: Mapped[int] = mapped_column("ruleMatches", Integer, server_default="0")
    llm_calls: Mapped[int] = mapped_column("llmCalls", Integer, server_default="0")
    ocr_runs: Mapped[int] = mapped_column("ocrRuns", Integer, server_default="0")
    organization_id: Mapped[str] = mapped_column("organizationId", fk("Organization.id"))


class Subscription(Base):
    __tablename__ = "Subscription"
    id: Mapped[str] = pk()
    plan: Mapped[str] = mapped_column(Text, server_default="free")
    status: Mapped[str] = mapped_column(Text, server_default="active")
    renews_at: Mapped[datetime | None] = mapped_column("renewsAt", DateTime)
    organization_id: Mapped[str] = mapped_column(
        "organizationId", fk("Organization.id"), unique=True
    )


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(Text, server_default="analysis")
    organization_id: Mapped[str] = mapped_column(Text)
    document_id: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JsonObject)
    status: Mapped[JobStatus] = mapped_column(
        Enum(
            JobStatus,
            name="JobStatus",
            values_callable=lambda values: [item.value for item in values],
        ),
        server_default="queued",
    )
    retry_count: Mapped[int] = mapped_column(Integer, server_default="0")
    retry_limit: Mapped[int] = mapped_column(Integer, server_default="2")
    run_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    leased_until: Mapped[datetime | None] = mapped_column(DateTime)
    lease_token: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


Index(
    "jobs_pending_dedupe",
    Job.organization_id,
    Job.document_id,
    unique=True,
    postgresql_where=Job.status.in_([JobStatus.QUEUED, JobStatus.READY, JobStatus.ACTIVE]),
    sqlite_where=Job.status.in_([JobStatus.QUEUED, JobStatus.READY, JobStatus.ACTIVE]),
)


class Analysis(Base):
    __tablename__ = "analyses"
    __table_args__ = (
        Index("analyses_expires_at_idx", "expires_at"),
        Index("analyses_organization_id_document_id_idx", "organization_id", "document_id"),
    )
    id: Mapped[str] = pk()
    organization_id: Mapped[str] = mapped_column(Text)
    document_id: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JsonObject)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime)
