# Tech Stack

## Overview

| Layer            | Technology                      | Version | Package |
|------------------|---------------------------------|---------|---------|
| Frontend         | Next.js (React)                 | 15+     | `next@latest` |
| Backend / API    | FastAPI (Python)                | 0.128+  | `fastapi[standard]` |
| Agent Core       | Pydantic AI                     | 1.0+    | `pydantic-ai[anthropic,openai,duckduckgo]` |
| RAG Framework    | LlamaIndex                      | 0.14+   | `llama-index` |
| Database         | PostgreSQL                      | 16+     | — |
| Vector DB        | pgvector (temporary → Qdrant)   | 0.8.2   | `pgvector` (extension) + `pgvector-python` |
| Embeddings       | OpenAI `text-embedding-3-small` | —       | via `openai` SDK |
| AI Provider      | Anthropic Claude / OpenAI       | —       | via Pydantic AI |
| Web Search       | DuckDuckGo                      | 8.0+    | `duckduckgo-search` |
| Task Queue       | FastAPI BackgroundTasks          | —       | built into FastAPI |
| ORM              | SQLAlchemy + Alembic            | 2.0+ / 1.14+ | `sqlalchemy[asyncio]` + `alembic` |
| File Processing  | Unstructured                    | latest  | `unstructured[all-docs]` |
| Containerization | Docker + Docker Compose         | 27+     | `docker compose` |
| Task Runner      | Makefile                        | —       | `make` |

---

## Frontend — Next.js (React)

**What:** React-based full-stack framework with SSR, API routes, and file-based routing.

**Why chosen:**
- Rich ecosystem for building chat UIs (streaming responses, markdown rendering)
- Built-in file upload support for the document management tab
- Server-side rendering for fast initial loads
- Large community and component library support (shadcn/ui, Tailwind CSS)

**Key libraries:**
- `tailwindcss` — Utility-first CSS
- `shadcn/ui` — Pre-built accessible UI components
- `react-markdown` — Render AI responses with markdown formatting
- `react-dropzone` — Drag-and-drop file uploads for the document tab
- `swr` or `react-query` — Data fetching and cache management

---

## Backend — FastAPI (Python)

**What:** Modern async Python web framework with automatic OpenAPI docs.

**Why chosen:**
- Python has the richest AI/ML and RAG library ecosystem
- Native async support for handling concurrent chat sessions
- Auto-generated API docs at `/docs` for easy frontend integration
- Type hints with Pydantic for request/response validation

**Key libraries:**
- `pydantic` — Data validation and settings management
- `python-multipart` — File upload handling
- `uvicorn` — ASGI server
- `python-dotenv` — Load environment variables from `.env`

---

## Agent Core — Pydantic AI

**What:** The brain of the application. A lightweight, type-safe agent framework built by the Pydantic team. This is the decision engine that sits between the user and all other services.

**What it does:**

```
User message
      |
  Agent Core (Pydantic AI)
      |
      ├── Classify intent
      │     "What kind of question is this?"
      │
      ├── Select strategy
      │     ├── Answer directly (general knowledge)
      │     ├── Search knowledge base (RAG via LlamaIndex)
      │     ├── Search the web (DuckDuckGo)
      │     └── Combine KB + Web (hybrid)
      │
      ├── Execute tools
      │     Call selected tools, gather results
      │
      ├── Synthesize response
      │     Combine context + results into a coherent answer
      │
      └── Manage conversation
            Track chat history and context across turns
```

**Why Pydantic AI over alternatives:**

| Framework | Verdict |
|---|---|
| **Pydantic AI** | Best fit — lightweight, type-safe, native FastAPI/Pydantic integration, you control the architecture |
| LangChain agents | Over-abstracted, hard to debug, breaking API changes |
| CrewAI | Multi-agent framework — overkill for a single chatbot agent |
| Google ADK | Locks you into Google/Gemini ecosystem |
| AutoGen | Designed for multi-agent conversations, too heavy for this use case |

