from functools import lru_cache

from pydantic import AliasChoices, field_validator, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KLASR_", env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/klasr",
        validation_alias=AliasChoices("KLASR_DATABASE_URL", "DATABASE_URL"),
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def rewrite_bare_postgresql_scheme(cls, v: str) -> str:
        """Rewrite bare postgresql:// or postgres:// to use psycopg3 driver."""
        if isinstance(v, str):
            if v.startswith("postgresql://"):
                return "postgresql+psycopg://" + v[len("postgresql://") :]
            if v.startswith("postgres://"):
                return "postgresql+psycopg://" + v[len("postgres://") :]
        return v

    analyses_ttl_days: int = 30
    analyses_purge_interval_seconds: int = 60
    inline_worker: bool = False
    worker: bool = False
    acceptance_google_service_account: bool = False
    google_service_account_file: str = ""
    google_drive_root_id: str = "root"
    internal_api_secret: str = Field(default="", validation_alias="INTERNAL_API_SECRET")
    token_encryption_key: str = Field(default="", validation_alias="TOKEN_ENCRYPTION_KEY")
    google_client_id: str = Field(default="", validation_alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="", validation_alias="GOOGLE_CLIENT_SECRET")
    node_env: str = Field(default="development", validation_alias="NODE_ENV")
    llm_timeout_ms: int = 10000
    llm_allowed_origins: str = ""

    def validate_runtime(self):
        if self.node_env == "production":
            for name in ("inline_worker", "acceptance_google_service_account"):
                if getattr(self, name):
                    raise ValueError(f"KLASR_{name.upper()} cannot run in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
