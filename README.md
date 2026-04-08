# Friendly Neighbor

An AI-powered chatbot agent that connects to any OpenAI-compatible provider, searches the web and your documents via RAG, and extends its capabilities through a markdown-based skill system.

## Features

### Core Chat
- **Multi-conversation support** — Create and manage separate chats organized by topic
- **Persistent chat history** — All messages and conversations stored in PostgreSQL
- **Streaming responses** — Real-time token streaming via Server-Sent Events (SSE)
- **Auto-generated titles** — Chat titles created automatically after first response
- **Typewriter effect** — Smooth character-by-character rendering in the UI

### AI Provider Support
- **Anthropic Claude** — Claude Sonnet and other models
- **OpenAI** — GPT-4o and other models
- **Any OpenAI-compatible API** — Z.ai (GLM-5), OpenRouter, Ollama, LiteLLM, etc.
- Configurable via `.env` — switch providers without code changes

### RAG Knowledge Base
- **Document upload** — PDF, DOCX, TXT, Markdown, HTML, CSV
- **Paragraph-based chunking** — Sliding window (A+B, B+C, C+D) with smart merging of short paragraphs and splitting of long ones
- **Vector embeddings** — OpenAI `text-embedding-3-small`, stored in pgvector
- **Semantic search** — Cosine similarity with HNSW indexing
- **Background processing** — Upload returns immediately, processing runs async
- **Source attribution** — Collapsible sources section shows which documents informed the answer

### Smart Agent with Skills
The agent uses an LLM to select which skills to run for each message:

| Skill | Type | What it does |
|-------|------|-------------|
| `web_search` | tool | DuckDuckGo search + page content fetching |
| `knowledge_base` | tool | RAG retrieval over uploaded documents |
| `web_reader` | tool | Fetch and extract content from a URL |
| `datetime_info` | tool | Current date, time, timezone conversions |
| `calculate` | tool | Math expressions and unit conversions |
| `summarize` | tool | Summarize text using LLM |
| `coding_assistant` | knowledge | Enhanced coding-focused responses |
| `writing_assistant` | knowledge | Enhanced writing/editing responses |
| `summarize_all_docs` | workflow | Digest of all uploaded documents |

- **Markdown-based skill definitions** — Skills defined as `.md` files with frontmatter
- **Two-stage loading** — Lightweight skill index (names only) loaded per request, full skill loaded on-demand
- **User-created skills** — Create custom skills from the UI, stored in DB
- **Toggle on/off** — Enable/disable any skill without removing it

### Web Search
- **DuckDuckGo integration** — Free, no API key required
- **Page content fetching** — Fetches actual page content from top results (not just snippets)
- **Query expansion** — Abbreviations auto-expanded (HCM → Ho Chi Minh City Vietnam)
- **Source links** — Web sources shown as clickable links in the UI

## Tech Stack

> Full details in [tech-stack.md](tech-stack.md)

| Layer            | Technology                        |
|------------------|-----------------------------------|
| Frontend         | Next.js 15 + Tailwind CSS + shadcn/ui |
| Backend / API    | FastAPI (Python 3.12)             |
| Agent Core       | Skill Registry + LLM-based skill selection |
| Database         | PostgreSQL 16                     |
| Vector DB        | pgvector (HNSW cosine index)      |
| Embeddings       | OpenAI `text-embedding-3-small`   |
| AI Provider      | Any OpenAI-compatible (Z.ai, Anthropic, OpenAI) |
| Web Search       | DuckDuckGo (`ddgs`)               |
| ORM              | SQLAlchemy 2.0 (async) + Alembic  |
| Containerization | Docker + Docker Compose            |

## Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An API key from any OpenAI-compatible provider

### Quick Start

```bash
# Clone and setup
git clone https://github.com/<your-org>/friendly-neighbor-assistant.git
cd friendly-neighbor-assistant
make init

# Edit .env with your API keys
nano .env

# Start everything
make build && make up

# Run database migrations
make migrate
```

Open `http://localhost:3000` — start chatting.

### Environment Variables

```env
# AI Provider — choose one
AI_PROVIDER=openai                          # "anthropic" or "openai"
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.z.ai/api/paas/v4  # leave empty for OpenAI direct
OPENAI_MODEL=glm-5                         # model name

# Or use Anthropic
# AI_PROVIDER=anthropic
# ANTHROPIC_API_KEY=your-anthropic-key
```

### Local Development (native, with HMR)

