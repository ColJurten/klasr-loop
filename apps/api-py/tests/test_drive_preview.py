import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.orm import Session

from db.models import Document, Organization
from routers.dependencies import context
from services.drive import GoogleDriveExecutor, LocalDriveExecutor, MAX_BYTES, NoopDriveExecutor


@pytest.fixture
def preview(api):
    client, app, engine = api
    with Session(engine) as db:
        db.add_all([Organization(id=org, name=org) for org in ("org", "other_org")])
        db.flush()
        db.add_all(
            [
                Document(
                    id=doc_id,
                    organization_id=org,
                    external_id="drive_external",
                    name="scan.pdf",
                    mime_type="application/pdf",
                    size_bytes=10,
                )
                for doc_id, org in [("doc_1", "org"), ("other_doc", "other_org")]
            ]
        )
        db.commit()
    drive = SimpleNamespace(
        file_metadata=AsyncMock(return_value={"name": "scan.pdf", "mimeType": "application/pdf"}),
        download=AsyncMock(),
        thumbnail=AsyncMock(return_value=(b"synthetic thumbnail", "image/png")),
    )

    async def chunks(*args):
        yield b"synthetic "
        assert closed == [True]
        yield b"document"

    drive.stream = Mock(side_effect=chunks)
    settings = SimpleNamespace(acceptance_google_service_account=True)
    statements = []
    event.listen(engine, "before_cursor_execute", lambda *args: statements.append(args[2]))
    closed = []

    async def preview_context():
        with Session(engine) as db:
            yield SimpleNamespace(drive=drive, session=db, settings=settings)
        closed.append(True)

    app.dependency_overrides[context] = preview_context
    return client, drive, settings, statements, closed


@pytest.mark.parametrize("variant", ["content", "thumbnail"])
def test_preview_pass_through_without_persistence(preview, tmp_path, caplog, variant):
    client, drive, _, statements, closed = preview
    before_entries = sorted(tmp_path.rglob("*"))
    before = {p: p.read_bytes() for p in before_entries if p.is_file()}
    caplog.set_level(logging.DEBUG)
    response = client.get(
        f"/organizations/org/drive/files/doc_1/preview?variant={variant}",
        headers={"x-user-id": "user"},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    if variant == "content":
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("inline")
        assert response.content == b"synthetic document"
        drive.file_metadata.assert_awaited_once_with("org", "user", "drive_external")
        drive.stream.assert_called_once_with("org", "user", "drive_external")
        drive.thumbnail.assert_not_awaited()
    else:
        assert response.headers["content-type"] == "image/png"
        assert response.content == b"synthetic thumbnail"
        drive.thumbnail.assert_awaited_once_with("org", "user", "drive_external")
        drive.stream.assert_not_called()
        drive.file_metadata.assert_not_awaited()
    drive.download.assert_not_awaited()
    assert sorted(tmp_path.rglob("*")) == before_entries
    assert {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before
    assert len(statements) == 2
    assert statements[0] == "BEGIN" and statements[1].startswith("SELECT")
    assert "synthetic document" not in caplog.text
    assert "synthetic thumbnail" not in caplog.text
    assert closed == [True]


@pytest.mark.parametrize(
    "mime", ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]
)
def test_allowlisted_content(preview, mime):
    client, drive, *_ = preview
    drive.file_metadata.return_value["mimeType"] = mime
    response = client.get("/organizations/org/drive/files/doc_1/preview")
    assert response.status_code == 200
    assert response.headers["content-type"] == mime
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("mime", ["text/html", "image/svg+xml", "application/zip"])
def test_rejects_unsafe_content(preview, mime):
    client, drive, *_ = preview
    drive.file_metadata.return_value["mimeType"] = mime
    assert client.get("/organizations/org/drive/files/doc_1/preview").status_code == 415
    drive.stream.assert_not_called()


@pytest.mark.parametrize("variant", ["content", "thumbnail"])
def test_preview_requires_service_account(preview, variant):
    client, drive, settings, statements, _ = preview
    settings.acceptance_google_service_account = False
    assert (
        client.get(f"/organizations/org/drive/files/doc_1/preview?variant={variant}").status_code
        == 404
    )
    assert statements == []
    drive.file_metadata.assert_not_awaited()
    drive.thumbnail.assert_not_awaited()


@pytest.mark.parametrize("doc_id", ["missing", "other_doc"])
def test_preview_document_scoped_to_org(preview, doc_id):
    client, drive, _, statements, _ = preview
    assert client.get(f"/organizations/org/drive/files/{doc_id}/preview").status_code == 404
    assert len(statements) == 2
    assert statements[0] == "BEGIN" and statements[1].startswith("SELECT")
    drive.file_metadata.assert_not_awaited()
    drive.thumbnail.assert_not_awaited()
    drive.stream.assert_not_called()


def test_preview_size_rejected_before_headers(preview):
    client, drive, *_ = preview
    drive.file_metadata.return_value["size"] = str(MAX_BYTES + 1)
    assert client.get("/organizations/org/drive/files/doc_1/preview").status_code == 413
    drive.stream.assert_not_called()


@pytest.mark.parametrize("status", [401, 403, 404, 413, 502])
def test_stream_failure_before_headers(preview, status):
    client, drive, *_ = preview

    async def failed(*args):
        raise HTTPException(status, "Download failed")
        yield b""

    drive.stream.side_effect = failed
    assert client.get("/organizations/org/drive/files/doc_1/preview").status_code == status


@pytest.mark.asyncio
async def test_google_stream_owns_client_after_context_closes(monkeypatch):
    requests = []

    async def upstream(request):
        requests.append(request)
        return httpx.Response(200, content=b"synthetic document")

    own_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    context_client = httpx.AsyncClient()
    await context_client.aclose()
    executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), context_client)
    token = AsyncMock(return_value="synthetic-token")
    monkeypatch.setattr("services.drive.GoogleTokenService.get_access_token", token)
    monkeypatch.setattr("services.drive.httpx.AsyncClient", lambda: own_client)
    assert b"".join([chunk async for chunk in executor.stream("org", "user", "drive/id")]) == (
        b"synthetic document"
    )
    assert context_client.is_closed and own_client.is_closed
    assert len(requests) == 1
    assert requests[0].url.path.endswith("/drive/id")
    assert requests[0].url.params["alt"] == "media"
    assert requests[0].headers["authorization"] == "Bearer synthetic-token"
    token.assert_awaited_once_with("org", "user")


