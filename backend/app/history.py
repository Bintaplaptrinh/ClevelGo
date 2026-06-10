from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pymongo import DESCENDING, MongoClient
from pymongo.collection import Collection

from app.config import Settings
from app.schemas import AttachmentSummary, ChatMessage, ChatWidget, CitationSource, ConversationSummary, MessageRole


class ChatHistoryRepository:
    """Stores Gemini/ChatGPT-style conversation documents.

    MongoDB document shape:
    {
      _id: "conversation-uuid",
      title: "Short AI generated title",
      created_at: datetime,
      updated_at: datetime,
      message_count: 2,
      last_message_preview: "...",
      archived: false,
      pinned: false,
      messages: [
        {
          id: "message-uuid",
          role: "user" | "assistant",
          content: "...",
          created_at: datetime,
          status: "completed"
        }
      ]
    }
    """

    def __init__(self, settings: Settings) -> None:
        self._client: MongoClient[dict[str, Any]] = MongoClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=5000,
            uuidRepresentation="standard",
        )
        self._conversations: Collection[dict[str, Any]] = self._client[settings.mongodb_db_name][
            settings.mongodb_conversations_collection
        ]
        self._conversations.create_index([("updated_at", DESCENDING)])
        self._conversations.create_index([("archived", DESCENDING), ("updated_at", DESCENDING)])

    def ping(self) -> bool:
        self._client.admin.command("ping")
        return True

    def ensure_conversation(self, conversation_id: str, title: str) -> ConversationSummary:
        now = datetime.now(UTC)
        self._conversations.update_one(
            {"_id": conversation_id},
            {
                "$setOnInsert": {
                    "title": self._clean_title(title),
                    "created_at": now,
                    "updated_at": now,
                    "message_count": 0,
                    "last_message_preview": "",
                    "archived": False,
                    "pinned": False,
                    "messages": [],
                },
            },
            upsert=True,
        )
        conversation = self.get_conversation(conversation_id)
        if conversation is None:
            raise RuntimeError("Conversation could not be created")

        return conversation

    def add_message(
        self,
        conversation_id: str,
        role: MessageRole,
        content: str,
        *,
        citations: list[CitationSource] | None = None,
        widgets: list[ChatWidget] | None = None,
        attachments: list[AttachmentSummary] | None = None,
    ) -> ChatMessage:
        now = datetime.now(UTC)
        message = {
            "id": str(uuid4()),
            "role": role,
            "content": content,
            "created_at": now,
            "status": "completed",
            "citations": [citation.model_dump(by_alias=True) for citation in citations or []],
            "widgets": [widget.model_dump(by_alias=True) for widget in widgets or []],
            "attachments": [attachment.model_dump(by_alias=True) for attachment in attachments or []],
        }
        self.ensure_conversation(conversation_id, content)
        self._conversations.update_one(
            {"_id": conversation_id},
            {
                "$push": {"messages": message},
                "$set": {
                    "updated_at": now,
                    "last_message_preview": self._preview(content),
                },
                "$inc": {"message_count": 1},
            },
        )
        return self._to_message(conversation_id, message)

    def get_conversation(self, conversation_id: str) -> ConversationSummary | None:
        document = self._conversations.find_one({"_id": conversation_id, "archived": {"$ne": True}})
        return self._to_conversation(document) if document else None

    def set_conversation_title(self, conversation_id: str, title: str) -> ConversationSummary:
        now = datetime.now(UTC)
        self._conversations.update_one(
            {"_id": conversation_id},
            {
                "$set": {
                    "title": self._clean_title(title),
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                    "message_count": 0,
                    "last_message_preview": "",
                    "archived": False,
                    "pinned": False,
                    "messages": [],
                },
            },
            upsert=True,
        )
        conversation = self.get_conversation(conversation_id)
        if conversation is None:
            raise RuntimeError("Conversation title could not be saved")

        return conversation

    def delete_conversation(self, conversation_id: str) -> bool:
        result = self._conversations.delete_one({"_id": conversation_id})
        return result.deleted_count > 0

    def list_conversations(self, limit: int = 100) -> list[ConversationSummary]:
        cursor = (
            self._conversations.find({"archived": {"$ne": True}})
            .sort([("pinned", DESCENDING), ("updated_at", DESCENDING)])
            .limit(limit)
        )
        return [self._to_conversation(document) for document in cursor]

    def get_recent_messages(self, conversation_id: str, limit: int = 20) -> list[ChatMessage]:
        document = self._conversations.find_one(
            {"_id": conversation_id, "archived": {"$ne": True}},
            {"messages": {"$slice": -limit}},
        )
        if not document:
            return []

        return [self._to_message(conversation_id, message) for message in document.get("messages", [])]

    def get_messages(self, conversation_id: str, limit: int = 200) -> list[ChatMessage]:
        document = self._conversations.find_one(
            {"_id": conversation_id, "archived": {"$ne": True}},
            {"messages": {"$slice": -limit}},
        )
        if not document:
            return []

        return [self._to_message(conversation_id, message) for message in document.get("messages", [])]

    def _to_message(self, conversation_id: str, message: dict[str, Any]) -> ChatMessage:
        return ChatMessage(
            id=str(message["id"]),
            conversation_id=conversation_id,
            role=message["role"],
            content=message["content"],
            created_at=message["created_at"],
            status=message.get("status", "completed"),
            citations=[CitationSource.model_validate(item) for item in message.get("citations", [])],
            widgets=[ChatWidget.model_validate(item) for item in message.get("widgets", [])],
            attachments=[AttachmentSummary.model_validate(item) for item in message.get("attachments", [])],
        )

    def _to_conversation(self, document: dict[str, Any]) -> ConversationSummary:
        return ConversationSummary(
            id=str(document["_id"]),
            title=document.get("title") or "Untitled conversation",
            created_at=document["created_at"],
            updated_at=document["updated_at"],
            message_count=int(document.get("message_count", 0)),
            last_message_preview=document.get("last_message_preview", ""),
            pinned=bool(document.get("pinned", False)),
            archived=bool(document.get("archived", False)),
        )

    def _clean_title(self, title: str) -> str:
        cleaned = " ".join(title.strip().strip("\"'`").split())
        if not cleaned:
            return "Untitled conversation"
        if len(cleaned) > 72:
            return f"{cleaned[:69].rstrip()}..."
        return cleaned

    def _preview(self, content: str) -> str:
        preview = " ".join(content.strip().split())
        if len(preview) > 160:
            return f"{preview[:157].rstrip()}..."
        return preview
