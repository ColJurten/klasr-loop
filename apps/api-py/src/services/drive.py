import json
import time
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from core.security import TokenEncryptionService, encode
from repositories.drive_connections import DriveConnectionsRepository
from repositories.folders import FoldersRepository

FOLDER_MIME = "application/vnd.google-apps.folder"
MAX_BYTES = 20 * 1024 * 1024


class DriveExecutor(Protocol):
    async def move_and_rename(self, command: dict) -> None: ...

    async def list_metadata(self, organization_id: str, user_id: str) -> list[dict]: ...

    async def list_children(
        self, organization_id: str, user_id: str, parent_id: str, page_token: str | None = None
    ) -> dict: ...

    async def download(
        self, organization_id: str, user_id: str, document_external_id: str
    ) -> bytes: ...


class GoogleTokenService:
    def __init__(self, session, settings, client):
        self.connections = DriveConnectionsRepository(session)
        self.settings, self.client = settings, client

    async def get_access_token(self, organization_id, user_id=""):
        if self.settings.acceptance_google_service_account:
            return await self.service_account_token()
        connection = self.connections.find(organization_id, user_id)
        if not connection or connection.provider != "GOOGLE_DRIVE":
            raise HTTPException(401, "Google Drive is not connected")
        token = TokenEncryptionService(self.settings.token_encryption_key).decrypt(
            connection.encrypted_token
        )
        return await self.exchange(
            "https://oauth2.googleapis.com/token",
            dict(
                client_id=self.settings.google_client_id,
                client_secret=self.settings.google_client_secret,
                refresh_token=token,
                grant_type="refresh_token",
            ),
            "Google token refresh failed",
        )

    async def exchange(self, url, data, message):
        try:
            response = await self.client.post(url, data=data)
            payload = response.json() if response.is_success else {}
            token = payload.get("access_token")
            if not isinstance(token, str) or not token:
                raise ValueError
            return token
        except (httpx.HTTPError, ValueError, TypeError):
            raise HTTPException(401, message) from None

    async def service_account_token(self):
        if self.settings.node_env == "production":
            raise RuntimeError("KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT cannot run in production")
        path = Path(self.settings.google_service_account_file)
        if not path.is_absolute():
            raise RuntimeError("KLASR_GOOGLE_SERVICE_ACCOUNT_FILE must be an absolute path")
        try:
            credential = json.loads(path.read_text())
        except (OSError, ValueError):
            raise RuntimeError("Google service-account credential is not valid JSON") from None
        if credential.get("type") != "service_account" or not all(
            credential.get(k) for k in ("client_email", "private_key", "token_uri")
        ):
            raise RuntimeError("Google service-account credential is missing required fields")
        now = int(time.time())
        header = encode(json.dumps(dict(alg="RS256", typ="JWT")).encode())
        payload = encode(
            json.dumps(
                dict(
                    iss=credential["client_email"],
                    scope="https://www.googleapis.com/auth/drive",
                    aud=credential["token_uri"],
                    iat=now,
                    exp=now + 3600,
                )
            ).encode()
        )
        unsigned = f"{header}.{payload}"
        key = serialization.load_pem_private_key(credential["private_key"].encode(), password=None)
        signature = encode(key.sign(unsigned.encode(), padding.PKCS1v15(), hashes.SHA256()))
        return await self.exchange(
            credential["token_uri"],
            dict(
                grant_type="urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion=f"{unsigned}.{signature}",
            ),
            "Google service-account token exchange failed",
        )