@pytest.mark.asyncio
@pytest.mark.parametrize("status, expected", [(401, 401), (403, 403), (404, 404), (500, 502)])
async def test_google_stream_maps_upstream_errors(monkeypatch, status, expected):
    own_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(status))
    )
    monkeypatch.setattr("services.drive.httpx.AsyncClient", lambda: own_client)
    monkeypatch.setattr(
        "services.drive.GoogleTokenService.get_access_token", AsyncMock(return_value="token")
    )
    executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), Mock())
    with pytest.raises(HTTPException) as error:
        await anext(executor.stream("org", "user", "external"))
    assert error.value.status_code == expected
    assert own_client.is_closed


@pytest.mark.asyncio
@pytest.mark.parametrize("reported_size", [True, False])
async def test_google_stream_caps_bytes(monkeypatch, reported_size):
    class Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(3):
                yield b"x" * 4

    own_client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"content-length": "12"} if reported_size else {},
                stream=Chunks(),
            )
        )
    )
    monkeypatch.setattr("services.drive.httpx.AsyncClient", lambda: own_client)
    monkeypatch.setattr("services.drive.MAX_BYTES", 8)
    monkeypatch.setattr(
        "services.drive.GoogleTokenService.get_access_token", AsyncMock(return_value="token")
    )
    executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), Mock())
    with pytest.raises(HTTPException) as error:
        await anext(executor.stream("org", "user", "external"))
    assert error.value.status_code == 413
    assert own_client.is_closed


@pytest.mark.asyncio
async def test_google_stream_network_failure(monkeypatch):
    def upstream(request):
        raise httpx.ConnectError("synthetic", request=request)

    own_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    monkeypatch.setattr("services.drive.httpx.AsyncClient", lambda: own_client)
    monkeypatch.setattr(
        "services.drive.GoogleTokenService.get_access_token", AsyncMock(return_value="token")
    )
    executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), Mock())
    with pytest.raises(HTTPException) as error:
        await anext(executor.stream("org", "user", "external"))
    assert error.value.status_code == 502
    assert own_client.is_closed


@pytest.mark.asyncio
async def test_local_and_noop_stream_contract():
    local = LocalDriveExecutor()
    local.download = AsyncMock(return_value=b"synthetic")
    assert [chunk async for chunk in local.stream("org", "user", "external")] == [b"synthetic"]
    local.download.assert_has_awaits([call("org", "user", "external")])
    with pytest.raises(RuntimeError, match="cannot download"):
        await anext(NoopDriveExecutor().stream("org", "user", "external"))


