# Friendly Neighbor

An AI-powered chatbot agent that connects to any LLM provider, searches the web and your documents via RAG, and extends its capabilities through a markdown-based skill system. Features multi-model switching, conversation folders, admin dashboard, and a polished mobile experience.

## Features

### Core Chat
- **Multi-conversation support** — Create and manage separate chats organized by topic
- **Conversation folders** — Nested folder system with drag-and-drop, color/icon customization
- **Persistent chat history** — All messages and conversations stored in PostgreSQL
- **Streaming responses** — Real-time token streaming via Server-Sent Events (SSE)
- **Auto-generated titles** — Chat titles created automatically after first response
- **Full-text search** — Search across all conversations (Postgres tsvector)
- **Chat sharing** — Read-only shareable links with expiration
- **Conversation export** — Export chats as Markdown or PDF

### Multi-Model Switching
- **Project models** — Admin configures multiple models via `PROJECT_MODELS` env var with per-model base URLs
- **User custom models** — Users add their own models with encrypted API keys (Fernet)
- **Per-chat model selection** — Model picker dropdown in chat input
- **3-level fallback** — Per-chat model > user default > project default
- **Skill model override** — Skills can specify a preferred model in frontmatter

### AI Provider Support
- **Anthropic Claude** — Claude Sonnet and other models
- **OpenAI** — GPT-4o and other models
- **Any OpenAI-compatible API** — Z.ai (GLM-5), OpenRouter, Ollama, LiteLLM, etc.
- **Per-model base URLs** — Mix providers in a single instance (e.g., OpenAI + Z.ai)
- Configurable via `.env` — switch providers without code changes

### RAG Knowledge Base
- **Document upload** — PDF, DOCX, TXT, Markdown, HTML, CSV
- **Semantic chunking** — Header-aware splitting with configurable chunk size and overlap
- **Vector embeddings** — OpenAI `text-embedding-3-small`, stored in pgvector
- **Hybrid search** — Combines vector similarity with PostgreSQL full-text search via Reciprocal Rank Fusion (RRF)
- **Cohere reranking** — Optional two-stage retrieval using Cohere Rerank API for higher precision
- **Inline citations** — Numbered `[1]`, `[2]` markers in responses with clickable source excerpts
- **Background processing** — Upload returns immediately, processing runs async

### RAG Pipeline Details

The retrieval pipeline processes queries through multiple stages, each independently toggleable:

```
Query → Hybrid Search (vector + FTS → RRF fusion) → Reranking (Cohere) → Citation Formatting → LLM
```

**Hybrid Search** combines two retrieval methods for better recall:
- **Vector search** uses cosine similarity on pgvector embeddings to find semantically similar chunks
- **Full-text search** uses PostgreSQL `tsvector`/`tsquery` for keyword matching (exact terms, acronyms, names)
- Results are fused via **Reciprocal Rank Fusion (RRF)**, a proven method that combines ranked lists without needing score normalization

**Cohere Reranking** adds a second-stage relevance filter:
- First stage retrieves top-20 candidates via hybrid search
- Cohere's cross-encoder (`rerank-v3.5`) scores each (query, chunk) pair for precise relevance
- Returns the top-5 most relevant chunks — significantly more accurate than similarity alone

**Citation Highlighting** provides source transparency:
- Each retrieved chunk gets a numbered label `[1]`, `[2]` in the LLM context
- The LLM is instructed to cite sources inline when drawing from them
- Frontend renders citations as clickable superscript badges that link to source excerpts

**Semantic Chunking** splits documents at natural boundaries:
- Detects markdown headers (`#`, `##`) and HTML headings as section boundaries
- Groups content under the same header into a single chunk when it fits
- Falls back to paragraph-based splitting for headerless text
- Populates chunk metadata (header title, position) for future filtering

#### RAG Configuration

