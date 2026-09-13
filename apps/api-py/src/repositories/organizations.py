from sqlalchemy import select, update, exists
from db.models import Organization, User, Membership


class OrganizationsRepository:
    def __init__(self, session):
        self.session = session

    def find(self, organization_id):
        return self.session.scalar(select(Organization).where(Organization.id == organization_id))

    def identity(self, email):
        return self.session.scalar(select(User).where(User.email == email.strip().lower()))

    def identity_by_id(self, user_id):
        return self.session.scalar(select(User).where(User.id == user_id))

    def membership(self, user_id):
        return self.session.scalar(
            select(Membership).where(Membership.user_id == user_id).order_by(Membership.id).limit(1)
        )

    def session_membership(self, user_id, organization_id, membership_id):
        return self.session.scalar(
            select(Membership).where(
                Membership.id == membership_id,
                Membership.organization_id == organization_id,
                Membership.user_id == user_id,
                Membership.role == "ADMIN",
            )
        )

    def create(self, name, email, display_name=None, password_hash=None):
        with self.session.begin_nested():
            org = Organization(name=name)
            user = User(email=email.strip().lower(), name=display_name, password_hash=password_hash)
            self.session.add_all([org, user])
            self.session.flush()
            self.session.add(Membership(user_id=user.id, organization_id=org.id, role="ADMIN"))
            self.session.flush()
        return org

    def enroll(self, user_id, organization_id, membership_id, password_hash):
        membership = exists().where(
            Membership.id == membership_id,
            Membership.organization_id == organization_id,
            Membership.user_id == user_id,
            Membership.role == "ADMIN",
        )
        return self.session.execute(
            update(User)
            .where(User.id == user_id, User.password_hash.is_(None), membership)
            .values(password_hash=password_hash)
        ).rowcount
