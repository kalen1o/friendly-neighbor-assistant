# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Friendly Neighbor — an AI chatbot agent with RAG, web search, and a markdown-based skill system. Users upload documents to a knowledge base, chat across multiple conversations, and the agent selects relevant skills per message.

## Commands

```bash
# Docker (full stack)
make up / down / build         # Start/stop/rebuild all services
make logs / logs-backend       # Tail logs
make migrate                   # Run Alembic migrations
make shell-backend / shell-db  # Shell into containers
make test                      # pytest in container

# Local dev (native, with HMR)
make local-db                  # Start only PostgreSQL in Docker
make local-backend             # FastAPI with --reload
make local-frontend            # Next.js dev server
make local-test                # pytest locally
```

## Architecture

Three Docker containers: `fn-db` (PostgreSQL 16 + pgvector), `fn-backend` (FastAPI Python 3.12), `fn-frontend` (Next.js Node 20).

### Backend — how the agent works

The message flow in `POST /api/chats/{id}/messages`:

1. `routers/chats.py` saves user message, calls `agent.agent.run_agent()`
2. `agent/agent.py` builds a `SkillRegistry` (built-in from `backend/skills/*.md` + user skills from DB)
3. For casual messages (greetings, thanks) — skips skills, answers directly
4. For real questions — sends skill index (names + descriptions only) to LLM, which picks relevant skills
5. Selected skills execute via `skills/executors.py` — each returns `{content, sources}`
6. Context injected into the user message, then `llm/provider.py` streams the response via SSE
7. Sources saved to DB and sent to frontend

### Skill system

Skills are defined as markdown files with YAML frontmatter (`name`, `description`, `type`, `enabled`). Three types:
- **tool** — has a Python executor function (web_search, calculate, etc.)
- **knowledge** — adds to system prompt (coding_assistant, writing_assistant)
- **workflow** — multi-step operations using other skills

Built-in skills live in `backend/skills/`. User skills stored in `skills` DB table, managed via `/api/skills`.

### RAG pipeline

Upload → parse (pypdf/python-docx) → chunk (paragraph sliding window with smart merge/split) → embed (OpenAI) → store in pgvector. Retrieval uses cosine similarity via `embedding <=> query_embedding` operator.

### LLM provider

`llm/provider.py` supports Anthropic and OpenAI (including any OpenAI-compatible API via `OPENAI_BASE_URL`). The model and base URL are configurable in `.env`.

## Key conventions

- Python 3.9 compat in tests (use `Optional[str]`, `List[...]` from typing). Docker uses 3.12.
- All DB access is async (`AsyncSession`, `create_async_engine` with `asyncpg`).
- pgvector columns use `Vector(1536)` — 1536 dims matches `text-embedding-3-small`.
- SSE events: `action` (agent status), `message` (token chunks), `sources` (JSON), `title` (auto-title), `done`, `error`.
- Frontend uses Next.js App Router, Tailwind CSS, shadcn/ui.
- Skills are markdown files, not Python classes.
