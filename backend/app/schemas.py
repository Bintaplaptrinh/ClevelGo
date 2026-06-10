from datetime import datetime
from typing import Any
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


MessageRole = Literal["system", "user", "assistant"]


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1, max_length=12000)
    conversation_id: str | None = Field(default=None, alias="conversationId")


class CitationSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    title: str
    url: str | None = None
    snippet: str = ""
    source_type: Literal["web", "url", "file"] = Field(default="web", alias="sourceType")


class ChatWidget(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    widget_type: Literal["time", "weather"] = Field(alias="widgetType")
    title: str
    data: dict[str, Any]


class AttachmentSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    mime_type: str = Field(alias="mimeType")
    size: int
    summary: str = ""


class ChatMessage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    conversation_id: str = Field(alias="conversationId")
    role: MessageRole
    content: str
    created_at: datetime = Field(alias="createdAt")
    status: Literal["completed", "failed"] = "completed"
    citations: list[CitationSource] = Field(default_factory=list)
    widgets: list[ChatWidget] = Field(default_factory=list)
    attachments: list[AttachmentSummary] = Field(default_factory=list)


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
    citations: list[CitationSource] = Field(default_factory=list)
    widgets: list[ChatWidget] = Field(default_factory=list)
    attachments: list[AttachmentSummary] = Field(default_factory=list)


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
