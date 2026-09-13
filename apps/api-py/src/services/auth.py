from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from core.security import TokenEncryptionService, hash_password, password_matches
from repositories.drive_connections import DriveConnectionsRepository
from services.organizations import OrganizationsService


class AuthService:
    def __init__(self, session, settings):
        self.organizations = OrganizationsService(session)
        self.repository = self.organizations.repository
        self.connections = DriveConnectionsRepository(session)
        self.settings = settings

    def result(self, user):
        membership = self.repository.membership(user.id) if user else None
        if not membership:
            return None
        return dict(
            userId=user.id,
            organizationId=membership.organization_id,
            membershipId=membership.id,
            role=membership.role,
        )

    def register(self, dto):
        if self.repository.identity(dto.email):
            raise HTTPException(409, "email_registered")
        try:
            self.repository.create(
                ("Espace de " + dto.displayName)[:120],
                dto.email,
                dto.displayName,
                hash_password(dto.password),
            )
        except IntegrityError:
            raise HTTPException(409, "email_registered") from None
        return self.result(self.repository.identity(dto.email))

    def authenticate(self, dto):
        user = self.repository.identity(dto.email)
        matches = password_matches(dto.password, user.password_hash if user else None)
        return self.result(user) if matches and user and user.password_hash else None

    def onboard(self, dto):
        if dto.emailVerified is not True:
            raise RuntimeError("OAuth email is not verified")
        user = self.repository.identity(dto.email)
        if user and user.password_hash:
            raise RuntimeError("OAuth identity cannot be linked automatically")
        result = self.result(user)
        if not result:
            try:
                self.repository.create(
                    ("Espace de " + (dto.displayName or dto.email))[:120], dto.email
                )
            except IntegrityError:
                pass
            user = self.repository.identity(dto.email)
            if user and user.password_hash:
                raise RuntimeError("OAuth identity cannot be linked automatically")
            result = self.result(user)
        if not result:
            raise RuntimeError("Membership lookup failed immediately after onboarding")
        if dto.provider == "google" and (dto.providerAccountId or dto.refreshToken):
            connection = self.connections.find(result["organizationId"], result["userId"])
            encrypted = (
                TokenEncryptionService(self.settings.token_encryption_key).encrypt(dto.refreshToken)
                if dto.refreshToken
                else connection.encrypted_token if connection else None
            )
            if not encrypted:
                raise HTTPException(400, "Missing Google refresh token")
            self.connections.upsert(
                result["organizationId"],
                result["userId"],
                dto.providerAccountId or dto.email,
                encrypted,
                dto.scopes or [],
            )
        return result

    def eligible(self, identity):
        user_id, organization_id, membership_id = identity
        user = self.repository.identity_by_id(user_id)
        membership = self.repository.session_membership(*identity)
        connection = self.connections.find(organization_id, user_id)
        return bool(
            user
            and not user.password_hash
            and membership
            and connection
            and connection.provider == "GOOGLE_DRIVE"
            and connection.external_id != "acceptance"
        )

    def enroll(self, identity, password):
        if not self.eligible(identity):
            raise HTTPException(403, "local_enrollment_forbidden")
        if self.repository.enroll(*identity, hash_password(password)) != 1:
            raise HTTPException(409, "local_enrollment_conflict")
        return {"enrolled": True}