**Why chosen:**
- **Type-safe tool definitions** — tools are Python functions with Pydantic models, validated automatically
- **Native FastAPI fit** — same Pydantic ecosystem, no impedance mismatch
- **Minimal abstraction** — you see exactly what the agent is doing, easy to debug
- **Streaming support** — built-in support for streaming responses to the chat UI
- **Model-agnostic** — works with Anthropic, OpenAI, and other providers out of the box
- **Dependency injection** — clean way to pass DB sessions, API clients, and config to tools

**Core components:**

```python
from pydantic_ai import Agent, Tool

# Define the agent with its tools
agent = Agent(
    model="anthropic:claude-sonnet-4-20250514",
    system_prompt="You are Friendly Neighbor, a helpful assistant...",
    tools=[
        search_knowledge_base,   # RAG lookup via LlamaIndex
        search_web,              # DuckDuckGo search
        get_chat_history,        # Retrieve past messages for context
    ],
)
```

**Install:**
```bash
pip install "pydantic-ai[anthropic,openai,duckduckgo,mcp]"
```

**Key extras included:**
- `anthropic` — Anthropic Claude model support
- `openai` — OpenAI model support
- `duckduckgo` — Built-in DuckDuckGo search tool (no separate library needed!)
- `mcp` — MCP server/client support for extending agent with external tools

**How it connects to everything else:**

| Component | How Agent Core uses it |
|---|---|
| LlamaIndex | Calls as a tool for RAG retrieval |
| DuckDuckGo | Calls as a tool for web search |
| PostgreSQL | Reads/writes chat history and message context |
| FastAPI | Agent runs inside API endpoints, streams responses |
| Unstructured | Indirectly — document processing happens in background, agent queries the results |

---

## RAG Framework — LlamaIndex

**What:** Purpose-built framework for document indexing, chunking, and retrieval (RAG).

**Why LlamaIndex over LangChain for RAG:**
- Built specifically for RAG — not a general agent framework trying to do everything
- Cleaner abstractions for document loading, chunking, and querying
- Better default chunking strategies and retrieval pipelines
- Simpler API — less boilerplate to get RAG working
- Active development focused on retrieval quality

**Key modules used:**
- `llama_index.core.node_parser` — SentenceSplitter, SemanticSplitter for chunking
- `llama_index.vector_stores.postgres` — pgvector integration
- `llama_index.embeddings.openai` — OpenAI embedding generation
- `llama_index.core.query_engine` — Query engine for retrieval + synthesis
- `llama_index.readers` — Document loaders for various file formats

**How it fits with Pydantic AI:**
- LlamaIndex handles the RAG pipeline (index, store, retrieve)
- Pydantic AI agent calls LlamaIndex as a tool when it decides KB search is needed
- Clean separation: agent decides *when* to search, LlamaIndex decides *how* to search

---

## Database — PostgreSQL

**What:** Relational database for storing chats, messages, sessions, and document metadata.

**Why chosen:**
- Battle-tested, reliable, and widely supported
- pgvector extension allows vector storage in the same database — no separate vector DB service needed
- JSONB columns for flexible metadata (document properties, agent config)
- Full-text search as a fallback/complement to vector search

**Tables (planned):**
- `chats` — Conversation threads with titles and topics
- `messages` — Individual messages linked to a chat
- `documents` — Uploaded file metadata and processing status
- `document_chunks` — Chunked text with vector embeddings

---

## Vector DB — pgvector

**What:** PostgreSQL extension that adds vector similarity search.

**Status:** Temporary solution for early development. Will migrate to **Qdrant** when vector count exceeds ~500K chunks or search latency becomes a bottleneck.

**Why chosen for now:**
- No extra infrastructure — vectors live in the same Postgres instance
- Supports cosine similarity, L2 distance, and inner product
- IVFFlat and HNSW indexing for fast approximate nearest neighbor search
- Simpler ops — one database to back up, monitor, and scale
- Good enough for <500K vectors

