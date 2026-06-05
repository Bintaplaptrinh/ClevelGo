# Clevel Go Backend

FastAPI service for the Clevel Go chat frontend. It calls FPT AI through an OpenAI-compatible client and stores chat history in MongoDB.

## Setup

```powershell
cd backend
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Deployment

Set `ALLOWED_ORIGINS` to every browser origin that can call the API. Origins
must not include paths. Trailing slashes and accidental quotes are normalized by
the backend, but the clean Render value should be:

```text
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://clevelgo.pages.dev,https://bintaplaptrinh.io.vn
```

## Endpoints

- `GET /api/health`
- `POST /api/chat`
- `GET /api/conversations/{conversation_id}`

## MongoDB Storage

History is stored in one ChatGPT/Gemini-style collection, configured by
`MONGODB_CONVERSATIONS_COLLECTION`.

Each document is one conversation:

```json
{
  "_id": "conversation-uuid",
  "title": "AI generated short title",
  "created_at": "date",
  "updated_at": "date",
  "message_count": 2,
  "last_message_preview": "Short preview for sidebar",
  "archived": false,
  "pinned": false,
  "messages": [
    {
      "id": "message-uuid",
      "role": "user",
      "content": "Hello",
      "created_at": "date",
      "status": "completed"
    }
  ]
}
```
