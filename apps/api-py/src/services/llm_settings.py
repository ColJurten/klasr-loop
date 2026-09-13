import asyncio
import ipaddress
import json
import socket
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import HTTPException
from core.security import TokenEncryptionService
from repositories.llm_settings import LlmSettingsRepository
from repositories.serialization import serialize

BASES = {
    "anthropic": "https://api.anthropic.com/v1",
    "openai": "https://api.openai.com/v1",
    "mistral": "https://api.mistral.ai/v1",
}
ERRORS = [
    ("provider_unauthorized", "invalid_key", "Clé API refusée par le fournisseur."),
    ("provider_model_not_found", "model_not_accessible", "Le modèle sélectionné est inaccessible."),
    (
        "provider_model_incompatible",
        "model_incompatible",
        "Le modèle sélectionné n’est pas compatible avec les requêtes"
        " Klasr. Choisissez un autre modèle.",
    ),
    (
        "provider_rate_limited",
        "rate_limited",
        "Limite du fournisseur atteinte. Réessayez plus tard.",
    ),
    ("provider_timeout", "timeout", "Le fournisseur ne répond pas dans le délai imparti."),
    ("provider_network", "network_error", "Le fournisseur est inaccessible."),
    ("provider_unsafe", "unsafe_endpoint", "Cette adresse de fournisseur est interdite."),
    ("provider_response_too_large", "malformed_response", "Réponse du fournisseur invalide."),
    ("provider_malformed_response", "malformed_response", "Réponse du fournisseur invalide."),
]


def mapped(error):
    _, code, message = next(
        (item for item in ERRORS if str(error).startswith(item[0])),
        ("provider_unavailable", "endpoint_unavailable", "Point d’accès fournisseur indisponible."),
    )
    return HTTPException(400, dict(code=code, message=message))


def status_error(status, phase):
    if status in (401, 403):
        return ValueError("provider_unauthorized")
    if status == 404:
        return ValueError("provider_model_not_found")
    if status == 429:
        return ValueError("provider_rate_limited")
    if phase == "validation" and status in (400, 422):
        return ValueError("provider_model_incompatible")
    return ValueError("provider_unavailable")


class ProviderClientService:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client

    async def endpoint(self, config):
        raw = (
            config.get("baseUrl")
            if config["provider"] == "openai-compatible"
            else BASES.get(config["provider"])
        )
        try:
            url = urlsplit(raw or "")
            if (
                url.scheme not in ("https", "http")
                or not url.hostname
                or url.username
                or url.password
            ):
                raise ValueError
            _ = url.port
        except ValueError:
            raise ValueError("provider_unsafe_endpoint") from None
        if config["provider"] == "openai-compatible":
            host = url.hostname
            try:
                ip = ipaddress.ip_address(host)
                local = ip.is_loopback
            except ValueError:
                local = host == "localhost"
            if not (local and (self.settings.node_env == "test" or self.settings.local_mvp)):
                origin = f"{url.scheme}://{url.netloc}"
                if (
                    url.scheme != "https"
                    or local
                    or (
                        self.settings.node_env == "production"
                        and origin
                        not in [v.strip() for v in self.settings.llm_allowed_origins.split(",")]
                    )
                ):
                    raise ValueError("provider_unsafe_endpoint")
                try:
                    addresses = await asyncio.to_thread(
                        socket.getaddrinfo, host, url.port or 443, type=socket.SOCK_STREAM
                    )
                except OSError:
                    addresses = []
                if not addresses or any(
                    not ipaddress.ip_address(row[4][0]).is_global for row in addresses
                ):
                    raise ValueError("provider_unsafe_endpoint")
        return urlunsplit((url.scheme, url.netloc, url.path.rstrip("/"), "", ""))

    async def request(self, config, path, body=None, phase="discovery"):
        base = await self.endpoint(config)
        headers = (
            {"x-api-key": config["apiKey"], "anthropic-version": "2023-06-01"}
            if config["provider"] == "anthropic"
            else {"authorization": "Bearer " + config["apiKey"]}
        )
        try:
            async with self.client.stream(
                "POST" if body is not None else "GET",
                base + "/" + path,
                headers=headers,
                json=body,
                follow_redirects=False,
                timeout=self.settings.llm_timeout_ms / 1000,
            ) as response:
                if 300 <= response.status_code < 400:
                    raise ValueError("provider_unsafe_redirect")
                if not response.is_success:
                    raise status_error(response.status_code, phase)
                if int(response.headers.get("content-length", 0)) > 1_000_000:
                    raise ValueError("provider_response_too_large")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(data) + len(chunk) > 1_000_000:
                        raise ValueError("provider_response_too_large")
                    data.extend(chunk)
        except httpx.TimeoutException:
            raise ValueError("provider_timeout") from None
        except httpx.HTTPError:
            raise ValueError("provider_network") from None
        try:
            return json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise ValueError("provider_malformed_response") from None

    async def discover(self, config):
        body = await self.request(config, "models")
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            raise ValueError("provider_malformed_response")
        return sorted(
            {
                item["id"].strip()
                for item in body["data"]
                if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip()
            }
        )

    async def validate(self, config):
        if not config.get("model"):
            raise ValueError("provider_model_not_found")
        await self.request(
            config,
            "messages" if config["provider"] == "anthropic" else "chat/completions",
            dict(
                model=config["model"],
                max_tokens=1,
                messages=[dict(role="user", content="Reply with {}.")],
            ),
            "validation",
        )

    async def completion(self, config, messages):
        if isinstance(messages, str):
            messages = [dict(role="user", content=messages)]
        body = dict(model=config["model"], max_tokens=2048, messages=messages)
        if config["provider"] == "anthropic":
            system = "\n".join(str(m["content"]) for m in messages if m["role"] == "system")
            body["messages"] = [m for m in messages if m["role"] != "system"]
            if system:
                body["system"] = system
        data = await self.request(
            config,
            "messages" if config["provider"] == "anthropic" else "chat/completions",
            body,
            "validation",
        )
        try:
            result = (
                data["content"][0]["text"]
                if config["provider"] == "anthropic"
                else data["choices"][0]["message"]["content"]
            )
            if not isinstance(result, str) or not result:
                raise ValueError
            return result
        except (KeyError, IndexError, TypeError, ValueError):
            raise ValueError("provider_malformed_response") from None


