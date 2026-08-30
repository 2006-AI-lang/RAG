# AGENTS.md

## Project Overview

FitQA - Chinese fitness knowledge Q&A system based on RAG architecture. FastAPI backend with BM25 + FAISS vector retrieval, static HTML/JS frontend. Full user data isolation.

## Structure

```
backend/              # FastAPI app (Python 3.10+)
  main.py             # Entrypoint, lifespan, router mounting, rate limiting
  config.py           # pydantic-settings, loads .env, encryption
  database.py         # SQLite (fitqa.db), all CRUD with user_id isolation
  models.py           # Pydantic data models
  api/                # Routes with user isolation
    ask.py            # Q&A endpoint (anonymous + logged-in)
    auth.py           # User authentication (register/login)
    knowledge.py      # Knowledge base management (static shared, dynamic isolated)
    history.py        # Q&A history (user-isolated)
    sessions.py       # Chat sessions (user-isolated)
    exercise.py       # Exercise records (user-isolated)
    training_plan.py  # Training plans (user-isolated)
    config.py         # LLM model config (user-isolated)
  data/
    knowledge_base.py # 36 static fitness knowledge entries (shared)
  llm/
    client.py         # OpenAI-compatible client, mock mode
    prompts.py        # Scene-based prompts
  retrievers/         # BM25, vector (sentence-transformers + FAISS), hybrid RRF
  parsers/            # PDF, DOCX, TXT parsers + content splitter
frontend/             # Static HTML/CSS/JS, no build step
  index.html          # Main page
  css/                # Styles (style.css, responsive.css)
  js/
    app.js            # Main logic
    enhancements.js   # Streaming, scene selector, export
    knowledge.js      # Offline mode knowledge data
```

## Commands

```bash
# Backend (from backend/)
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend - any static server
python -m http.server 3000  # from frontend/
```

## User Data Isolation

All user data is isolated by `user_id`:

| Data Type | Isolation | Notes |
|-----------|-----------|-------|
| Q&A History | `user_id` bound | Anonymous users don't save history |
| Training Plans | `user_id` bound | Each user sees only their plans |
| Exercise Records | `user_id` bound | Each user sees only their records |
| Chat Sessions | `user_id` bound | Each user sees only their sessions |
| LLM Models | `user_id` bound | Each user manages only their models |
| Dynamic Knowledge | `user_id` bound | Each user edits only their entries |
| Static Knowledge | Global shared | 36 built-in entries visible to all |

## Key Quirks

- **HF_ENDPOINT**: Hardcoded in `main.py:11` to `hf-mirror.com` (Chinese mirror).
- **Mock mode**: Auto-activates when `LLM_MODE=mock` or `OPENAI_API_KEY` is empty.
- **Vector fallback**: If sentence-transformers fails, hybrid mode degrades to BM25-only.
- **Anonymous history**: Not saved (user_id=None → skip save).
- **Rate limiting**: Custom middleware, 100 req/min default, 5/min for register, 10/min for login, 30/min for Q&A.

## Config

Copy `.env.example` to `.env` in `backend/`. Key vars:

- `OPENAI_API_KEY` - empty = mock mode
- `LLM_MODE` - `mock` or `real`
- `OPENAI_BASE_URL` - API endpoint
- `MODEL_NAME` - defaults to `gpt-4o-mini`

## Dependencies

Backend uses: fastapi, uvicorn, pydantic-settings, jieba, rank-bm25, sentence-transformers, faiss-cpu, httpx, cryptography, PyPDF2, python-docx, fpdf2, python-multipart.
