from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.ai_client import FptAiChatClient
from app.config import Settings, get_settings
from app.history import ChatHistoryRepository
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ConversationHistoryResponse,
    ConversationListResponse,
    HealthResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.history = ChatHistoryRepository(settings)
    app.state.ai_client = FptAiChatClient(settings)
    yield


app = FastAPI(title="Clevel Go API", version="0.1.0", lifespan=lifespan)
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_history() -> ChatHistoryRepository:
    return app.state.history


def get_ai_client() -> FptAiChatClient:
    return app.state.ai_client


@app.get("/api/health", response_model=HealthResponse)
def health(
    config: Annotated[Settings, Depends(get_settings)],
    history: Annotated[ChatHistoryRepository, Depends(get_history)],
) -> HealthResponse:
    mongodb_status = "ok"
    try:
        history.ping()
    except Exception:
        mongodb_status = "error"

    return HealthResponse(status="ok", model=config.fpt_ai_model, mongodb=mongodb_status)


@app.post("/api/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    history: Annotated[ChatHistoryRepository, Depends(get_history)],
    ai_client: Annotated[FptAiChatClient, Depends(get_ai_client)],
) -> ChatResponse:
    conversation_id = payload.conversation_id or str(uuid4())
    existing_conversation = history.get_conversation(conversation_id)
    is_new_conversation = existing_conversation is None
    if is_new_conversation:
        history.ensure_conversation(conversation_id, payload.message.strip())

    user_message = history.add_message(conversation_id, "user", payload.message.strip())
    recent_messages = history.get_recent_messages(conversation_id)

    try:
        assistant_content = ai_client.complete(recent_messages)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Model provider request failed") from exc

    if not assistant_content:
        raise HTTPException(status_code=502, detail="Model provider returned an empty response")

    assistant_message = history.add_message(conversation_id, "assistant", assistant_content)
    conversation = history.get_conversation(conversation_id)

    if is_new_conversation:
        try:
            title = ai_client.title_conversation(payload.message.strip(), assistant_content)
        except Exception:
            title = payload.message.strip()
        conversation = history.set_conversation_title(conversation_id, title)

    if conversation is None:
        conversation = history.ensure_conversation(conversation_id, payload.message.strip())

    return ChatResponse(
        conversation_id=conversation_id,
        content=assistant_content,
        messages=[user_message, assistant_message],
        conversation=conversation,
    )


@app.get("/api/conversations", response_model=ConversationListResponse)
def conversations(
    history: Annotated[ChatHistoryRepository, Depends(get_history)],
) -> ConversationListResponse:
    return ConversationListResponse(conversations=history.list_conversations(limit=100))


@app.get("/api/conversations/{conversation_id}", response_model=ConversationHistoryResponse)
def conversation_history(
    conversation_id: str,
    history: Annotated[ChatHistoryRepository, Depends(get_history)],
) -> ConversationHistoryResponse:
    return ConversationHistoryResponse(
        conversation_id=conversation_id,
        conversation=history.get_conversation(conversation_id),
        messages=history.get_messages(conversation_id, limit=200),
    )
