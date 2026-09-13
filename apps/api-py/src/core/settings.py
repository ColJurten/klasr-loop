from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KLASR_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./klasr.db"
    mongo_url: str = "mongodb://localhost:27017"
    mongo_database: str = "klasr"
    analyses_ttl_days: int = 30
    inline_worker: bool = False
    worker: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