```bash
make local-db          # Start only PostgreSQL in Docker
make local-backend     # Run FastAPI natively (hot reload)
make local-frontend    # Run Next.js natively (full HMR)
make local-test        # Run tests locally
```

### All Commands

```bash
make help              # Show all available commands
make up / down         # Start/stop Docker services
make build             # Build images (cached)
make build-clean       # Build from scratch
make logs              # Tail all logs
make migrate           # Run Alembic migrations
make shell-backend     # Bash into backend container
make shell-db          # psql into database
make test              # Run pytest
```

## Project Structure

```
friendly-neighbor-assistant/
├── docker-compose.yml            # Full Docker stack (db + backend + frontend)
├── docker-compose.local.yml      # DB only (for local dev)
├── Makefile                      # Command runner
├── .env.example                  # Environment template
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/                  # Database migrations (0001-0004)
│   ├── skills/                   # Built-in skill markdown files (9 skills)
│   └── app/
│       ├── main.py               # FastAPI entry point + routers
│       ├── config.py             # Pydantic Settings
│       ├── agent/
│       │   ├── agent.py          # Skill-based agent (selects + executes skills)
│       │   └── tools.py          # Web search, KB search, page fetcher
│       ├── skills/
│       │   ├── registry.py       # Loads built-in + DB skills, builds index
│       │   └── executors.py      # Maps skill names to Python functions
│       ├── rag/
│       │   ├── chunking.py       # Paragraph sliding window chunker
│       │   ├── embeddings.py     # OpenAI embedding generation
│       │   ├── parsing.py        # PDF/DOCX/TXT/HTML/CSV text extraction
│       │   ├── processing.py     # Background: parse → chunk → embed → store
│       │   └── retrieval.py      # pgvector cosine similarity search
│       ├── routers/
│       │   ├── chats.py          # Chat CRUD + SSE streaming
│       │   ├── documents.py      # Document upload/list/delete
│       │   └── skills.py         # Skills CRUD + toggle
│       ├── models/               # SQLAlchemy models (Chat, Message, Document, Skill)
│       ├── schemas/              # Pydantic request/response schemas
│       ├── db/                   # Async engine, session, base
│       └── llm/
│           └── provider.py       # Anthropic + OpenAI streaming provider
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx        # Root layout with sidebar
│       │   ├── page.tsx          # Welcome page
│       │   ├── chat/[id]/        # Chat conversation page
│       │   ├── documents/        # Document management page
│       │   └── skills/           # Skills management page
│       ├── components/
│       │   ├── sidebar.tsx       # Navigation (chats, docs, skills)
│       │   ├── chat-input.tsx    # Message input with Enter/Shift+Enter
│       │   ├── chat-messages.tsx # Message list with action indicators
│       │   ├── message-bubble.tsx # Markdown rendering + source attribution
│       │   ├── source-attribution.tsx # Collapsible sources
│       │   ├── document-upload.tsx    # Drag-and-drop upload
│       │   └── document-list.tsx      # Document table with status
│       └── lib/
│           └── api.ts            # API client + SSE stream parser
│
└── docs/
    └── superpowers/              # Design specs and implementation plans
```

## Architecture

```
User <-> Next.js UI <-> FastAPI Backend
                             |
                        Skill-Based Agent
                        (LLM selects skills)
                             |
              ┌──────────────┼──────────────┐
              │              │              │
         Tool Skills    Knowledge     Workflow
         (execute)      Skills        Skills
              │         (system       (multi-step)
              │          prompt)
     ┌────────┼────────┐
     │        │        │
  Web Search  KB     DateTime
  (DuckDuckGo) (pgvector) Calculate
     │        │        Summarize
     │        │        Web Reader
     │        │
     ▼        ▼
  Internet  PostgreSQL
            (chats, messages,
             documents, chunks,
             skills)
```

## Roadmap

- [x] Project scaffolding, Docker, Makefile
- [x] Database schema (chats, messages, documents, chunks, skills)
- [x] AI provider integration (Anthropic + OpenAI + any compatible API)
- [x] Basic chat with SSE streaming and auto-titles
- [x] Multi-conversation support
- [x] Document upload with background processing
- [x] Paragraph-based chunking with smart merge/split
- [x] Vector embeddings + pgvector retrieval
- [x] Web search with page content fetching
- [x] Source attribution in UI
- [x] Skill system with registry, built-in skills, and management UI
- [ ] Hook system — pre/post-action callbacks
- [ ] MCP integration — connect external tools via Model Context Protocol
- [ ] User authentication
- [ ] Conversation export/import
- [ ] Mobile-responsive UI

## License

MIT
