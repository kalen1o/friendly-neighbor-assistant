# Friendly Neighbor — Implementation Design Spec

## Overview

AI chatbot agent with RAG, web search, and extensible skills. Users upload documents to a knowledge base, chat across multiple conversations, and the agent routes queries to the right source.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build order | Chat → RAG → Agent → Extensibility | Get a working chatbot first, layer intelligence |
| BE + FE | Together per phase (except Phase 1) | Every API has a consumer, no dead endpoints |
| Initial LLM | Direct SDK call → Pydantic AI in Phase 4 | Simpler to debug early, swap when tools needed |
| Migrations | Alembic from day one | Proper schema history from the start |
| AI provider | Both Anthropic + OpenAI via `.env` | User chooses provider, same interface |
| Query routing | No explicit router — agent decides via tools | LLM is the router, simpler than hand-coded classifier |
| Approach | Bottom-up with FE alongside | Solid foundation, incremental features |

---

## Phase 1: Foundation ✅

No UI. Pure infrastructure that everything else depends on.

### Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, CORS, lifespan
│   ├── config.py            # Pydantic Settings (loads .env)
│   ├── db/
│   │   ├── __init__.py
│   │   ├── engine.py        # create_async_engine, async session factory
│   │   ├── base.py          # DeclarativeBase
│   │   └── session.py       # get_db dependency for FastAPI
│   ├── llm/
│   │   ├── __init__.py
│   │   └── provider.py      # LLM abstraction — call Claude or OpenAI
│   └── alembic/
│       ├── env.py            # async Alembic config
│       └── versions/
├── alembic.ini
├── requirements.txt
└── Dockerfile
```

### Config (`config.py`)

Single `Settings` class using `pydantic-settings`:

```python
class Settings(BaseSettings):
    ai_provider: str = "anthropic"          # "anthropic" or "openai"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    database_url: str
    embedding_model: str = "text-embedding-3-small"

    model_config = SettingsConfigDict(env_file=".env")
```

Injected into FastAPI via dependency.

### DB Engine (`db/engine.py`)

- `create_async_engine` with `asyncpg` driver
- `async_sessionmaker` for session factory
- FastAPI lifespan event: create engine on startup, dispose on shutdown

### DB Session (`db/session.py`)

- `get_db` async generator — yields `AsyncSession`, used as FastAPI `Depends()`

### LLM Provider (`llm/provider.py`)

Two functions:

```python
async def get_llm_response(messages: list[dict], settings: Settings) -> str:
    """Non-streaming. Calls Claude or OpenAI based on settings.ai_provider."""

async def stream_llm_response(messages: list[dict], settings: Settings) -> AsyncIterator[str]:
    """Streaming. Yields text chunks. Used for SSE in chat endpoint."""