**Configuration:**
- Embedding dimension: 1536 (matches `text-embedding-3-small`)
- Index type: HNSW (better recall, slightly more memory)
- Distance metric: Cosine similarity

---

## Embeddings — OpenAI `text-embedding-3-small`

**What:** OpenAI's embedding model that converts text into 1536-dimensional vectors.

**Why chosen:**
- High quality at low cost (~$0.02 per 1M tokens)
- 1536 dimensions — good balance of accuracy and storage size
- Widely used, well-documented, easy to integrate via API
- Can switch to `text-embedding-3-large` (3072 dims) later if more precision is needed

**Usage:**
- Embed document chunks during upload/processing
- Embed user queries at search time for similarity matching

---

## AI Provider — Anthropic Claude / OpenAI

**What:** LLM provider for generating chat responses, query routing, and summarization.

**Why chosen:**
- Configurable — user provides their own API key in `.env`
- Claude excels at long-context reasoning (useful for RAG with many chunks)
- OpenAI as an alternative for users who prefer GPT models
- Both support streaming responses for real-time chat UX

**Models (recommended defaults):**
- Chat: `claude-sonnet-4-20250514` or `gpt-4o`
- Query routing: `claude-haiku-4-5-20251001` or `gpt-4o-mini` (fast + cheap for classification)

---

## Web Search — DuckDuckGo

**What:** Free web search — available as a **built-in Pydantic AI common tool** (`pydantic-ai[duckduckgo]`).

**Why chosen:**
- Completely free — no API key required, no usage limits
- **Built into Pydantic AI** — no separate library or custom tool code needed
- Returns text snippets, titles, and URLs — enough for agent context
- Supports text search, news search, and instant answers
- Good enough for development and early production

**Usage with Pydantic AI (zero boilerplate):**
```python
from pydantic_ai import Agent
from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool

agent = Agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[duckduckgo_search_tool()],
)
```

**Or as a standalone library:**
```python
from duckduckgo_search import DDGS

results = DDGS().text("python programming", max_results=5)
```

**Upgrade path:** If you need higher reliability or richer results in production, switch to Tavily (`pydantic-ai[tavily]`) or Brave Search API (free tier: 2,000/month).

---

## Task Queue — FastAPI BackgroundTasks

**What:** Built-in FastAPI mechanism for running tasks in the background after returning a response to the user.

**Why it matters:**
Document processing (parse → chunk → embed → store) is slow. Without background processing, the user uploads a file and waits 30+ seconds staring at a spinner. With a task queue, the API responds instantly and processing happens in the background.

**How it works:**

```
User uploads PDF
      |
  POST /documents/upload
      |
  Save file + create DB record (status: "processing")
      |
  Return 202 Accepted immediately ← user keeps chatting
      |
  BackgroundTask kicks off:
      1. Parse file (Unstructured)
      2. Chunk text (LlamaIndex)
      3. Generate embeddings (OpenAI)
      4. Store vectors in pgvector
      5. Update DB: status → "ready"
      |
  Frontend polls status → shows "Document ready"
```

**Why BackgroundTasks for now:**
- Zero setup — built into FastAPI, no extra dependencies
- Works for single-server deployments
- Simple — just add a function to the background queue

**Upgrade path:** When you need retries, job status tracking, or multiple workers, switch to **ARQ** (async + Redis, lightweight) or **Celery + Redis** (industry standard, heavier).

```python
from fastapi import BackgroundTasks

@app.post("/documents/upload", status_code=202)
async def upload_document(file: UploadFile, background_tasks: BackgroundTasks):
    doc = save_file_and_create_record(file)
    background_tasks.add_task(process_document, doc.id)
    return {"id": doc.id, "status": "processing"}
```

---

## ORM — SQLAlchemy + Alembic

**What:** Python SQL toolkit (SQLAlchemy) with database migration management (Alembic). Used inside the FastAPI backend — FastAPI has no built-in database layer (unlike Django).

