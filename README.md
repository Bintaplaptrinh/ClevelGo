# Clevel Go

Workspace layout:

- `frontend`: Next.js chat UI
- `backend`: FastAPI API with FPT AI and MongoDB chat history

## Run Backend

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

## Run Frontend

```powershell
cd frontend
pnpm dev
```

The frontend calls `NEXT_PUBLIC_API_URL`, defaulting to `http://127.0.0.1:8000`.
