from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator
from db.models import ConditionField, ConditionOperator


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EmailDTO(DTO):
    email: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        from email.headerregistry import Address
        import re

        try:
            address = Address(addr_spec=value)
            domain = address.domain.encode("idna").decode()
            labels = domain.split(".")
            if (
                value != value.strip()
                or len(value) > 254
                or not address.username
                or len(address.username) > 64
                or len(labels) < 2
                or any(
                    not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?", label)
                    or len(label) > 63
                    for label in labels
                )
                or not re.fullmatch(r"[A-Za-z]{2,}|xn--[A-Za-z0-9-]+", labels[-1])
            ):
                raise ValueError
        except (ValueError, UnicodeError):
            raise ValueError("email must be an email") from None
        return value


class OnboardDTO(EmailDTO):
    displayName: str | None = None
    provider: str = Field(min_length=1)
    emailVerified: bool | None = None
    providerAccountId: str | None = None
    refreshToken: str | None = Field(default=None, repr=False)
    scopes: list[str] | None = None


class CredentialsDTO(EmailDTO):
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128, repr=False)


class RegisterDTO(CredentialsDTO):
    displayName: str = Field(min_length=1, max_length=120)


class PasswordDTO(DTO):
    password: str = Field(min_length=12, max_length=128, repr=False)


class OrganizationDTO(DTO):
    name: str = Field(min_length=1, max_length=120)
    ownerEmail: str

    @field_validator("ownerEmail")
    @classmethod
    def valid_email(cls, value):
        return EmailDTO.valid_email(value)


class RootDTO(DTO):
    folderExternalId: str


class LaunchDTO(DTO):
    itemExternalId: str


class ConfirmDTO(DTO):
    overrideDestinationPath: str | None = Field(default=None, pattern=r"^/")
    destinationFolderExternalId: str | None = None
    finalName: str | None = None


class ConditionDTO(DTO):
    field: ConditionField = Field(strict=False)
    operator: ConditionOperator = Field(strict=False)
    value: str = Field(min_length=1)


class RuleDTO(DTO):
    priority: int = Field(ge=1)
    destinationPath: str = Field(pattern=r"^/")
    suggestedNameTemplate: str | None = None
    conditions: list[ConditionDTO] = Field(min_length=1)


class LlmDTO(DTO):
    provider: Literal["anthropic", "openai", "mistral", "openai-compatible"]
    apiKey: str = Field(min_length=1, max_length=500, repr=False)
    model: str | None = Field(default=None, max_length=200)
    baseUrl: str | None = Field(default=None, max_length=500)

    @field_validator("baseUrl")
    @classmethod
    def valid_url(cls, value):
        if value is not None:
            parsed = urlsplit(value)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise ValueError("baseUrl must be a URL address")
        return value
