from functools import lru_cache
from pathlib import Path
from typing import ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# Provider identifiers used to route a model to the right API client.
PROVIDER_FPT = "fpt"
PROVIDER_TOKENROUTER = "tokenrouter"


class ModelOption:
    """A selectable model exposed to the frontend.

    ``label`` is the user-facing name shown in the picker (no provider),
    ``id`` is the value sent to the provider API, ``provider`` selects the client.
    """

    def __init__(self, model_id: str, label: str, provider: str) -> None:
        self.id = model_id
        self.label = label
        self.provider = provider


# Single source of truth for the models the app supports.
MODEL_CATALOG: list[ModelOption] = [
    ModelOption("gemma-4-31B-it", "Gemma 4", PROVIDER_FPT),
    ModelOption("gpt-oss-120b", "GPT OSS", PROVIDER_FPT),
    ModelOption("DeepSeek-V4-Flash", "DeepSeek V4 Flash", PROVIDER_FPT),
    ModelOption("MiniMax-M3", "MiniMax M3", PROVIDER_TOKENROUTER),
]

MODELS_BY_ID: dict[str, ModelOption] = {option.id: option for option in MODEL_CATALOG}


def resolve_model(model_id: str | None, default_model_id: str) -> ModelOption:
    """Return the catalog entry for ``model_id`` or fall back to the default."""

    if model_id and model_id in MODELS_BY_ID:
        return MODELS_BY_ID[model_id]
    return MODELS_BY_ID.get(default_model_id, MODEL_CATALOG[0])


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
    tokenrouter_api_key: str = Field(default="", alias="TOKENROUTER_API_KEY")
    tokenrouter_base_url: str = Field(default="https://api.tokenrouter.com/v1", alias="TOKENROUTER_BASE_URL")
    tokenrouter_model: str = Field(default="MiniMax-M3", alias="TOKENROUTER_MODEL")
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