```

- Uses `anthropic.AsyncAnthropic` or `openai.AsyncOpenAI` directly
- No Pydantic AI yet — replaced in Phase 4
- System prompt defined here as a constant

### Alembic

- `alembic.ini` points to `DATABASE_URL` from config
- `env.py` configured for async engine (`asyncpg`)
- Imports `Base.metadata` from `db/base.py` for autogenerate

### Deliverables

- FastAPI app starts, connects to PostgreSQL, health check endpoint (`GET /api/health`)
- Alembic `init` done, empty migration runs successfully
- LLM provider returns response from Claude or OpenAI (testable via `/docs`)

---

## Phase 2: Basic Chat (BE + FE) ✅

### Database Models

**chats:**

| Column | Type | Notes |
|--------|------|-------|
| id | int | PK, autoincrement |
| title | str (nullable) | Auto-generated from first message |
| created_at | datetime | server default `now()` |
| updated_at | datetime | updated on each new message |

**messages:**

| Column | Type | Notes |
|--------|------|-------|
| id | int | PK, autoincrement |
| chat_id | int | FK → chats.id, cascade delete |
| role | str | "user" or "assistant" |
| content | text | message body |
| created_at | datetime | server default `now()` |

One Alembic migration for both tables.

### API Endpoints

| Method | Path | What it does | Response |
|--------|------|-------------|----------|
| `POST` | `/api/chats` | Create new chat (optional title) | `201` — chat object |
| `GET` | `/api/chats` | List all chats, ordered by `updated_at` desc | `200` — list of {id, title, updated_at} |
| `GET` | `/api/chats/{id}` | Get chat with all messages | `200` — chat + messages[] |
| `DELETE` | `/api/chats/{id}` | Delete chat + cascade messages | `204` |
| `PATCH` | `/api/chats/{id}` | Update chat title | `200` — updated chat |
| `POST` | `/api/chats/{id}/messages` | Send message, get streamed response | SSE stream |

### Message Flow (`POST /api/chats/{id}/messages`)

1. Validate chat exists
2. Save user message to `messages` table
3. Load all previous messages for this chat (context window)
4. Call `stream_llm_response()` with chat history + new message
5. Stream response back to client via Server-Sent Events (SSE)
6. After stream completes, save full assistant response to `messages` table
7. Update `chats.updated_at`

### Auto-Title

After the first assistant response in a chat with no title:
- Make a quick non-streaming LLM call: "Summarize this conversation in 3-5 words as a title"
- Update `chats.title`
- Included in the SSE stream as a final event so frontend updates the sidebar

### Frontend Structure

```
frontend/src/
├── app/
│   ├── layout.tsx           # Root layout with sidebar
│   ├── page.tsx             # Redirect to /chat or empty state
│   └── chat/
│       └── [id]/
│           └── page.tsx     # Chat view for specific conversation
├── components/
│   ├── sidebar.tsx          # Shared sidebar (chats list, docs button)
│   ├── chat-list.tsx        # List of conversations in sidebar
│   ├── chat-messages.tsx    # Message history display
│   ├── chat-input.tsx       # Input box + send button
│   └── message-bubble.tsx   # Single message with markdown rendering
└── lib/
    └── api.ts               # API client (fetch wrappers)
```

### Deliverables

- Create chat, send messages, receive streamed AI responses
- Multiple conversations with persistent history
- Auto-generated chat titles
- Responsive sidebar with chat list

---

## Phase 3: RAG Pipeline (BE + FE) ✅

### Database Models

**documents:**

| Column | Type | Notes |
|--------|------|-------|
| id | int | PK, autoincrement |
| filename | str | original upload name |
| file_type | str | "pdf", "docx", "txt", "md", "html", "csv" |
| file_size | int | bytes |
| status | str | "processing", "ready", "failed" |
| error_message | str (nullable) | populated on failure |
| chunk_count | int | default 0, updated after processing |
| created_at | datetime | server default `now()` |

**document_chunks:**

| Column | Type | Notes |
|--------|------|-------|
| id | int | PK, autoincrement |
| document_id | int | FK → documents.id, cascade delete |
| chunk_text | text | the chunk content |
| chunk_index | int | position in original document |
| embedding | Vector(1536) | pgvector column |
| metadata | JSONB | page number, heading, etc. |

One Alembic migration for both tables. HNSW index on `embedding` column for fast cosine search.

### API Endpoints

| Method | Path | What it does | Response |
|--------|------|-------------|----------|
| `POST` | `/api/documents/upload` | Upload file, start processing | `202` — {id, status: "processing"} |
| `GET` | `/api/documents` | List all documents | `200` — list of docs |
| `GET` | `/api/documents/{id}` | Get document details | `200` — document object |
| `DELETE` | `/api/documents/{id}` | Delete document + chunks | `204` |
| `GET` | `/api/documents/{id}/status` | Poll processing status | `200` — {status, chunk_count} |

### Background Processing Pipeline

Triggered via `FastAPI BackgroundTasks` after upload:

```
1. Parse file → raw text
   Tool: Unstructured (partition function based on file type)

2. Split into chunks
   Tool: LlamaIndex SentenceSplitter
   Config: chunk_size=512 tokens, chunk_overlap=50 tokens

3. Generate embeddings
   Tool: OpenAI text-embedding-3-small
   Batch: embed all chunks in one API call (or batches of 100)

