from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KLASR_", env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/klasr",
        validation_alias=AliasChoices("KLASR_DATABASE_URL", "DATABASE_URL"),
    )
    mongo_url: str = "mongodb://localhost:27017"
    mongo_database: str = "klasr"
    analyses_ttl_days: int = 30
    inline_worker: bool = False
    worker: bool = False
    local_mvp: bool = False
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
            for name in ("local_mvp", "inline_worker", "acceptance_google_service_account"):
                if getattr(self, name):
                    raise ValueError(f"KLASR_{name.upper()} cannot run in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
