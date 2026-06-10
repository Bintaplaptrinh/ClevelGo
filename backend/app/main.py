from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.ai_client import FptAiChatClient
from app.config import Settings, get_settings
from app.context_builder import prepare_context
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
async def chat(
    request: Request,
    history: Annotated[ChatHistoryRepository, Depends(get_history)],
    ai_client: Annotated[FptAiChatClient, Depends(get_ai_client)],
) -> ChatResponse:
    payload, uploads = await parse_chat_payload(request)
    conversation_id = payload.conversation_id or str(uuid4())
    existing_conversation = history.get_conversation(conversation_id)
    is_new_conversation = existing_conversation is None
    if is_new_conversation:
        history.ensure_conversation(conversation_id, payload.message.strip())

    context = await prepare_context(payload.message.strip(), uploads, client_timezone=payload.client_timezone)
    user_message = history.add_message(
        conversation_id,
        "user",
        payload.message.strip(),
        attachments=context.attachments,
    )

    if context.requires_sources and not context.sources:
        assistant_content = (
            "I could not verify this from fetched web sources, so I will not invent details. "
            "Please send an official link or upload a PDF source, and I can summarize it with citations."
        )
        assistant_message = history.add_message(
            conversation_id,
            "assistant",
            assistant_content,
            widgets=context.widgets,
        )
        conversation = history.get_conversation(conversation_id)
        if conversation is None:
            conversation = history.ensure_conversation(conversation_id, payload.message.strip())
        return ChatResponse(
            conversation_id=conversation_id,
            content=assistant_content,
            messages=[user_message, assistant_message],
            conversation=conversation,
            widgets=context.widgets,
            attachments=context.attachments,
        )

    recent_messages = history.get_recent_messages(conversation_id)

    try:
        assistant_content = ai_client.complete(
            recent_messages,
            source_prompt=context.source_prompt,
            widget_prompt=context.widget_prompt,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Model provider request failed") from exc

    if not assistant_content:
        raise HTTPException(status_code=502, detail="Model provider returned an empty response")

    assistant_content = ensure_source_markers(assistant_content, context.sources)
    assistant_message = history.add_message(
        conversation_id,
        "assistant",
        assistant_content,
        citations=context.sources,
        widgets=context.widgets,
    )
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
        citations=context.sources,
        widgets=context.widgets,
        attachments=context.attachments,
    )


async def parse_chat_payload(request: Request) -> tuple[ChatRequest, list[UploadFile]]:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        message = str(form.get("message") or "").strip()
        conversation_id = form.get("conversationId") or form.get("conversation_id")
        client_timezone = form.get("clientTimezone") or form.get("client_timezone")
        uploads = [item for item in form.getlist("files") if hasattr(item, "filename") and hasattr(item, "read")]
        try:
            payload = ChatRequest(
                message=message,
                conversationId=str(conversation_id) if conversation_id else None,
                clientTimezone=str(client_timezone) if client_timezone else None,
            )
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid chat request") from exc
        return payload, uploads

    try:
        payload = ChatRequest.model_validate(await request.json())
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid chat request") from exc
    return payload, []


def ensure_source_markers(content: str, sources: list) -> str:
    if not sources or any(f"[{source.id}]" in content for source in sources):
        return content
    markers = " ".join(f"[{source.id}]" for source in sources[:4])
    return f"{content.rstrip()}\n\nSources: {markers}"


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


@app.delete("/api/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str,
    history: Annotated[ChatHistoryRepository, Depends(get_history)],
) -> Response:
    history.delete_conversation(conversation_id)
    return Response(status_code=204)
