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

## Phase 1: Foundation

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

## Phase 2: Basic Chat (BE + FE)

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

### Frontend Layout

```
┌─────────────────────────────────────────────┐
│  Friendly Neighbor                          │
├──────────┬──────────────────────────────────┤
│ [Docs]   │                                  │
│──────────│  Chat messages area              │
│ CHATS    │                                  │
│ + New    │  [User]: How do I...            │
│ Chat 1   │  [Assistant]: You can...         │
│ Chat 2   │                                  │
│ Chat 3   │                                  │
│          │                                  │
│          ├──────────────────────────────────┤
│          │  [Type a message...]  [Send ►]   │
└──────────┴──────────────────────────────────┘
```

- Sidebar: "Docs" button at top → navigates to `/documents` (Phase 3)
- Sidebar: "New chat" button, list of chats with title + relative time
- Sidebar: active chat highlighted, click to switch
- Main area: scrollable message list, auto-scroll on new messages
- Messages: markdown rendering (`react-markdown`), distinct styles for user/assistant
- Input: text area, send on Enter (Shift+Enter for newline), disabled while streaming
- Streaming: tokens appear in real-time via SSE (`EventSource`)

### Deliverables

- Create chat, send messages, receive streamed AI responses
- Multiple conversations with persistent history
- Auto-generated chat titles
- Responsive sidebar with chat list

---

## Phase 3: RAG Pipeline (BE + FE)

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
    stmt = (
        select(DocumentChunk)
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )
    results = await db.execute(stmt)
    return [
        {"text": c.chunk_text, "document_id": c.document_id,
         "filename": c.document.filename, "chunk_index": c.chunk_index,
         "score": 1 - cosine_distance}
        for c in results.scalars()
    ]
```

Not exposed as an API endpoint — used internally by the agent in Phase 4.

### Backend Structure (new files)

```
backend/app/
├── documents/
│   ├── __init__.py
│   ├── models.py        # Document, DocumentChunk SQLAlchemy models
│   ├── router.py        # FastAPI router for /api/documents
│   ├── schemas.py       # Pydantic request/response models
│   └── service.py       # Upload handling, status checks
├── rag/
│   ├── __init__.py
│   ├── processing.py    # Background task: parse → chunk → embed → store
│   ├── chunking.py      # LlamaIndex chunking config
│   ├── embeddings.py    # OpenAI embedding generation
│   └── retrieval.py     # search_knowledge_base function
```

### Frontend — Documents Page (`/documents`)

```
┌─────────────────────────────────────────────┐
│  Friendly Neighbor                          │
├──────────┬──────────────────────────────────┤
│ [Docs]   │                                  │
│──────────│  Knowledge Base                  │
│ CHATS    │                                  │
│ + New    │  ┌─────────────────────────┐     │
│ Chat 1   │  │  Drop files here or     │     │
│ Chat 2   │  │  click to upload        │     │
│          │  └─────────────────────────┘     │
│          │                                  │
│          │  ┌──────────────────────────────┐│
│          │  │ Name       Status   Size   ✕ ││
│          │  ├──────────────────────────────┤│
│          │  │ policy.pdf  ● Ready  2.1MB 🗑││
│          │  │ guide.docx  ◐ Proc.  890KB   ││
│          │  │ notes.txt   ✕ Failed 12KB  🗑││
│          │  └─────────────────────��────────┘│
│          │                                  │
└──────────┴──────────────────────────────────┘
```

- Same shared sidebar as chat pages
- Drag-and-drop upload zone (`react-dropzone`)
- Document table: filename, status indicator (● ready / ◐ processing / ✕ failed), file size, delete button
- Poll `/api/documents/{id}/status` every 2 seconds while status is "processing"
- Failed documents show error message on hover/click

### Frontend Structure (new files)

```
frontend/src/
├── app/
│   └── documents/
│       └── page.tsx         # Documents management page
├── components/
│   ├── document-upload.tsx  # Drag-and-drop upload zone
│   └── document-list.tsx    # Document table with status
```

### Deliverables

- Upload PDF, DOCX, TXT, MD, HTML, CSV files
- Background processing with status tracking
- Vector embeddings stored in pgvector
- Retrieval function ready for Phase 4 agent
- Documents page with upload, list, status, delete

---

## Phase 4: Agent Core (BE + FE updates)

### Swap LLM Provider → Pydantic AI Agent

Replace `llm/provider.py` direct SDK calls with a Pydantic AI agent.

### Backend Structure (new/modified files)

```
backend/app/
├── agent/
│   ├── __init__.py
│   ├── agent.py          # Pydantic AI agent definition + tools
│   └── tools.py          # Tool functions (search_kb, search_web)
├── llm/
│   └── provider.py       # DELETED — replaced by agent
```

### Agent Definition

```python
from pydantic_ai import Agent
from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool

