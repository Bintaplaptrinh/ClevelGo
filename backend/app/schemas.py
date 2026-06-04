from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


MessageRole = Literal["system", "user", "assistant"]


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1, max_length=12000)
    conversation_id: str | None = Field(default=None, alias="conversationId")


class ChatMessage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    conversation_id: str = Field(alias="conversationId")
    role: MessageRole
    content: str
    created_at: datetime = Field(alias="createdAt")
    status: Literal["completed", "failed"] = "completed"


class ConversationSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    message_count: int = Field(alias="messageCount")
    last_message_preview: str = Field(default="", alias="lastMessagePreview")
    pinned: bool = False
    archived: bool = False


class ChatResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    conversation_id: str = Field(alias="conversationId")
    content: str
    messages: list[ChatMessage]
    conversation: ConversationSummary


class ConversationHistoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    conversation_id: str = Field(alias="conversationId")
    conversation: ConversationSummary | None = None
    messages: list[ChatMessage]


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model: str
    mongodb: Literal["ok", "error"]
