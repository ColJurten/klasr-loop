import base64
import json
import subprocess

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.security import TokenEncryptionService, DUMMY_PASSWORD_HASH, password_matches
from core.settings import Settings
from db.models import LlmSetting
from services.llm_settings import ProviderClientService

ROUTES = [
    ("POST", "/auth/onboarding"),
    ("POST", "/auth/register"),
    ("POST", "/auth/credentials"),
    ("GET", "/auth/local-password"),
    ("POST", "/auth/local-password"),
    ("POST", "/organizations"),
    ("GET", "/organizations/org"),
    ("GET", "/organizations/org/dashboard"),
    ("GET", "/organizations/org/documents"),
    ("GET", "/organizations/org/documents/doc"),
    ("GET", "/organizations/org/proposals"),
    ("POST", "/organizations/org/proposals/proposal/confirm"),
    ("POST", "/organizations/org/proposals/proposal/ignore"),
    ("POST", "/organizations/org/sync"),
    ("GET", "/organizations/org/rules"),
    ("POST", "/organizations/org/rules"),
    ("GET", "/organizations/org/llm-settings"),
    ("POST", "/organizations/org/llm-settings/models"),
    ("PUT", "/organizations/org/llm-settings"),
    ("DELETE", "/organizations/org/llm-settings"),
    ("GET", "/organizations/org/drive/reference-folders"),
    ("POST", "/organizations/org/drive/reference-root"),
    ("GET", "/organizations/org/drive/input-items"),
    ("GET", "/organizations/org/drive/items"),
    ("POST", "/organizations/org/drive/launch"),
]


def test_every_domain_route_fails_closed_before_body_or_database(api):
    client, app, _ = api
    for prefix in ("", "/api/v1"):
        for method, path in ROUTES:
            response = client.request(method, prefix + path, headers={"x-internal-secret": ""})
            assert response.status_code == 401, (method, path, response.text)
            assert response.json()["message"] == "Invalid internal service credentials"
    for expected, supplied in [
        ("", "test-internal"),
        ("test-internal", ""),
        ("test-internal", "wrong"),
        ("test-internal", "x" * 2000),
    ]:
        app.state.settings.internal_api_secret = expected
        assert (
            client.get("/organizations/org", headers={"x-internal-secret": supplied}).status_code
            == 401
        )
    for prefix in ("", "/api/v1"):
        assert client.get(prefix + "/health", headers={"x-internal-secret": ""}).json() == {
            "status": "ok"
        }


def test_encryption_node_interoperability_and_tampering():
    key = bytes(range(32))
    encryption = TokenEncryptionService(key.hex())
    assert DUMMY_PASSWORD_HASH == b"$2b$12$yuR8xkWWsAfobvFldfSncuL.syXJJ2EdCMj0ZTk7i3..fYZKTvTrO"
    assert not password_matches("wrong password", None)
    # Synthetic key only. Exercise actual Node crypto in both directions.
    script = r"""
const crypto = require('node:crypto');
const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const key = Buffer.from(input.key, 'hex');
const [version, iv, tag, ciphertext] = input.envelope.split('.');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
decipher.setAuthTag(Buffer.from(tag, 'base64url'));
// noqa: E501
const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()
]).toString();
const nonce = Buffer.alloc(12, 7);
const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const parts = ['v1', nonce.toString('base64url'),
               cipher.getAuthTag().toString('base64url'),
               encrypted.toString('base64url')];
console.log(JSON.stringify({plaintext, envelope: parts.join('.')}));
"""
    result = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"key": key.hex(), "envelope": encryption.encrypt("synthetic é secret")}),
        text=True,
        capture_output=True,
        check=True,
    )
    result = json.loads(result.stdout)
    assert result["plaintext"] == "synthetic é secret"
    assert (
        TokenEncryptionService(base64.b64encode(key).decode()).decrypt(result["envelope"])
        == result["plaintext"]
    )
    parts = result["envelope"].split(".")
    parts[2] = "A" * 22
    for envelope in (
        ".".join(parts),
        result["envelope"].replace("v1.", "v2."),
        "v1.bad.bad.bad",
        result["envelope"] + ".extra",
    ):
        with pytest.raises(ValueError, match="Token decrypt failed"):
            encryption.decrypt(envelope)
    with pytest.raises(ValueError, match="32 bytes"):
        TokenEncryptionService("bad")


def test_llm_crud_discovery_safe_output_and_tenant(tenant):
    client, app, engine, identity, base = tenant
    requests = []

    def transport(request):
        requests.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "model-b"}, {"id": "model-a"}, {"id": "model-a"}, {"id": ""}]
                },
            )
        assert json.loads(request.content)["max_tokens"] == 1
        return httpx.Response(200, json={"choices": []})

    app.state.providers = ProviderClientService(
        app.state.settings, httpx.AsyncClient(transport=httpx.MockTransport(transport))
    )
    path = base + "/llm-settings"
    dto = dict(provider="openai", apiKey="synthetic-provider-key", model="model-a")
    assert client.get(path).json() == {"configured": False}
    response = client.post(path + "/models", json=dto)
    assert response.status_code == 201 and response.json() == {"models": ["model-a", "model-b"]}
    response = client.put(path, json=dto)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert set(saved) == {"configured", "provider", "model", "baseUrl", "validatedAt", "status"}
    assert saved["configured"] is True and saved["baseUrl"] == "https://api.openai.com/v1"
    assert client.get(path).json() == saved
    with Session(engine) as session:
        row = session.scalar(select(LlmSetting))
        assert row.encrypted_api_key.startswith("v1.") and "synthetic" not in row.encrypted_api_key
    assert client.get("/organizations/other/llm-settings").json() == {"configured": False}
    assert client.delete("/organizations/other/llm-settings").status_code == 200
    assert client.get(path).json()["configured"]
    assert client.delete(path).json() == {"configured": False}
    assert client.get(path).json() == {"configured": False}
    assert all(
        request.headers["authorization"] == "Bearer synthetic-provider-key" for request in requests
    )