agent = Agent(
    model=configured_model,
    system_prompt="You are Friendly Neighbor, a helpful AI assistant. "
                  "Use search_knowledge_base when the user asks about their documents. "
                  "Use web search when you need current information.",
    tools=[
        search_knowledge_base,
        duckduckgo_search_tool(),
    ],
)
```

### Tools

| Tool | Input | Returns | Description for agent |
|------|-------|---------|----------------------|
| `search_knowledge_base` | `query: str` | `list[{text, filename, score}]` | "Search the user's uploaded documents for relevant information" |
| `duckduckgo_search_tool` | built-in | built-in | Pydantic AI common tool, no custom code |

### Changes to Message Endpoint

`POST /api/chats/{id}/messages` changes:
- Replace `stream_llm_response()` with `agent.run_stream()`
- Agent may call tools before generating the response
- After response, extract which tools were called and save as sources

### New Column on Messages Table

```python
# Alembic migration: add sources column
sources: Column(JSONB, nullable=True)
```

Example values:
```json
[
  {"type": "document", "filename": "policy.pdf", "chunk_text": "...", "score": 0.92},
  {"type": "web", "url": "https://example.com", "title": "Example", "snippet": "..."}
]
```

### Frontend Updates

**Source attribution below assistant messages:**

```
[Assistant]: Based on your refund policy, enterprise
clients can request a full refund within 30 days...

  ▼ Sources
  📄 policy.pdf (92% match)
  🌐 Example Corp — Refund Guidelines