@pytest.mark.asyncio
async def test_preview_returns_streaming_response_without_consuming_body():
    from fastapi.responses import StreamingResponse
    from routers.drive import file_preview

    consumed = []

    async def chunks(*args):
        for chunk in (b"first", b"second"):
            consumed.append(chunk)
            yield chunk

    session = Mock()
    session.scalar.return_value = SimpleNamespace(external_id="external", size_bytes=10)
    ctx = SimpleNamespace(
        session=session,
        settings=SimpleNamespace(acceptance_google_service_account=True),
        drive=SimpleNamespace(
            file_metadata=AsyncMock(
                return_value={"name": "scan.pdf", "mimeType": "application/pdf"}
            ),
            stream=chunks,
        ),
    )
    response = await file_preview("org", "doc", x_user_id="user", ctx=ctx)
    assert isinstance(response, StreamingResponse)
    assert consumed == [b"first"]
    assert [chunk async for chunk in response.body_iterator] == [b"first", b"second"]
    assert consumed == [b"first", b"second"]
    assert len(session.mock_calls) == 1


@pytest.mark.asyncio
async def test_google_stream_caps_late_chunks_and_closes(monkeypatch):
    class Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(3):
                yield b"x" * (64 * 1024)

    own_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Chunks()))
    )
    monkeypatch.setattr("services.drive.httpx.AsyncClient", lambda: own_client)
    monkeypatch.setattr("services.drive.MAX_BYTES", 128 * 1024)
    monkeypatch.setattr(
        "services.drive.GoogleTokenService.get_access_token", AsyncMock(return_value="token")
    )
    executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), Mock())
    stream = executor.stream("org", "user", "external")
    assert len(await anext(stream)) == 64 * 1024
    assert len(await anext(stream)) == 64 * 1024
    with pytest.raises(HTTPException) as error:
        await anext(stream)
    assert error.value.status_code == 413
    assert own_client.is_closed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "host, status, upstream_type",
    [
        ("lh3.googleusercontent.com", 200, "image/jpeg"),
        ("example.com", 200, "image/jpeg"),
        ("googleusercontent.com.example.com", 200, "image/jpeg"),
        ("googleusercontent.com", 200, None),
        ("lh3.googleusercontent.com", 403, "image/jpeg"),
        ("example.com", 500, "image/jpeg"),
    ],
)
async def test_google_thumbnail_credentials_and_content_type(
    monkeypatch, host, status, upstream_type
):
    requests = []

    async def upstream(request):
        requests.append(request)
        if request.url.host == "www.googleapis.com":
            assert request.headers["authorization"] == "Bearer synthetic-token"
            return httpx.Response(200, json={"thumbnailLink": f"https://{host}/t"})
        assert request.url.host == host
        if host.endswith(".googleusercontent.com"):
            assert request.headers["authorization"] == "Bearer synthetic-token"
        else:
            assert "authorization" not in request.headers
        return httpx.Response(
            status,
            content=b"synthetic thumbnail",
            headers={"Content-Type": upstream_type} if upstream_type else {},
        )

    monkeypatch.setattr(
        "services.drive.GoogleTokenService.get_access_token",
        AsyncMock(return_value="synthetic-token"),
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), client)
        if status == 200:
            assert await executor.thumbnail("org", "user", "external") == (
                b"synthetic thumbnail",
                upstream_type or "image/png",
            )
        else:
            with pytest.raises(HTTPException) as error:
                await executor.thumbnail("org", "user", "external")
            assert error.value.status_code == 502
    assert len(requests) == 2
    assert requests[0].url.path == "/drive/v3/files/external"
    assert requests[1].url.path == "/t"


def test_preview_thumbnail_preserves_upstream_image_type(preview):
    client, drive, *_ = preview
    drive.thumbnail.return_value = (b"synthetic thumbnail", "image/jpeg")
    response = client.get("/organizations/org/drive/files/doc_1/preview?variant=thumbnail")
    assert response.status_code == 200
    assert response.content == b"synthetic thumbnail"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_google_thumbnail_missing_link(monkeypatch):
    monkeypatch.setattr(
        "services.drive.GoogleTokenService.get_access_token", AsyncMock(return_value="token")
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={}))
    ) as client:
        executor = GoogleDriveExecutor(Mock(), SimpleNamespace(), client)
        with pytest.raises(HTTPException) as error:
            await executor.thumbnail("org", "user", "external")
        assert error.value.status_code == 404