@pytest.mark.parametrize(
    "status,code,message",
    [
        (401, "invalid_key", "Clé API refusée par le fournisseur."),
        (403, "invalid_key", "Clé API refusée par le fournisseur."),
        (404, "model_not_accessible", "Le modèle sélectionné est inaccessible."),
        (429, "rate_limited", "Limite du fournisseur atteinte. Réessayez plus tard."),
        (
            400,
            "model_incompatible",
            "Le modèle sélectionné n’est pas compatible avec les requêtes"
            " Klasr. Choisissez un autre modèle.",
        ),
        (
            422,
            "model_incompatible",
            "Le modèle sélectionné n’est pas compatible avec les requêtes"
            " Klasr. Choisissez un autre modèle.",
        ),
        (500, "endpoint_unavailable", "Point d’accès fournisseur indisponible."),
    ],
)
def test_provider_mapped_errors(tenant, status, code, message):
    client, app, _, _, base = tenant
    app.state.providers = ProviderClientService(
        app.state.settings,
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(status, json={"secret": "must not be reflected"})
            )
        ),
    )
    response = client.put(
        base + "/llm-settings", json=dict(provider="openai", apiKey="synthetic", model="m")
    )
    assert response.status_code == 400 and response.json() == dict(code=code, message=message)
    assert client.get(base + "/llm-settings").json() == {"configured": False}
    if status in (400, 422):
        assert (
            client.post(
                base + "/llm-settings/models", json=dict(provider="openai", apiKey="synthetic")
            ).json()["code"]
            == "endpoint_unavailable"
        )


@pytest.mark.asyncio
async def test_provider_bounds_discovery_anthropic_and_network_errors():
    settings = Settings(NODE_ENV="test")
    config = dict(provider="anthropic", apiKey="synthetic", model="model")

    def anthropic(request):
        assert request.headers["x-api-key"] == "synthetic"
        assert request.headers["anthropic-version"] == "2023-06-01"
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "claude"}]})
        return httpx.Response(200, json={"content": [{"text": "{}"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(anthropic)) as client:
        provider = ProviderClientService(settings, client)
        assert await provider.discover(config) == ["claude"]
        await provider.validate(config)
        assert await provider.completion(config, "synthetic prompt") == "{}"
    for response, reason in [
        (httpx.Response(302), "provider_unsafe"),
        (httpx.Response(200, content=b"x" * 1_000_001), "provider_response_too_large"),
        (httpx.Response(200, content=b"not-json"), "provider_malformed_response"),
        (httpx.Response(200, json={}), "provider_malformed_response"),
    ]:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _, r=response: r)
        ) as client:
            with pytest.raises(ValueError, match=reason):
                await ProviderClientService(settings, client).discover(config)
    for error, reason in [
        (httpx.ReadTimeout("private details"), "provider_timeout"),
        (httpx.ConnectError("private details"), "provider_network"),
    ]:

        def fail(_):
            raise error

        async with httpx.AsyncClient(transport=httpx.MockTransport(fail)) as client:
            with pytest.raises(ValueError, match=reason):
                await ProviderClientService(settings, client).discover(config)


@pytest.mark.asyncio
async def test_custom_endpoint_rejects_private_addresses_and_redirects(monkeypatch):
    settings = Settings(NODE_ENV="production")
    async with httpx.AsyncClient() as client:
        provider = ProviderClientService(settings, client)
        for url in [
            "http://localhost/v1",
            "https://127.0.0.1/v1",
            "https://169.254.169.254/latest",
            "file:///etc/passwd",
            "https://user:pass@public.example/v1",
            "https://public.example/v1",
        ]:
            with pytest.raises(ValueError, match="provider_unsafe"):
                await provider.endpoint(dict(provider="openai-compatible", baseUrl=url))
        settings.llm_allowed_origins = "https://public.example"
        monkeypatch.setattr(
            "socket.getaddrinfo", lambda *_args, **_kw: [(2, 1, 6, "", ("10.0.0.1", 443))]
        )
        with pytest.raises(ValueError, match="provider_unsafe"):
            await provider.endpoint(
                dict(provider="openai-compatible", baseUrl="https://public.example/v1")
            )
        settings.node_env = "test"
        assert (
            await provider.endpoint(
                dict(provider="openai-compatible", baseUrl="http://localhost:1234/v1/")
            )
            == "http://localhost:1234/v1"
        )
