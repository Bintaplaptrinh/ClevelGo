from functools import lru_cache
from pathlib import Path
from typing import ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    default_cors_origins: ClassVar[str] = (
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "https://clevelgo.pages.dev,"
        "https://bintaplaptrinh.io.vn"
    )
    fpt_ai_api_key: str = Field(alias="FPT_AI_API_KEY")
    fpt_ai_base_url: str = Field(default="https://mkp-api.fptcloud.com", alias="FPT_AI_BASE_URL")
    fpt_ai_model: str = Field(default="gpt-oss-120b", alias="FPT_AI_MODEL")
    mongodb_uri: str = Field(alias="MONGODB_URI")
    mongodb_db_name: str = Field(default="clevel_go", alias="MONGODB_DB_NAME")
    mongodb_conversations_collection: str = Field(
        default="conversations",
        alias="MONGODB_CONVERSATIONS_COLLECTION",
    )
    allowed_origins: str = Field(
        default=default_cors_origins,
        alias="ALLOWED_ORIGINS",
    )

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        configured_origins = self.allowed_origins.split(",")
        default_origins = self.default_cors_origins.split(",")

        origins: list[str] = []
        for origin in [*configured_origins, *default_origins]:
            normalized_origin = origin.strip().strip("'\"").rstrip("/")
            if normalized_origin and normalized_origin not in origins:
                origins.append(normalized_origin)

        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