All RAG settings are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_HYBRID_SEARCH_ENABLED` | `true` | Enable hybrid (vector + full-text) search |
| `RAG_FULLTEXT_WEIGHT` | `0.4` | Weight of full-text search in RRF fusion (vector gets 1 - this) |
| `RAG_RERANK_ENABLED` | `false` | Enable Cohere reranking (requires API key) |
| `COHERE_API_KEY` | `""` | Cohere API key for reranking |
| `RAG_TOP_K` | `5` | Number of results returned to the LLM |
| `RAG_MIN_SCORE` | `0.65` | Minimum vector similarity score |
| `RAG_RERANK_TOP_N` | `20` | Number of candidates fetched before reranking |
| `RAG_CHUNK_SIZE` | `500` | Target tokens per chunk |
| `RAG_CHUNK_OVERLAP` | `50` | Overlap tokens between consecutive chunks |
| `RAG_CHUNK_STRATEGY` | `semantic` | Chunking strategy: `semantic` (header-aware) or `fixed` (paragraph window) |

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
| `translate` | tool | Language translation |
| `coding_assistant` | knowledge | Enhanced coding-focused responses |
| `writing_assistant` | knowledge | Enhanced writing/editing responses |
| `summarize_all_docs` | workflow | Digest of all uploaded documents |

- **Markdown-based skill definitions** — Skills defined as `.md` files with frontmatter
- **Model override per skill** — Skills can specify which model to use via `model:` frontmatter
- **User-created skills** — Create custom skills from the UI, stored in DB
- **Toggle on/off** — Enable/disable any skill without removing it

### Artifacts
- **React/HTML code rendering** — LLM generates code that renders live in a side panel
- **Editable code** — Edit artifact code with live preview
- **Database persistence** — Artifacts saved and reloadable

### File Attachments & Vision
- **Image upload in chat** — Drag-and-drop or paste images
- **Vision model support** — Analyze images with vision-capable models
- **PDF/text file attachments** — Content extracted and included in context

### Hooks System
- **Pre/post-action callbacks** — Hook into message flow at 6 points (pre_message, pre_skills, post_skills, pre_llm, post_llm, post_message)
- **Observability hooks** — Latency tracking, token counting, cost calculation
- **Markdown-based definitions** — Same frontmatter format as skills

### MCP Integration
- **Model Context Protocol** — Connect external tool servers
- **Tool discovery** — Auto-discover tools from MCP servers
- **Per-tool toggle** — Enable/disable individual tools

### Admin Dashboard
- **User management** — List, edit roles, enable/disable, delete users
- **Role-based access** — Three roles: admin, user, viewer
- **Env admin protection** — `ADMIN_EMAILS` users cannot be demoted/deleted
- **System analytics** — Total users, messages, tokens, costs, daily breakdown
- **Audit logging** — Every action logged (login, messages, CRUD, admin actions)
- **Usage quotas** — Soft limits (warning) and hard limits (block) per user per month
- **Auto-promote on login** — Existing users in `ADMIN_EMAILS` get admin role automatically

### Authentication
- **JWT-based auth** — Access tokens (15min) + refresh tokens (7 days)
- **Cookie-based sessions** — Secure, httpOnly cookies
- **Rate limiting** — Login and registration rate limits
- **Per-user data isolation** — All data scoped to authenticated user

### Analytics
- **Personal usage dashboard** — Messages, tokens, costs over time
- **Daily usage charts** — Recharts-based visualizations
- **Per-message cost tracking** — Input/output token breakdown
- **Admin system-wide analytics** — Aggregate stats across all users

### Mobile Experience
- **Responsive sidebar** — Hamburger menu with swipe-to-open drawer
- **Safe area support** — Notch and home indicator padding
- **Touch-optimized** — 44px+ tap targets, larger controls on mobile
- **Sticky chat input** — Input stays above keyboard with backdrop blur
- **Message animations** — Fade+slide for new messages
- **Settings fullscreen** — Dialog goes fullscreen on mobile

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 + Tailwind CSS + shadcn/ui |
| Backend / API | FastAPI (Python 3.12) |
| Database | PostgreSQL 16 + pgvector |
| Embeddings | OpenAI `text-embedding-3-small` |
| AI Provider | Anthropic, OpenAI, any OpenAI-compatible |
| Web Search | DuckDuckGo (`ddgs`) |
| ORM | SQLAlchemy 2.0 (async) + Alembic |
| Cache | Redis (sessions, usage counters) |
| Auth | JWT + refresh tokens + cookies |
| Encryption | Fernet (user API keys) |
| Containerization | Docker + Docker Compose |

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
# AI Provider
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=                              # leave empty for OpenAI direct
OPENAI_MODEL=gpt-4o

# Multiple project models (optional)
PROJECT_MODELS=openai:gpt-4o,openai:gpt-4o-mini,openai:glm-5.1@https://api.z.ai/api/coding/paas/v4

# User custom models (optional)
ENCRYPTION_KEY=                               # generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Admin
ADMIN_EMAILS=admin@example.com                # comma-separated, auto-promoted on login
```

