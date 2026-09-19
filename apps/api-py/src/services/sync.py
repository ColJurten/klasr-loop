from collections import defaultdict, deque
from fastapi import HTTPException
from repositories.documents import DocumentsRepository
from repositories.folders import FoldersRepository
from repositories.drive_connections import DriveConnectionsRepository
from repositories.usage_metrics import UsageMetricsRepository
from services.drive import FOLDER_MIME, MAX_BYTES


def downloadable(item):
    return (
        not item["mimeType"].startswith("application/vnd.google-apps.")
        and item["sizeBytes"] <= MAX_BYTES
    )


class SyncService:
    def __init__(self, session, drive, jobs):
        self.drive, self.jobs = drive, jobs
        self.documents = DocumentsRepository(session)
        self.folders = FoldersRepository(session)
        self.connections = DriveConnectionsRepository(session)
        self.metrics = UsageMetricsRepository(session)

    async def reference_folders(self, organization_id, user_id):
        return [
            dict(
                externalId=item["id"],
                name=item["name"],
                parentExternalId=next(iter(item["parents"]), None),
            )
            for item in await self.drive.list_metadata(organization_id, user_id)
            if item["mimeType"] == FOLDER_MIME
        ]

    async def select_root(self, organization_id, user_id, external_id):
        items = await self.drive.list_metadata(organization_id, user_id)
        root = next(
            (
                item
                for item in items
                if item["id"] == external_id and item["mimeType"] == FOLDER_MIME
            ),
            None,
        )
        if not root:
            raise HTTPException(404, "Reference folder not found")
        folders = self.folders.replace_root(
            organization_id, root, [item for item in items if item["mimeType"] == FOLDER_MIME]
        )
        self.connections.touch(organization_id, user_id)
        return dict(referenceRoot=dict(externalId=root["id"], name=root["name"]), folders=folders)

    def view(self, item, reference, browsing=False):
        folder = item["mimeType"] == FOLDER_MIME
        supported = folder or downloadable(item)
        excluded = bool(reference and reference["externalId"] == item["id"])
        eligible = (
            (not reference and folder) or (bool(reference) and supported and not excluded)
            if browsing
            else bool(reference) and supported
        )
        reason = (
            (None if browsing and folder else "reference-required")
            if not reference
            else "reference-root" if browsing and excluded else None if supported else "unsupported"
        )
        result = dict(
            externalId=item["id"],
            name=item["name"],
            mimeType=item["mimeType"],
            type="folder" if folder else "file",
            parentExternalId=next(iter(item["parents"]), None),
            supported=supported,
            eligible=bool(eligible),
        )
        if reason:
            result["reason"] = reason
        return result

    async def input_items(self, organization_id, user_id):
        reference = self.folders.root(organization_id)
        return [
            self.view(item, reference)
            for item in await self.drive.list_metadata(organization_id, user_id)
            if not reference or item["id"] != reference["externalId"]
        ]

    async def items(self, organization_id, user_id, parent_id="root", page_token=None):
        reference = self.folders.root(organization_id)
        page = await self.drive.list_children(organization_id, user_id, parent_id, page_token)
        return dict(
            items=[self.view(item, reference, True) for item in page["items"]],
            nextPageToken=page["nextPageToken"],
        )

    async def launch(self, organization_id, user_id, external_id="all"):
        reference = self.folders.root(organization_id)
        if not reference:
            raise HTTPException(400, "Reference root is required before launch")
        metadata = await self.drive.list_metadata(organization_id, user_id)
        selected = next(
            (item for item in metadata if item["id"] == external_id),
            None,
        )
        if not selected:
            raise HTTPException(404, "Drive input item not found")
        if selected["id"] == reference["externalId"]:
            raise HTTPException(400, "Reference tree cannot be used as input")
        children = defaultdict(list)
        for item in metadata:
            for parent in item["parents"]:
                children[parent].append(item)
        queue, seen, enqueued, manual = deque([selected]), set(), 0, 0
        while queue:
            item = queue.popleft()
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            if item["mimeType"] == FOLDER_MIME:
                queue.extend(children[item["id"]])
                continue
            supported = downloadable(item)
            document = self.documents.upsert(organization_id, item, supported)
            if supported and document.status == "PENDING":
                self.jobs.enqueue(
                    dict(organizationId=organization_id, userId=user_id, documentId=document.id)
                )
                enqueued += 1
            if not supported:
                manual += 1
        self.metrics.increment(organization_id, documentsIn=enqueued + manual)
        self.connections.touch(organization_id, user_id)
        return dict(enqueued=enqueued, manual=manual)
