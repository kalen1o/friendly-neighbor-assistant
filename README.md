# Friendly Neighbor

An AI-powered chatbot agent that connects to your preferred AI provider, surfs the internet when needed, learns from your documents via RAG, and grows smarter over time through extensible skills, hooks, and MCP integrations.

## Features

### Core Chat
- **Multi-conversation support** — Create and manage separate chats organized by topic
- **Persistent chat history** — All messages and conversations stored in a database
- **AI provider integration** — Connect via API key to your chosen AI model
- **Document management tab** — Upload, view, and delete documents from within the chat UI; see which documents are in your knowledge base and their processing status

### RAG Knowledge Base
- **Document upload** — Users upload files (PDF, TXT, DOCX, Markdown, etc.) to build a personal knowledge base
- **Chunking pipeline** — Documents are split into optimized chunks with configurable strategy (fixed-size, semantic, recursive)
- **Vector embeddings** — Chunks are embedded and stored in a vector database for fast similarity search
- **Semantic search** — Retrieve the most relevant chunks for any query using vector similarity

### Smart Query Routing
The agent classifies each user message and decides the best strategy:

| Route              | When                                                        |
|--------------------|-------------------------------------------------------------|
| **Answer directly** | General knowledge, simple questions, casual conversation    |
| **Search knowledge base** | Query relates to uploaded documents or domain-specific data |
| **Research the web** | Needs real-time info, news, or data not in the knowledge base |
| **KB + Web combo**  | Combines internal documents with live web data for a complete answer |

- **Confidence scoring** — The agent evaluates its confidence and falls back to research when uncertain
- **Source attribution** — Cites which documents, chunks, or URLs informed the answer

### Extensibility
- **Skills** — Add new capabilities as modular skills the agent can invoke
- **Hooks** — Define pre/post-action hooks to customize agent behavior (e.g., logging, validation, transformations)
- **MCP (Model Context Protocol)** — Connect external tools and services to expand what the agent can do

## Tech Stack

> Full details in [tech-stack.md](tech-stack.md)

| Layer            | Technology                        |
|------------------|-----------------------------------|
| Frontend         | Next.js (React) + Tailwind + shadcn/ui |
| Backend / API    | FastAPI (Python)                  |
| Agent Core       | Pydantic AI (brain + query routing) |
| RAG Framework    | LlamaIndex (chunking + retrieval) |
| Database         | PostgreSQL                        |
| Vector DB        | pgvector (temporary, Qdrant later) |
| Embeddings       | OpenAI `text-embedding-3-small`   |
| AI Provider      | Anthropic Claude / OpenAI         |
| Web Search       | DuckDuckGo (free, no API key)     |
| Task Queue       | FastAPI BackgroundTasks            |
| ORM              | SQLAlchemy + Alembic              |
| File Processing  | Unstructured                      |
| Containerization | Docker + Docker Compose            |
| Task Runner      | Makefile                           |

## Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An API key from Anthropic or OpenAI

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-org>/friendly-neighbor-assistant.git
cd friendly-neighbor-assistant

# First-time setup — creates .env from template
make init

# Edit .env with your API keys
nano .env
```

### Running

```bash
# Start everything (database, backend, frontend)
make up

# Check logs
make logs

# Open the app
# Frontend: http://localhost:3000
# Backend API docs: http://localhost:8000/docs
```

### Common Commands

```bash
make up              # Start all services
make down            # Stop all services
make logs            # Tail all logs
make migrate         # Run database migrations
make shell-backend   # Open bash in backend container
make shell-db        # Open psql in database
make test            # Run tests
make help            # Show all available commands
```

## Project Structure

```
friendly-neighbor-assistant/
├── docker-compose.yml        # Orchestrates all services
├── Makefile                  # Simple command runner
├── .env.example              # Environment variable template
├── .gitignore
│
├── backend/                  # FastAPI + Pydantic AI + LlamaIndex
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py           # FastAPI entry point
│       ├── agent/            # Pydantic AI agent (brain + query routing)
│       ├── chat/             # Chat management and conversation routing
│       ├── rag/              # RAG pipeline
│       │   ├── chunking/     # Document chunking strategies
│       │   ├── embeddings/   # Embedding generation
│       │   ├── retrieval/    # Vector similarity search
│       │   └── upload/       # File upload and processing
│       ├── documents/        # Document management (list, view, delete)
│       ├── research/         # Web search module (DuckDuckGo)
│       ├── skills/           # Pluggable skill modules
│       ├── hooks/            # Pre/post-action hook system
│       ├── mcp/              # MCP server integrations
│       └── db/               # SQLAlchemy models + Alembic migrations
│
├── frontend/                 # Next.js + Tailwind + shadcn/ui
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── app/              # Next.js app router pages
│       ├── components/       # React components (chat, documents tab)
│       └── lib/              # API client, utilities
│
└── tests/
```

## Architecture Overview

```
User <-> Chat UI <-> Backend API
              |              |
        Document Tab    Agent Core
        (upload,       /    |    \
        manage)   Skills  Hooks   MCP
              |        \    |    /
              |     Query Router
              |     /          \
              v    v            v
         Vector DB          Web Search
        (RAG chunks,        (Internet)
        embeddings)             |
              |                 |
              +--------+--------+
                       |
                    Database
              (chats, messages, documents)
```

## Roadmap

- [ ] Project scaffolding and tech stack setup
- [ ] Database schema for chats, messages, sessions, and documents
- [ ] AI provider integration with API key config
- [ ] Basic chat loop (send message, get response, store in DB)
- [ ] Multi-conversation support (create, switch, delete chats)
- [ ] Document upload and processing pipeline
- [ ] Chunking engine (fixed-size, semantic, recursive strategies)
- [ ] Vector DB setup and embedding generation
- [ ] RAG retrieval — semantic search over uploaded documents
- [ ] Query router — classify intent (answer / search KB / search web / combo)
- [ ] Research module — web search for real-time information
- [ ] Document management tab in chat UI (upload, list, view, delete)
- [ ] Skill system — load and invoke modular skills
- [ ] Hook system — register pre/post-action hooks
- [ ] MCP integration — connect external tools
- [ ] Frontend chat UI

## License

MIT