4. Store in pgvector
   Bulk insert: chunk_text + embedding + metadata into document_chunks

5. Update document record
   Success: status → "ready", chunk_count → N
   Failure: status → "failed", error_message → str(error)
```

### Retrieval Function

```python
async def search_knowledge_base(query: str, db: AsyncSession, top_k: int = 5) -> list[dict]:
    query_embedding = await generate_embedding(query)
    # pgvector cosine search with relevance threshold (min_score=0.65)
```

Not exposed as an API endpoint — used internally by the agent in Phase 4.

### Deliverables

- Upload PDF, DOCX, TXT, MD, HTML, CSV files
- Background processing with status tracking
- Vector embeddings stored in pgvector
- Retrieval function ready for Phase 4 agent
- Documents page with upload, list, status, delete

---

## Phase 4: Agent Core (BE + FE updates) ✅

### Agent with Skill Registry + Tool Calling

Agent uses a `SkillRegistry` to discover and execute tools dynamically.

### Tools

| Tool | Input | Returns | Description for agent |
|------|-------|---------|----------------------|
| `search_knowledge_base` | `query: str` | `list[{text, filename, score}]` | "Search the user's uploaded documents for relevant information" |
| `web_search` | `query: str` | `list[{url, title, snippet}]` | DuckDuckGo web search for current information |
| `calculate` | `expression: str` | `str` | Evaluate mathematical expressions |

### Source Attribution

```json
[
  {"type": "document", "filename": "policy.pdf", "chunk_text": "...", "score": 0.92},
  {"type": "web", "url": "https://example.com", "title": "Example", "snippet": "..."}
]
```

### Deliverables

- Agent with skill registry and dynamic tool selection
- KB search + web search + calculator tools
- Source attribution stored in DB and displayed in UI
- Streaming with tool calling (multi-round tool execution)
- All Phase 2 chat functionality preserved

---

## Phase 5: Extensibility ✅

### Skills System

Markdown-based skill definitions with YAML frontmatter. Three types:
- **tool** — has a Python executor function (web_search, calculate, etc.)
- **knowledge** — adds to system prompt (coding_assistant, writing_assistant)
- **workflow** — multi-step operations using other skills

Built-in skills live in `backend/skills/`. User skills stored in `skills` DB table.

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/skills` | List built-in + user skills |
| `POST` | `/api/skills` | Create custom skill |
| `PATCH` | `/api/skills/{id}` | Update skill |
| `DELETE` | `/api/skills/{id}` | Delete skill |

### Hooks System

Event-driven hooks at key points in the message lifecycle:
- `pre_message` — before processing
- `pre_skills` — before skill selection
- `post_llm` — after LLM response
- `post_message` — after response saved

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/hooks` | List built-in + user hooks |
| `POST` | `/api/hooks` | Create custom hook |
| `PATCH` | `/api/hooks/{id}` | Update hook |
| `DELETE` | `/api/hooks/{id}` | Delete hook |

### MCP Integration (Model Context Protocol)

Connect external tool servers via MCP protocol. Per-server and per-tool enable/disable.

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/mcp/servers` | List MCP servers |
| `POST` | `/api/mcp/servers` | Add MCP server |
| `PATCH` | `/api/mcp/servers/{id}` | Update server |
| `DELETE` | `/api/mcp/servers/{id}` | Delete server |
| `POST` | `/api/mcp/servers/{id}/refresh` | Refresh tools |
| `GET` | `/api/mcp/servers/{id}/tools` | List tools |
| `PATCH` | `/api/mcp/tools/{id}` | Enable/disable tool |

### Deliverables

- Skills CRUD + execution + per-user caching
- Hooks CRUD + execution at lifecycle hook points
- MCP server management + tool discovery + execution
- Frontend pages for Skills, Hooks, and MCP management

---

## Phase 6: Auth, Sharing & Export ✅

### Authentication

- User registration with password validation (bcrypt)
- Login with JWT access tokens + refresh token cookies (httpOnly, secure)
- Refresh token rotation stored in DB (hashed)
- Rate limiting on login/register endpoints
- Per-user data isolation (chats, documents, skills, hooks, MCP servers)

