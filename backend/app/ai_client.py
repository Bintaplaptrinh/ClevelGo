from openai import OpenAI

from app.config import (
    PROVIDER_FPT,
    PROVIDER_TOKENROUTER,
    ModelOption,
    Settings,
    resolve_model,
)
from app.schemas import ChatMessage


SYSTEM_PROMPT = (
    "You are Clevel Go, a practical work assistant. "
    "Help with research, planning, writing, coding, analysis, document review, and task execution. "
    "Keep answers concrete, useful, and implementation-ready. "
    "Use clean Markdown when it improves readability: headings like ## Section title, **bold**, ***strong emphasis***, "
    "tables, bullet lists, numbered steps, code fences, and horizontal rules using --- . "
    "For simple bar charts, use a fenced chart block with JSON like "
    '```chart\\n{"title":"Rows by table","labels":["users"],"values":[120]}\\n```. '
    "When source context is provided, cite factual claims with bracket citations like [1]. "
    "Only cite sources that appear in the source context, and do not invent citation numbers. "
    "For external factual questions about real people, organizations, schools, locations, news, or policies, "
    "do not answer from memory when no source context is available. Say you cannot verify it instead."
)


class MultiProviderChatClient:
    """Routes chat completions to the right provider based on the selected model."""

    def __init__(self, settings: Settings) -> None:
        self._default_model = settings.fpt_ai_model
        self._clients: dict[str, OpenAI] = {
            PROVIDER_FPT: OpenAI(
                api_key=settings.fpt_ai_api_key,
                base_url=settings.fpt_ai_base_url,
            ),
        }

        # TokenRouter is optional; only wire it up when an API key is configured.
        if settings.tokenrouter_api_key:
            self._clients[PROVIDER_TOKENROUTER] = OpenAI(
                api_key=settings.tokenrouter_api_key,
                base_url=settings.tokenrouter_base_url,
            )

    @property
    def default_model(self) -> str:
        return self._default_model

    def _select(self, model_id: str | None) -> tuple[OpenAI, ModelOption]:
        option = resolve_model(model_id, self._default_model)
        client = self._clients.get(option.provider)
        if client is None:
            # Requested provider is not configured; fall back to the default model.
            option = resolve_model(self._default_model, self._default_model)
            client = self._clients[option.provider]
        return client, option

    def _completion_kwargs(self, option: ModelOption, *, source_prompt: str) -> dict:
        """Build provider-specific request parameters."""

        kwargs: dict = {
            "model": option.id,
            "temperature": 0.2 if source_prompt else 0.7,
            "max_tokens": 1600,
            "top_p": 1,
            "stream": True,
        }

        if option.provider == PROVIDER_FPT:
            kwargs["extra_body"] = {"top_k": 40}
            kwargs["presence_penalty"] = 0
            kwargs["frequency_penalty"] = 0
        else:
            # TokenRouter follows the standard OpenAI surface.
            kwargs["extra_body"] = {}
            kwargs["stream_options"] = {"include_usage": True}

        return kwargs

    def complete(
        self,
        history: list[ChatMessage],
        *,
        model: str | None = None,
        source_prompt: str = "",
        widget_prompt: str = "",
    ) -> str:
        client, option = self._select(model)

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if source_prompt:
            messages.append({"role": "system", "content": source_prompt})
        if widget_prompt:
            messages.append({"role": "system", "content": widget_prompt})
        messages.extend({"role": message.role, "content": message.content} for message in history)

        chunks = client.chat.completions.create(
            messages=messages,
            **self._completion_kwargs(option, source_prompt=source_prompt),
        )

        content_parts: list[str] = []
        for chunk in chunks:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                content_parts.append(chunk.choices[0].delta.content)

        return "".join(content_parts).strip()

    def title_conversation(self, user_message: str, assistant_message: str, *, model: str | None = None) -> str:
        client, option = self._select(model)

        kwargs: dict = {
            "model": option.id,
            "temperature": 0.3,
            "max_tokens": 24,
            "top_p": 1,
            "stream": False,
        }
        if option.provider == PROVIDER_FPT:
            kwargs["extra_body"] = {"top_k": 20}

        response = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Name this chat in 3 to 7 words. Return only the title, "
                        "no quotes, no punctuation at the end."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"User message:\n{user_message}\n\n"
                        f"Assistant response:\n{assistant_message[:1000]}"
                    ),
                },
            ],
            **kwargs,
        )

        if response.choices and response.choices[0].message.content:
            return response.choices[0].message.content.strip()

        return user_message

    def warm(self, model: str | None = None) -> bool:
        """Send a tiny request so the provider connection is ready before real use."""

        client, option = self._select(model)
        kwargs: dict = {"model": option.id, "max_tokens": 1, "stream": False}
        if option.provider == PROVIDER_FPT:
            kwargs["extra_body"] = {"top_k": 1}

        client.chat.completions.create(
            messages=[{"role": "user", "content": "ping"}],
            **kwargs,
        )
        return True


# Backwards-compatible alias.
FptAiChatClient = MultiProviderChatClient
