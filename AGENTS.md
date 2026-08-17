# AGENTS.md

## Project Overview

FitQA - Chinese fitness knowledge Q&A system. FastAPI backend with BM25 + FAISS vector retrieval, static HTML/JS frontend.

## Structure

```
backend/          # FastAPI app (Python 3.10+)
  main.py         # Entrypoint, lifespan, router mounting
  config.py       # pydantic-settings, loads .env
  database.py     # SQLite (fitqa.db)
  retrievers/     # BM25, vector (sentence-transformers + FAISS), hybrid RRF fusion
  llm/client.py   # OpenAI-compatible client, mock mode fallback
  api/            # Routes: /ask, /knowledge/*, /history
  data/           # 30 hardcoded fitness knowledge entries
frontend/         # Static HTML/CSS/JS, no build step
```

## Commands

```bash
# Backend (from backend/)
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend - any static server
python -m http.server 3000  # from frontend/
```

No tests, linting, typechecking, or CI configured.

## Key Quirks

- **HF_ENDPOINT**: Hardcoded in `main.py:11` to `hf-mirror.com` (Chinese mirror). Remove or change if not needed.
- **Static mount path**: `main.py:109` hardcodes `D:\demo\frontend` - must change for non-Windows or different directory.
- **Mock mode**: Auto-activates when `LLM_MODE=mock` or `OPENAI_API_KEY` is empty. No real LLM calls.
- **Vector fallback**: If sentence-transformers fails to load, hybrid mode silently degrades to BM25-only.
- **SQLite path**: Resolved relative to `backend/` directory via `database.py:9-11`.
- **No .gitignore**: `.env` and `fitqa.db` should not be committed but no gitignore exists.

## Config

Copy `.env.example` to `.env` in `backend/`. Key vars:

- `OPENAI_API_KEY` - empty = mock mode
- `LLM_MODE` - `mock` or `real`
- `OPENAI_BASE_URL` - API endpoint
- `MODEL_NAME` - defaults to `gpt-4o-mini`

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ask` | Q&A (body: `{question, mode}`, mode: bm25/vector/hybrid) |
| GET | `/knowledge/list` | All 30 knowledge entries |
| GET | `/knowledge/categories` | Category counts |
| GET | `/history` | Last 50 Q&A pairs |
| DELETE | `/history` | Clear history |
| GET | `/health` | Status + mock/vector availability |

## Dependencies

Backend uses: fastapi, uvicorn, pydantic-settings, jieba, rank-bm25, sentence-transformers, faiss-cpu, httpx, python-dotenv.

First run downloads the sentence-transformers model (~100MB). Set `HF_ENDPOINT` env var if HuggingFace is slow.