### Chat Sharing

- Create shareable links (public or authenticated-only visibility)
- Read-only snapshot of conversation at share time
- Revoke shares, list shares per chat
- Shared chat view page (`/shared/[id]`)

### Chat Export

- Export conversation as Markdown (`.md`)
- Export conversation as PDF (via `fpdf2`)

### Deliverables

- Full auth system with JWT + refresh tokens
- Chat sharing with snapshot-based read-only links
- Chat export to Markdown and PDF
- Delete all chats from settings

---

## Phase 7: Artifacts ✅

### Live-rendered code artifacts

When the LLM generates UI code, it wraps it in `<artifact>` tags. The frontend parses these and renders them live.

- **React artifacts**: rendered in sandboxed iframe with React 18 + Tailwind CDN
- **HTML artifacts**: rendered as-is in sandboxed iframe
- Artifact CRUD: list per chat, update code, get individual
- Code editor with syntax highlighting (Prism.js)
- Preview/Code toggle with reload and loading state

### Database Model

**artifacts:**

| Column | Type | Notes |
|--------|------|-------|
| id | int | PK |
| public_id | str | URL-safe ID |
| message_id | int | FK → messages.id |
| chat_id | int | FK → chats.id |
| user_id | int | FK → users.id |
| title | str | artifact name |
| artifact_type | str | "react" or "html" |
| code | text | source code |

### Deliverables

- Artifact parsing from LLM responses
- Live preview panel with slide-in animation
- Editable code editor (react-simple-code-editor + Prism)
- Download artifacts as `.jsx` or `.html`
- Auto-save edits with debounce

---

## Phase 8: UX Polish ✅

### Frontend improvements

- **Dark mode**: system detection + manual toggle (light/dark/system)
- **Mobile responsive**: sidebar becomes sheet on mobile, touch-friendly targets
- **Command palette**: `Cmd+K` search with chat search + quick navigation
- **Collapsible sidebar**: expand/collapse with logo toggle
- **Chat modes**: Fast / Balanced / Thinking mode selector
- **File attachments**: paste images, attach files to chat messages
- **Message editing**: edit sent messages and regenerate response
- **Typewriter effect**: buffered streaming for natural text appearance
- **Settings dialog**: user preferences, delete all chats
- **Export dialog**: choose Markdown or PDF format
- **Toast notifications**: success/error feedback (sonner)
- **Skeleton loading**: chat list, document list loading states

### Backend optimizations

- **RAG relevance threshold**: filter chunks below 0.65 cosine similarity
- **LLM retry logic**: exponential backoff (tenacity) for rate limits and transient errors
- **Embedding dedup cache**: SHA-256 hash-based in-memory cache, skip re-embedding identical chunks
- **N+1 query fix**: eager loading of message files via nested selectinload
- **SSE error recovery**: rollback + partial message save on stream errors
- **Per-user caching**: TTL cache for agent registry, hooks, skills (60s)

### Deliverables

- Polished, production-ready UI across desktop and mobile
- Backend resilience and performance optimizations

---

## Cross-Cutting Concerns

### Error Handling

- FastAPI exception handlers for 404 (chat/document not found), 422 (validation), 500 (unexpected)
- Background task failures captured in `documents.error_message`
- Frontend shows error toasts for API failures

### CORS

- Backend allows `http://localhost:3000` in development
- Configured in `main.py` lifespan

### File Size Limits

- Max upload: 50MB (configurable)
- Enforced at FastAPI level via `UploadFile` size check

### Streaming Protocol

- Server-Sent Events (SSE) for chat responses
- Event types: `action` (agent status), `message` (token chunk), `sources` (JSON), `artifact` (JSON), `title` (auto-generated), `metrics` (JSON), `done`, `error`

---

## Implementation Checklist

### Phase 1: Foundation
**Checkpoint: FastAPI starts, connects to DB, LLM provider returns responses**

