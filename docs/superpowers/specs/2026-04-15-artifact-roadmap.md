# Friendly Neighbor — Project Roadmap

Last updated: 2026-04-16

---

## Completed

### RAG Enhancements (Apr 13)

All planned enhancements shipped and live on main:

- **Hybrid search** — vector (pgvector) + PostgreSQL FTS with Reciprocal Rank Fusion
- **Cohere reranking** — `rerank-v3.5` via Cohere API, graceful fallback if disabled
- **Citation highlighting** — `[N]` inline markers in LLM output, clickable badges that scroll to sources
- **Semantic chunking** — header-aware splitting (markdown/HTML), configurable overlap and chunk size
- **Configurability** — all RAG settings via env vars (`RAG_HYBRID_SEARCH_ENABLED`, `RAG_RERANK_ENABLED`, `COHERE_API_KEY`, `RAG_TOP_K`, etc.)
- **Source attribution** — numbered citations with filename, relevance score, and chunk excerpts in frontend

Branch `feature/rag-enhancements` deleted (was fully merged, stale).

### Multi-File Artifacts — Phase 1: Sandpack (Apr 14-15)

- Unified `type="project"` format with JSON manifest
- Sandpack rendering (react, react-ts, vanilla templates)
- File explorer + tabbed Code/Preview
- Streaming file delivery (artifact_start/file/end SSE events)
- Edit-and-iterate (artifact context sent with follow-up messages)
- Dependency auto-detection from imports
- Template auto-detection from file extensions
- Error recovery with "Fix this" button
- Auto-injected entry files (index.js/index.tsx)

### Multi-File Artifacts — Phase 2: WebContainers (Apr 16)

- WebContainer support for full-stack artifacts (Next.js, Express/Fastify, Vite)
- Isolated `/sandbox` route with COOP/COEP headers (`credentialless` on parent, `require-corp` on sandbox)
- Terminal (xterm) with interactive shell — users can type commands
- Collapsible terminal panel, auto-collapses when dev server ready, logs preserved
- Adaptive layout: preview-first for UI projects (nextjs/vite), terminal-first for servers (node-server)
- PostMessage protocol for parent ↔ sandbox communication
- Standalone CodeMirror editor + file explorer for WebContainer artifacts
- Backend auto-detection of nextjs/node-server/vite templates from file contents
- LLM system prompt updated with new template instructions
- Auto-scaffold missing Vite files (vite.config, index.html, src/main.tsx)
- Respects LLM-generated package.json with devDependencies
- TypeScript node-server support via auto-injected `tsx` dependency
- Sidebar auto-collapse when artifact panel opens, restores on close
- Sandpack retained as fast path for react/react-ts/vanilla (~100ms vs ~2-5s boot)

### Other Shipped Features

- Multi-step workflow engine with parallel execution and retry logic
- Webhook integrations (Slack, Discord, generic URLs)
- OAuth/SSO (Google, GitHub)
- Multi-model switching (Anthropic + OpenAI-compatible)
- Background LLM task status tracking
- Conversation folders
- Admin dashboard with analytics
- Vision/file attachments
- LLM client reuse (shared HTTP connection pool)
- ~~Theme sync~~ — Sandpack theme follows app light/dark mode

---

## Phase 3: E2B Sandboxes (Multi-Language Artifacts)

**Goal:** Support Python, Go, Rust, and other non-JS runtimes.

**When to build:** When users need Python scripts, data science notebooks, or backend-heavy projects.

**Technology:** E2B — cloud-hosted isolated Linux VMs.

**What it enables:**
- Python (FastAPI, Django, Flask, data science)
- Go, Rust, Java, any language
- Database access (SQLite, PostgreSQL)
- Custom Docker-based templates
- Full Linux environment

**Key requirements:**
- Server-side (requires E2B API key)
- Cost per sandbox-minute
- Adds latency (VM spin-up ~500ms-2s)
- No client-side rendering (results piped back)

**Architecture:**
- New `template="python"` / `template="node-server"` values
- Backend creates E2B sandbox, mounts files, runs commands
- Output streamed back via SSE
- Frontend shows terminal output + optional iframe for web servers

---

## Phase 4: Enhancements

Lower priority improvements to add over time:

- **ZIP download** — proper `.zip` export using `jszip`
- **Artifact versioning** — track edit history, allow reverting
- **Fork artifact** — create variations from existing artifacts
- **Responsive file explorer** — collapse to dropdown on narrow screens
- **File size warning** — warn when artifact tokens approach output limits
- **Evaluator agent** — deterministic validator (JSON structure, entry points, imports vs dependencies)