class LlmSettingsService:
    def __init__(self, session, settings, providers):
        self.repository = LlmSettingsRepository(session)
        self.settings, self.providers = settings, providers

    def safe(self, row):
        return (
            serialize(
                dict(
                    configured=True,
                    provider=row.provider,
                    model=row.model,
                    baseUrl=row.base_url,
                    validatedAt=row.validated_at,
                    status=row.status,
                )
            )
            if row and row.status == "VALID"
            else {"configured": False}
        )

    def get(self, organization_id):
        return self.safe(self.repository.find(organization_id))

    def normalized(self, dto):
        config = {
            key: value.strip() if isinstance(value, str) else value
            for key, value in dto.model_dump().items()
        }
        if not config["apiKey"] or config["provider"] not in (*BASES, "openai-compatible"):
            raise HTTPException(
                400, dict(code="invalid_request", message="Fournisseur et clé API requis.")
            )
        return config

    async def discover(self, dto):
        config = self.normalized(dto)
        try:
            models = await self.providers.discover(config)
            if not models:
                raise ValueError("provider_malformed_response")
            return {"models": models}
        except Exception as error:
            raise mapped(error) from None

    async def save(self, organization_id, dto):
        config = self.normalized(dto)
        try:
            if not config.get("model"):
                raise ValueError("provider_model_not_found")
            base = await self.providers.endpoint(config)
            await self.providers.validate(config)
            row = self.repository.upsert(
                organization_id,
                provider=config["provider"],
                model=config["model"],
                base_url=base,
                encrypted_api_key=TokenEncryptionService(
                    self.settings.token_encryption_key
                ).encrypt(config["apiKey"]),
                status="VALID",
                validated_at=datetime.now(timezone.utc),
            )
            return self.safe(row)
        except Exception as error:
            raise mapped(error) from None

    def remove(self, organization_id):
        self.repository.delete(organization_id)
        return {"configured": False}

    def resolve(self, organization_id):
        row = self.repository.find(organization_id)
        if not row or row.status != "VALID":
            return None
        return dict(
            provider=row.provider,
            model=row.model,
            baseUrl=row.base_url,
            apiKey=TokenEncryptionService(self.settings.token_encryption_key).decrypt(
                row.encrypted_api_key
            ),
        )