- [x] **1.1** Create `backend/app/__init__.py`
- [x] **1.2** Create `backend/app/config.py` — Pydantic Settings class loading `.env`
- [x] **1.3** Create `backend/app/db/base.py` — `DeclarativeBase`
- [x] **1.4** Create `backend/app/db/engine.py` — `create_async_engine`, `async_sessionmaker`
- [x] **1.5** Create `backend/app/db/session.py` — `get_db` FastAPI dependency
- [x] **1.6** Create `backend/app/main.py` — FastAPI app with lifespan, CORS, health check (`GET /api/health`)
- [x] **1.7** Initialize Alembic — `alembic init`, configure `alembic.ini` and `env.py` for async
- [x] **1.8** Create `backend/app/llm/__init__.py`
- [x] **1.9** Create `backend/app/llm/provider.py` — `get_llm_response()` and `stream_llm_response()` supporting both Anthropic and OpenAI
- [x] **1.10** Verify: `make up` starts all containers, `GET /api/health` returns 200
- [x] **1.11** Verify: Alembic empty migration runs against Postgres
- [x] **1.12** Verify: LLM provider returns response from configured provider (test via `/docs`)

### Phase 2: Basic Chat — Backend
**Checkpoint: Chat CRUD + streaming AI responses work via Swagger**

- [x] **2.1–2.12** All chat backend tasks complete

### Phase 2: Basic Chat — Frontend
**Checkpoint: Working chat UI with sidebar, multiple conversations, streaming**

- [x] **2.13–2.28** All chat frontend tasks complete

### Phase 3: RAG Pipeline — Backend
**Checkpoint: Upload documents, background processing works, chunks stored in pgvector**

- [x] **3.1–3.16** All RAG backend tasks complete

### Phase 3: RAG Pipeline — Frontend
**Checkpoint: Documents page with upload, status tracking, delete**

- [x] **3.17–3.26** All RAG frontend tasks complete

### Phase 4: Agent Core — Backend
**Checkpoint: Agent with tool selection, KB + web search, sources saved to DB**

- [x] **4.1–4.15** All agent backend tasks complete

### Phase 4: Agent Core — Frontend
**Checkpoint: Source attribution displayed below assistant messages**

- [x] **4.16–4.21** All agent frontend tasks complete

### Phase 5: Extensibility
- [x] **5.1** Skills system — built-in + custom CRUD + execution + frontend page
- [x] **5.2** Hooks system — built-in + custom CRUD + lifecycle hook points + frontend page
- [x] **5.3** MCP integration — server management + tool discovery + execution + frontend page

### Phase 6: Auth, Sharing & Export
- [x] **6.1** Authentication — register, login, JWT + refresh tokens, rate limiting
- [x] **6.2** Chat sharing — public/authenticated links, snapshots, revoke
- [x] **6.3** Chat export — Markdown and PDF download

### Phase 7: Artifacts
- [x] **7.1** Artifact parsing from LLM `<artifact>` tags
- [x] **7.2** Live preview panel (React + HTML, sandboxed iframe)
- [x] **7.3** Code editor with syntax highlighting
- [x] **7.4** Download artifacts, auto-save edits

### Phase 8: UX Polish
- [x] **8.1** Dark mode (system + manual toggle)
- [x] **8.2** Mobile responsive layout
- [x] **8.3** Command palette (Cmd+K)
- [x] **8.4** Collapsible sidebar
- [x] **8.5** Chat modes (fast/balanced/thinking)
- [x] **8.6** File attachments in chat
- [x] **8.7** Message editing
- [x] **8.8** Backend optimizations (retry, caching, N+1 fix, RAG threshold)

### Phase 9: Future
- [ ] **9.1** Conversation branching (fork from any message)
- [ ] **9.2** Collaborative chats (multi-user real-time)
- [ ] **9.3** Scheduled agents (recurring tasks)
- [ ] **9.4** Plugin marketplace for community skills
- [ ] **9.5** Voice input/output
- [ ] **9.6** Mobile native app (React Native)
- [ ] **9.7** Self-hosted deployment guide
- [ ] **9.8** Admin dashboard with usage analytics
- [ ] **9.9** Workspace / team support with shared knowledge bases
- [ ] **9.10** Fine-tuned model support for custom domains