class GoogleDriveExecutor:
    base = "https://www.googleapis.com/drive/v3/files"

    def __init__(self, session, settings, client):
        self.tokens = GoogleTokenService(session, settings, client)
        self.folders = FoldersRepository(session)
        self.settings, self.client = settings, client

    async def headers(self, organization_id, user_id):
        return {
            "Authorization": "Bearer "
            + await self.tokens.get_access_token(organization_id, user_id)
        }

    async def page(self, headers, params):
        response = await self.client.get(self.base, params=params, headers=headers)
        if not response.is_success:
            raise HTTPException(
                response.status_code if response.status_code in (400, 401, 404, 409) else 502,
                "Google Drive list failed",
            )
        data = response.json()
        return dict(
            items=[
                dict(
                    id=item["id"],
                    name=item["name"],
                    mimeType=item["mimeType"],
                    sizeBytes=int(item.get("size", 0)),
                    parents=item.get("parents", []),
                )
                for item in data.get("files", [])
            ],
            nextPageToken=data.get("nextPageToken"),
        )

    async def list_metadata(self, organization_id, user_id=""):
        headers = await self.headers(organization_id, user_id)
        params = dict(
            pageSize="1000",
            fields="nextPageToken,files(id,name,mimeType,size,parents)",
            q="trashed=false",
            supportsAllDrives="true",
            includeItemsFromAllDrives="true",
        )
        items, seen = [], set()
        while True:
            page = await self.page(headers, params)
            items.extend(page["items"])
            token = page["nextPageToken"]
            if not token:
                return items
            if token in seen:
                raise HTTPException(502, "Google Drive list failed")
            seen.add(token)
            params["pageToken"] = token

    async def list_children(self, organization_id, user_id, parent_id, page_token=None):
        if parent_id == "root" and self.settings.acceptance_google_service_account:
            parent_id = self.settings.google_drive_root_id
        escaped = parent_id.replace("\\", "\\\\").replace("'", "\\'")
        params = dict(
            pageSize="100",
            fields="nextPageToken,files(id,name,mimeType,size,parents)",
            q=f"'{escaped}' in parents and trashed=false",
            supportsAllDrives="true",
            includeItemsFromAllDrives="true",
            orderBy="folder,name_natural",
        )
        if page_token:
            params["pageToken"] = page_token
        return await self.page(await self.headers(organization_id, user_id), params)

    async def download(self, organization_id, user_id, document_external_id):
        headers = await self.headers(organization_id, user_id)
        async with self.client.stream(
            "GET",
            f'{self.base}/{quote(document_external_id, safe="")}',
            params={"alt": "media"},
            headers=headers,
        ) as response:
            if not response.is_success:
                raise RuntimeError(f"Google Drive download failed: {response.status_code}")
            content = bytearray()
            async for chunk in response.aiter_bytes():
                if len(content) + len(chunk) > MAX_BYTES:
                    raise RuntimeError("Document exceeds analysis size limit")
                content.extend(chunk)
            return bytes(content)

    async def move_and_rename(self, command):
        org = command["organizationId"]
        destination = (
            self.folders.find(org, external_id=command["destinationFolderExternalId"])
            if command.get("destinationFolderExternalId")
            else self.folders.find(org, path=command.get("destinationPath"))
        )
        if not destination:
            raise HTTPException(404, "Destination folder not found")
        headers = await self.headers(org, command.get("userId", ""))
        url = f'{self.base}/{quote(command["documentExternalId"], safe="")}'
        response = await self.client.get(
            url, headers=headers, params={"fields": "parents", "supportsAllDrives": "true"}
        )
        if not response.is_success:
            raise RuntimeError(f"Google Drive metadata lookup failed: {response.status_code}")
        old = [
            parent
            for parent in response.json().get("parents", [])
            if parent != destination.external_id
        ]
        params = dict(
            addParents=destination.external_id, fields="id,name,parents", supportsAllDrives="true"
        )
        if old:
            params["removeParents"] = ",".join(old)
        response = await self.client.patch(
            url,
            headers=headers,
            params=params,
            json={} if command.get("rename") is False else {"name": command["newName"]},
        )
        if not response.is_success:
            raise RuntimeError(f"Google Drive move/rename failed: {response.status_code}")


def drive_executor(session, settings, client):
    settings.validate_runtime()
    return GoogleDriveExecutor(session, settings, client)