```

- Collapsible "Sources" section below assistant messages (only when `sources` is not empty)
- Document sources: filename + relevance percentage
- Web sources: title as clickable link

### Frontend Structure (modified files)

```
frontend/src/components/
├── message-bubble.tsx      # MODIFIED — add sources display
└── source-attribution.tsx  # NEW — collapsible sources component
```

### Deliverables

- Pydantic AI agent with tool selection (KB search + web search)
- Agent autonomously decides when to use tools vs. answer directly
- Source attribution stored in DB and displayed in UI
- DuckDuckGo web search working via built-in Pydantic AI tool
- All Phase 2 chat functionality preserved (streaming, multi-conversation)

---

## Phase 5: Extensibility

Designed separately after Phase 4 is complete. Will cover:
- Skills system (pluggable capabilities)
- Hooks system (pre/post-action)
- MCP integration (external tools)

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
- Event types: `message` (token chunk), `title` (auto-generated title), `done` (stream complete), `error`

---

## Implementation Checklist

### Phase 1: Foundation
**Checkpoint: FastAPI starts, connects to DB, LLM provider returns responses**

- [ ] **1.1** Create `backend/app/__init__.py`
- [ ] **1.2** Create `backend/app/config.py` — Pydantic Settings class loading `.env`
- [ ] **1.3** Create `backend/app/db/base.py` — `DeclarativeBase`
- [ ] **1.4** Create `backend/app/db/engine.py` — `create_async_engine`, `async_sessionmaker`
- [ ] **1.5** Create `backend/app/db/session.py` — `get_db` FastAPI dependency
- [ ] **1.6** Create `backend/app/main.py` — FastAPI app with lifespan, CORS, health check (`GET /api/health`)
- [ ] **1.7** Initialize Alembic — `alembic init`, configure `alembic.ini` and `env.py` for async
- [ ] **1.8** Create `backend/app/llm/__init__.py`
- [ ] **1.9** Create `backend/app/llm/provider.py` — `get_llm_response()` and `stream_llm_response()` supporting both Anthropic and OpenAI
- [ ] **1.10** Verify: `make up` starts all containers, `GET /api/health` returns 200
- [ ] **1.11** Verify: Alembic empty migration runs against Postgres
- [ ] **1.12** Verify: LLM provider returns response from configured provider (test via `/docs`)

### Phase 2: Basic Chat — Backend
**Checkpoint: Chat CRUD + streaming AI responses work via Swagger**

- [ ] **2.1** Create `backend/app/chat/__init__.py`
- [ ] **2.2** Create `backend/app/chat/models.py` — `Chat` and `Message` SQLAlchemy models
- [ ] **2.3** Create Alembic migration for `chats` and `messages` tables
- [ ] **2.4** Run migration: `make migrate`
- [ ] **2.5** Create `backend/app/chat/schemas.py` �� Pydantic request/response models (ChatCreate, ChatResponse, MessageCreate, MessageResponse)
- [ ] **2.6** Create `backend/app/chat/service.py` — business logic (create chat, list chats, get chat with messages, delete chat, send message)
- [ ] **2.7** Create `backend/app/chat/router.py` — FastAPI router with all endpoints
- [ ] **2.8** Register chat router in `main.py`
- [ ] **2.9** Implement SSE streaming for `POST /api/chats/{id}/messages`
- [ ] **2.10** Implement auto-title generation after first assistant response
- [ ] **2.11** Verify: create chat, send message, receive streamed response via Swagger
- [ ] **2.12** Verify: list chats, get chat history, delete chat via Swagger

### Phase 2: Basic Chat — Frontend
**Checkpoint: Working chat UI with sidebar, multiple conversations, streaming**

- [ ] **2.13** Initialize Next.js project in `frontend/` — `npx create-next-app`
- [ ] **2.14** Install dependencies: `tailwindcss`, `shadcn/ui`, `react-markdown`
- [ ] **2.15** Create `frontend/src/lib/api.ts` — API client (fetch wrappers for all chat endpoints)
- [ ] **2.16** Create `frontend/src/app/layout.tsx` — root layout with sidebar
- [ ] **2.17** Create `frontend/src/components/sidebar.tsx` — shared sidebar component (Docs button + chat list)
- [ ] **2.18** Create `frontend/src/components/chat-list.tsx` — list of conversations with new/delete actions
- [ ] **2.19** Create `frontend/src/app/page.tsx` — landing page (empty state or redirect)
- [ ] **2.20** Create `frontend/src/app/chat/[id]/page.tsx` — chat view page
- [ ] **2.21** Create `frontend/src/components/chat-messages.tsx` — scrollable message history
- [ ] **2.22** Create `frontend/src/components/message-bubble.tsx` — single message with markdown rendering
- [ ] **2.23** Create `frontend/src/components/chat-input.tsx` — input box + send button
- [ ] **2.24** Implement SSE streaming — tokens appear in real-time as assistant responds
- [ ] **2.25** Implement auto-scroll on new messages
- [ ] **2.26** Implement sidebar highlights active chat, updates title on auto-title event
- [ ] **2.27** Verify: create new chat from sidebar, send messages, see streamed response
- [ ] **2.28** Verify: switch between conversations, delete a chat, titles auto-generate

### Phase 3: RAG Pipeline — Backend
**Checkpoint: Upload documents, background processing works, chunks stored in pgvector**

- [ ] **3.1** Create `backend/app/documents/__init__.py`
- [ ] **3.2** Create `backend/app/documents/models.py` — `Document` and `DocumentChunk` models (with `Vector(1536)`)
- [ ] **3.3** Create Alembic migration for `documents` and `document_chunks` tables + HNSW index on embedding
- [ ] **3.4** Run migration: `make migrate`
- [ ] **3.5** Create `backend/app/documents/schemas.py` — Pydantic request/response models
- [ ] **3.6** Create `backend/app/rag/__init__.py`
- [ ] **3.7** Create `backend/app/rag/chunking.py` — LlamaIndex SentenceSplitter config (512 tokens, 50 overlap)
- [ ] **3.8** Create `backend/app/rag/embeddings.py` — OpenAI embedding generation (single + batch)
- [ ] **3.9** Create `backend/app/rag/processing.py` — background task: parse (Unstructured) → chunk → embed → store
- [ ] **3.10** Create `backend/app/rag/retrieval.py` — `search_knowledge_base()` function using pgvector cosine search
- [ ] **3.11** Create `backend/app/documents/service.py` — upload handling, status checks
- [ ] **3.12** Create `backend/app/documents/router.py` — FastAPI router for `/api/documents`
- [ ] **3.13** Register documents router in `main.py`
- [ ] **3.14** Verify: upload a PDF via Swagger, check status transitions (processing → ready)
- [ ] **3.15** Verify: list documents, delete document + cascaded chunks
- [ ] **3.16** Verify: `search_knowledge_base()` returns relevant chunks (test manually via shell)

### Phase 3: RAG Pipeline — Frontend
**Checkpoint: Documents page with upload, status tracking, delete**

- [ ] **3.17** Update `frontend/src/lib/api.ts` — add document API client functions
- [ ] **3.18** Install `react-dropzone`
- [ ] **3.19** Create `frontend/src/app/documents/page.tsx` — documents management page
- [ ] **3.20** Create `frontend/src/components/document-upload.tsx` — drag-and-drop upload zone
- [ ] **3.21** Create `frontend/src/components/document-list.tsx` — document table with status indicators
- [ ] **3.22** Implement status polling — poll every 2s while document is "processing"
- [ ] **3.23** Update `frontend/src/components/sidebar.tsx` — wire up Docs button to navigate to `/documents`
- [ ] **3.24** Verify: upload file via drag-and-drop, see status change from processing → ready
- [ ] **3.25** Verify: delete document, see it removed from list
- [ ] **3.26** Verify: failed upload shows error indicator

### Phase 4: Agent Core — Backend
**Checkpoint: Pydantic AI agent with KB + web search tools, sources saved to DB**

- [ ] **4.1** Install `pydantic-ai[anthropic,openai,duckduckgo,mcp]` (already in requirements.txt)
- [ ] **4.2** Create `backend/app/agent/__init__.py`
- [ ] **4.3** Create `backend/app/agent/tools.py` — `search_knowledge_base` tool wrapper (calls `rag/retrieval.py`)
- [ ] **4.4** Create `backend/app/agent/agent.py` — Pydantic AI agent definition with system prompt + tools
- [ ] **4.5** Create Alembic migration: add `sources` JSONB column to `messages` table
- [ ] **4.6** Run migration: `make migrate`
- [ ] **4.7** Update `backend/app/chat/models.py` — add `sources` column to `Message` model
- [ ] **4.8** Update `backend/app/chat/schemas.py` — add `sources` to MessageResponse
- [ ] **4.9** Update `backend/app/chat/service.py` — replace `stream_llm_response()` with `agent.run_stream()`
- [ ] **4.10** Update `backend/app/chat/service.py` — extract tool calls from agent result, save as sources
- [ ] **4.11** Delete `backend/app/llm/provider.py` (replaced by agent)
- [ ] **4.12** Verify: send a general question → agent answers directly (no tools called)
- [ ] **4.13** Verify: ask about uploaded document → agent calls `search_knowledge_base`, sources saved
- [ ] **4.14** Verify: ask about current news → agent calls DuckDuckGo, sources saved
- [ ] **4.15** Verify: streaming still works end-to-end

### Phase 4: Agent Core — Frontend
**Checkpoint: Source attribution displayed below assistant messages**

- [ ] **4.16** Create `frontend/src/components/source-attribution.tsx` — collapsible sources component
- [ ] **4.17** Update `frontend/src/components/message-bubble.tsx` — render sources below assistant messages
- [ ] **4.18** Update `frontend/src/lib/api.ts` — include `sources` in message response type
- [ ] **4.19** Verify: ask about a document → see "📄 filename (score)" in sources
- [ ] **4.20** Verify: ask about current events → see "🌐 title (link)" in sources
- [ ] **4.21** Verify: general question → no sources section shown

### Phase 5: Extensibility
- [ ] **5.1** Design skills, hooks, and MCP systems (separate brainstorming session)
