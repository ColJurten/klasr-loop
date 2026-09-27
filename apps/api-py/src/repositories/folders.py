from collections import defaultdict, deque
import re
from sqlalchemy import delete, select, update
from db.models import Document, Folder, Organization


class FoldersRepository:
    def __init__(self, session):
        self.session = session

    def find(self, organization_id, *, external_id=None, path=None):
        clause = (
            Folder.external_id == external_id if external_id is not None else Folder.path == path
        )
        return self.session.scalar(
            select(Folder).where(Folder.organization_id == organization_id, clause)
        )

    def inherited(self, organization_id):
        rows = self.session.scalars(
            select(Folder)
            .where(Folder.organization_id == organization_id, Folder.inherited.is_(True))
            .order_by(Folder.path)
        ).all()
        by_id = {row.id: row.external_id for row in rows}
        return [
            dict(
                externalId=row.external_id,
                name=row.name,
                path=row.path,
                parentExternalId=by_id.get(row.parent_id),
            )
            for row in rows
        ]

    def root(self, organization_id):
        row = self.session.scalar(select(Organization).where(Organization.id == organization_id))
        return (
            dict(externalId=row.reference_root_external_id, name=row.reference_root_name)
            if row and row.reference_root_external_id and row.reference_root_name
            else None
        )

    def replace_root(self, organization_id, root, metadata):
        with self.session.begin_nested():
            self.session.execute(
                update(Document)
                .where(Document.organization_id == organization_id)
                .values(folder_id=None)
            )
            self.session.execute(
                update(Folder)
                .where(Folder.organization_id == organization_id)
                .values(parent_id=None)
            )
            self.session.execute(delete(Folder).where(Folder.organization_id == organization_id))
            updated = self.session.execute(
                update(Organization)
                .where(Organization.id == organization_id)
                .values(reference_root_external_id=root["id"], reference_root_name=root["name"])
            )
            if not updated.rowcount:
                raise RuntimeError("Organization not found")
            children = defaultdict(list)
            for item in metadata:
                for parent in item["parents"]:
                    children[parent].append(item)
            queue = deque((item, "/" + item["name"], None) for item in children[root["id"]])
            seen = {root["id"]}
            while queue:
                item, path, parent_id = queue.popleft()
                if item["id"] in seen:
                    continue
                seen.add(item["id"])
                folder = Folder(
                    organization_id=organization_id,
                    external_id=item["id"],
                    name=item["name"],
                    path=path,
                    parent_id=parent_id,
                    inherited=True,
                )
                self.session.add(folder)
                self.session.flush()
                queue.extend(
                    (child, re.sub("/+", "/", path + "/" + child["name"]), folder.id)
                    for child in children[item["id"]]
                )
        return self.inherited(organization_id)
