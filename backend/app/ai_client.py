from openai import OpenAI

from app.config import Settings
from app.schemas import ChatMessage


SYSTEM_PROMPT = (
    "You are Clevel Go, a practical DataEngineer Agent. "
    "Help with SQL, data modeling, pipeline debugging, schema analysis, lineage, "
    "data quality, and warehouse operations. Keep answers concrete and implementation-ready. "
    "Use clean Markdown when it improves readability: headings like ## Section title, **bold**, ***strong emphasis***, "
    "tables, bullet lists, numbered steps, code fences, and horizontal rules using --- . "
    "For simple bar charts, use a fenced chart block with JSON like "
    '```chart\\n{"title":"Rows by table","labels":["users"],"values":[120]}\\n```.'
)


class FptAiChatClient:
    def __init__(self, settings: Settings) -> None:
        self._model = settings.fpt_ai_model
        self._client = OpenAI(api_key=settings.fpt_ai_api_key, base_url=settings.fpt_ai_base_url)

    def complete(self, history: list[ChatMessage]) -> str:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend({"role": message.role, "content": message.content} for message in history)

        chunks = self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            temperature=1,
            max_tokens=1024,
            top_p=1,
            extra_body={"top_k": 40},
            presence_penalty=0,
            frequency_penalty=0,
            stream=True,
        )

        content_parts: list[str] = []
        for chunk in chunks:
            if chunk.choices and chunk.choices[0].delta.content:
                content_parts.append(chunk.choices[0].delta.content)

        return "".join(content_parts).strip()

    def title_conversation(self, user_message: str, assistant_message: str) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
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
            temperature=0.3,
            max_tokens=24,
            top_p=1,
            extra_body={"top_k": 20},
            stream=False,
        )

        if response.choices and response.choices[0].message.content:
            return response.choices[0].message.content.strip()

        return user_message