**Install:**
```bash
pip install "sqlalchemy[asyncio]" asyncpg alembic pgvector-python
```

- `sqlalchemy[asyncio]` — ORM with async support (v2.0+)
- `asyncpg` — Fast async PostgreSQL driver (replaces `psycopg2` for async)
- `alembic` — Database migration management (v1.14+)
- `pgvector-python` — pgvector SQLAlchemy column types and operators

**Why chosen:**
- SQLAlchemy 2.0 has modern async support matching FastAPI
- Same `AsyncSession` handles both regular data and vector search queries
- Alembic handles schema migrations — critical as the DB schema evolves
- Alembic supports async engines for migration execution
- Mature, battle-tested, extensive PostgreSQL support
- Works seamlessly with pgvector via `pgvector-python` extension

---

## File Processing — Unstructured

**What:** Library for extracting clean text from various document formats.

**Why chosen:**
- Handles PDF, DOCX, TXT, Markdown, HTML, and more from a single API
- Extracts text while preserving structure (headings, paragraphs, tables)
- Handles messy real-world documents (scanned PDFs, mixed formats)
- Pairs well with LlamaIndex's document loader interface

**Supported upload formats:**
- PDF (`.pdf`)
- Word (`.docx`)
- Plain text (`.txt`)
- Markdown (`.md`)
- HTML (`.html`)
- CSV (`.csv`)

---

## Containerization — Docker + Docker Compose

**What:** All services (frontend, backend, database) run in isolated Docker containers, orchestrated by Docker Compose.

**Services:**

| Service    | Image / Build        | Port | Description |
|------------|----------------------|------|-------------|
| `db`       | `pgvector/pgvector:pg16` | 5432 | PostgreSQL with pgvector pre-installed |
| `backend`  | `./backend/Dockerfile` | 8000 | FastAPI + Pydantic AI + LlamaIndex |
| `frontend` | `./frontend/Dockerfile` | 3000 | Next.js dev server |

**Why Docker:**
- One command to start everything — no manual Postgres install, no Python/Node version conflicts
- `pgvector/pgvector:pg16` image comes with pgvector pre-installed — zero extension setup
- Volumes persist data between restarts (DB data, uploaded documents)
- Same environment locally and in production
- Health checks ensure backend waits for DB to be ready

**Volumes:**
- `pgdata` — PostgreSQL data (persisted between restarts)
- `uploaded_docs` — User-uploaded documents

---

## Task Runner — Makefile

**What:** Simple command aliases for common operations. Run `make help` to see all available commands.

**Key commands:**

| Command | What it does |
|---------|-------------|
| `make up` | Start all services (detached) |
| `make down` | Stop all services |
| `make build` | Rebuild all images from scratch |
| `make logs` | Tail logs from all services |
| `make logs-backend` | Tail backend logs only |
| `make migrate` | Run Alembic database migrations |
| `make migrate-new msg="description"` | Create a new migration |
| `make shell-backend` | Open bash in backend container |
| `make shell-db` | Open psql in database container |
| `make test` | Run backend tests |
| `make lint` | Run linting |
| `make init` | First-time setup (copy .env, instructions) |
| `make clean` | Stop and remove containers |
| `make nuke` | Remove everything including data (destructive) |

---

## Environment Variables

All secrets and config are stored in `.env` (not in the database):

```env
# AI Provider
AI_PROVIDER=anthropic                       # or "openai"
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Embeddings
EMBEDDING_MODEL=text-embedding-3-small

# Database
POSTGRES_USER=friendly
POSTGRES_PASSWORD=friendly_secret
POSTGRES_DB=friendly_neighbor
DB_PORT=5432
DATABASE_URL=postgresql+asyncpg://friendly:friendly_secret@db:5432/friendly_neighbor

# Web Search — DuckDuckGo requires no API key

# Ports
BACKEND_PORT=8000
FRONTEND_PORT=3000
NEXT_PUBLIC_API_URL=http://localhost:8000
```