See `.env.example` for all options.

### Local Development (native, with HMR)

```bash
make local-db          # Start only PostgreSQL + Redis in Docker
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

## Architecture

```
User <-> Next.js UI <-> FastAPI Backend
                             |
                        Skill-Based Agent
                        (LLM selects skills)
                             |
              ┌──────────────┼──────────────┐
              |              |              |
         Tool Skills    Knowledge     Workflow
         (execute)      Skills        Skills
              |         (system       (multi-step)
              |          prompt)
     ┌────────┼────────┐
     |        |        |
  Web Search  KB     DateTime
  (DuckDuckGo) (pgvector) Calculate
     |        |        Summarize
     |        |        Web Reader
     |        |        Translate
     ▼        ▼
  Internet  PostgreSQL + pgvector
            (chats, messages, documents,
             chunks, skills, hooks, mcp,
             artifacts, folders, user_models,
             audit_logs, user_quotas)
```

## Roadmap

- [x] Project scaffolding, Docker, Makefile
- [x] Database schema + Alembic migrations (30 migrations)
- [x] AI provider integration (Anthropic + OpenAI + any compatible API)
- [x] Basic chat with SSE streaming and auto-titles
- [x] Multi-conversation support
- [x] Document upload with background processing
- [x] Semantic chunking with header-aware splitting (upgraded from paragraph-based)
- [x] Vector embeddings + pgvector retrieval
- [x] Web search with page content fetching
- [x] Source attribution in UI
- [x] Skill system with registry, built-in skills, and management UI
- [x] Hook system — pre/post-action callbacks
- [x] MCP integration — connect external tools via Model Context Protocol
- [x] User authentication (JWT + refresh tokens)
- [x] Chat sharing (read-only links)
- [x] Artifacts (React/HTML live rendering)
- [x] Vision & file attachments
- [x] Analytics dashboard (personal + admin)
- [x] Full-text search across conversations
- [x] Conversation export (Markdown, PDF)
- [x] User memories (context across conversations)
- [x] Conversation folders (nested, drag-and-drop, customizable)
- [x] Multi-model switching (project models, user models, per-chat selection)
- [x] Admin dashboard (user management, audit log, quotas)
- [x] Mobile-responsive polish (swipe gestures, safe areas, animations)
- [x] Browser push notifications (with first-login prompt)
- [x] Background LLM tasks — response generation survives navigation and page reload (message-level status tracking, server-driven sidebar indicators, toast notifications)
- [x] OAuth/SSO login (Google, GitHub) — OAuth2 authorization code flow with account linking by email
- [x] RAG enhancements — hybrid search (Postgres FTS + RRF), Cohere reranking, inline citations, semantic chunking, configurable pipeline, auto-KB injection
- [x] Webhook integrations — Slack, Discord, generic URL (outbound notifications + inbound triggers)
- [x] Delete account — user self-service account deletion with full data cleanup

**Multi-Agent Evolution** (Level 3 → Level 4):
- [ ] Evaluator-optimizer — reviewer agent checks response quality before sending (same LLM, different prompt); opt-in via `evaluate: true` in skill frontmatter; use cheaper model for evaluation
- [ ] Plan-validate-execute — planner agent generates step list, validator checks for invalid tools/unreasonable steps, executor runs the validated plan
- [ ] Specialist worker agents — route to domain-specific agents (Research, Code, Writing, Admin) each with tailored system prompts; `agent:` field in skill frontmatter
- [ ] Coder-reviewer for artifacts — reviewer agent checks generated React/HTML code for correctness and safety before rendering
- [ ] Orchestrator-workers — central orchestrator decomposes complex requests into subtasks, delegates to specialist workers (parallel where possible), synthesizes final output

**Additional Features**:
- [ ] Prompt chaining — sequential multi-step LLM pipelines
- [ ] Parallelization — sectioning/voting across multiple LLM calls
- [x] Agent-computer interface — per-tool typed parameter schemas with validation and multi-parameter support
- [ ] Scheduled agents — recurring tasks
- [ ] CI/CD & deployment pipeline
- [ ] Voice input/output

## License

MIT
