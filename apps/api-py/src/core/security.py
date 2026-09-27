import base64
import hashlib
import hmac
import os
import re

import bcrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Request

DUMMY_PASSWORD_HASH = b"$2b$12$yuR8xkWWsAfobvFldfSncuL.syXJJ2EdCMj0ZTk7i3..fYZKTvTrO"


def internal_service_guard(request: Request):
    expected = request.app.state.settings.internal_api_secret
    provided = request.headers.get("x-internal-secret")
    if (
        not expected
        or not provided
        or not hmac.compare_digest(
            hashlib.sha256(expected.encode()).digest(), hashlib.sha256(provided.encode()).digest()
        )
    ):
        raise HTTPException(401, "Invalid internal service credentials")


def hash_password(password: str) -> str:
    # Nest bcrypt truncates UTF-8 passwords at 72 bytes, including multibyte characters.
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def password_matches(password: str, encoded: str | None) -> bool:
    return bcrypt.checkpw(
        password.encode()[:72], encoded.encode() if encoded else DUMMY_PASSWORD_HASH
    )


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class TokenEncryptionService:
    def __init__(self, raw: str):
        try:
            key = (
                bytes.fromhex(raw)
                if re.fullmatch(r"[a-fA-F0-9]{64}", raw)
                else base64.b64decode(raw, validate=True)
            )
        except ValueError:
            key = b""
        if len(key) != 32:
            raise ValueError("TOKEN_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex characters")
        self.cipher = AESGCM(key)

    def encrypt(self, value: str) -> str:
        iv = os.urandom(12)
        encrypted = self.cipher.encrypt(iv, value.encode(), None)
        return ".".join(["v1", encode(iv), encode(encrypted[-16:]), encode(encrypted[:-16])])

    def decrypt(self, value: str) -> str:
        try:
            version, iv, tag, ciphertext = value.split(".")
            if version != "v1" or len(decode(iv)) != 12 or len(decode(tag)) != 16:
                raise ValueError
            return self.cipher.decrypt(decode(iv), decode(ciphertext) + decode(tag), None).decode()
        except Exception:
            raise ValueError("Token decrypt failed") from None
