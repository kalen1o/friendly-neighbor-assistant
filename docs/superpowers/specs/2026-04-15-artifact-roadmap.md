# Friendly Neighbor — Project Roadmap

Last updated: 2026-04-17

---

## Completed

### Agent Reliability & Deterministic Skills (Apr 17)

Driven by a GLM-5.1 session that spun 5+ rounds of web scraping for a Vietnamese lunar calendar question, hit a rate limit, and returned an empty response. Three hardening fixes + one new deterministic skill.

- **Per-request URL dedup cache** (`app/agent/tools.py`, `app/agent/agent.py`, `app/skills/executors.py`) — `fetch_cache: dict[str, str]` created fresh per message, threaded through `_fetch_page_content` and `tool_search_web` via executor kwargs. Duplicate URL fetches short-circuit to an 80-char marker instead of re-downloading 3000 chars. Logs `Dedup hit: skipping re-fetch of …`.
- **Spinning detection with forced synthesis** (`app/llm/provider.py`, both OpenAI and Anthropic branches) — snapshot `fetch_cache.keys()` before and after tool execution each round. When `round_num > 0` and no new URLs were fetched, inject a system message directing the model to answer from existing data and strip `tools` from the next call's kwargs. Prevents runaway scraping loops that bloat context into the rate-limit wall.
- **Empty-response fallback** (`app/llm/provider.py`) — replaced early `return` statements in the OpenAI tool loop with `break` + a `finished_normally` flag so the fallback check runs on every exit path (natural exhaustion or finish-reason=stop). When `total_content_yielded == 0`, yields a source-list fallback message referencing up to 5 `collected_sources` URLs. Users see useful output instead of a silent empty bubble.
- **`lunar_convert` skill** (new) — deterministic Vietnamese âm lịch ↔ dương lịch conversion backed by the `lunarcalendar` pip package (Ho Ngoc Duc algorithm, same math as `xemlicham.com` and VN government calendars). Three directions: `today`, `solar_to_lunar`, `lunar_to_solar`. Returns structured `{solar, lunar, can_chi_year, weekday, is_leap_month}` so the LLM can answer follow-ups without re-calling. Handles invalid days (e.g. 30 of a 29-day lunar month) by probing and relaying the last valid day. Skill description explicitly instructs the LLM to prefer it over `web_search` for any calendar math. Covers 1900–2199. 11 pinned tests covering Tết 2024/2025/2026, leap month 2023, and the original failing user query.

**Pattern established:** for deterministic domains (calendars, unit conversion, timezone math, finance formulas), add a Python-backed tool skill rather than relying on LLM reasoning or web scraping. Scraping stays the right answer for genuinely dynamic data (news, prices, real-time status).

**Known follow-up work (deferred):** site-specific HTML extractors for calendar/news sites to keep the generic `_extract_text_from_html` from destroying structured page data when scraping IS the right tool. Tracked in [Future] below.

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

### Artifact Enhancements — Phase 4 (Apr 16) — COMPLETE

- **ZIP download** — proper `.zip` export using `jszip`, download button in panel header + artifact card
- **Artifact versioning** — versions created on LLM generation, revert via shadcn dropdown in panel header
- **Responsive file explorer** — collapses to `<select>` dropdown on narrow screens
- **File size warning** — streaming progress bar (green/yellow/red) with truncation warning
- **Evaluator agent** — validates entry files, local imports, truncated code, template consistency; auto-fixes deps, warns via SSE

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
- Theme sync — Sandpack theme follows app light/dark mode

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

### MCP Integration (Previously shipped)

- MCP server registration per-user with CRUD API and frontend management page
- MCP client with JSON-RPC + SSE transport, auth (bearer/custom header)
- Tool discovery (`tools/list`) with Redis cache (1hr TTL)
- Tool execution (`tools/call`) with text content extraction
- Agent integration — MCP tools loaded alongside built-in + user skills
- Tools disabled by default after discovery, user enables via UI

---

## Future — Planned Features

| Feature | Effort | Impact |
|---|---|---|
| ~~**Scheduled agents**~~ — **Done (Apr 16)** APScheduler in-process with Redis, cron scheduling, dedicated chat + webhook output | ~~Medium~~ | ~~High~~ |
| **E2B integration** — Python execution in artifacts (Phase 3 above) | Medium | High for data science |
| **Conversation branching** — fork at any message to explore alternatives | Medium | Nice UX for exploration |
| **RAG auto-ingest from MCP** — automatically index documents from connected MCP sources | Low | Compounds RAG value |
| **Skill chaining** — let skills call other skills (tool → workflow escalation) | Low | Unlocks complex workflows |
| **Site-specific HTML extractors** — targeted BeautifulSoup selectors for top scraped hosts (calendar, news, docs sites), keep generic stripper as fallback | Low | Fewer scraping failures, fewer tool-loop rounds |
| **Deterministic-skill library expansion** — more domains that today route through web_search or LLM reasoning: unit conversion, timezone math, currency conversion, stock/crypto ticker lookup, package-version lookup. Same pattern as `lunar_convert`: Python executor, tight skill description, pinned tests | Low per skill | Compounds per domain — each one replaces N tool rounds with 1 deterministic call |
| **CI/CD & deployment pipeline** — GitHub Actions for lint/test/build, container publishing, staging/production deploy targets | Medium | Ships more safely and faster |
| **Voice input/output** — speech-to-text input, text-to-speech streaming responses; evaluate Whisper + ElevenLabs/browser APIs | Medium | Accessibility + mobile UX |

---

## Multi-Agent Evolution (Level 3 → Level 4)

Incremental path to multi-agent orchestration. Each item is opt-in per skill, so the baseline single-LLM flow remains the fast path.

| Feature | Effort | Impact |
|---|---|---|
| **Evaluator-optimizer** — reviewer agent checks response quality before sending (same LLM, different prompt). Opt-in via `evaluate: true` in skill frontmatter. Use cheaper model for the evaluator to keep cost bounded. | Low | Higher-quality responses for high-stakes skills |
| **Plan-validate-execute** — planner agent generates step list, validator checks for invalid tools / unreasonable steps, executor runs the validated plan | Medium | Reduces GLM-style spinning on multi-step questions |
| **Specialist worker agents** — route to domain-specific agents (Research, Code, Writing, Admin) each with a tailored system prompt. New `agent:` field in skill frontmatter. | Medium | Better-tuned behavior per domain |
| **Coder-reviewer for artifacts** — reviewer agent checks generated React/HTML/Next.js code for correctness and safety before rendering in the sandbox | Medium | Catches broken artifacts before users see them |
| **Orchestrator-workers** — central orchestrator decomposes complex requests into subtasks, delegates to specialist workers (parallel where possible), synthesizes the final output | High | Unlocks genuinely multi-step agent workflows |
