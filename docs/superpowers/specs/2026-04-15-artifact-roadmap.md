# Multi-File Artifact System — Roadmap

## Current State (Phase 1: Sandpack)

Shipped and working:
- Unified `type="project"` format with JSON manifest
- Sandpack rendering (react, react-ts, vanilla templates)
- File explorer + tabbed Code/Preview
- Streaming file delivery (artifact_start/file/end SSE events)
- Edit-and-iterate (artifact context sent with follow-up messages)
- Dependency auto-detection from imports
- Template auto-detection from file extensions
- Error recovery with "Fix this" button
- Auto-injected entry files (index.js/index.tsx)

**Limitations:** Client-side only. No server-side rendering, no Node.js, no `npm install` at runtime.

---

## Phase 2: WebContainers (Full-Stack)

**Goal:** Support Next.js, Express, and full-stack apps with server processes.

**When to build:** When users need server components, API routes, file-based routing, SSR, or `npm install`.

**Technology:** `@webcontainer/api` (StackBlitz) — boots full Node.js in the browser via WebAssembly.

**What it enables:**
- Next.js apps with App Router, server components, API routes
- Express/Fastify backends
- Real `npm install` (any npm package)
- Terminal access for running commands
- Dev server (Vite, Next.js dev, etc.)

**Key requirements:**
- Cross-origin isolation headers (COOP/COEP) on Nginx
- Heavier bundle (~2-5MB vs Sandpack's ~200KB)
- Slower boot (~2-5s vs Sandpack's ~100ms)
- SharedArrayBuffer support (Chrome/Edge/Firefox; limited Safari)
- Commercial license for production use

**Architecture:**
- Detect template: if `next.config.*` or pages/app directory → use WebContainers
- Otherwise → keep using Sandpack (lighter, faster)
- New `template="nextjs"` value triggers WebContainers renderer
- Same JSON manifest format (`files` + `dependencies`)
- WebContainers panel: file explorer + editor + terminal + preview (split view)

**Reference implementations:**
- Bolt.new (gold standard) — https://github.com/stackblitz/bolt.new
- StackBlitz — https://stackblitz.com
- WebContainers docs — https://webcontainers.io/guides/introduction

---

## Phase 3: E2B Sandboxes (Multi-Language)

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
- **Theme sync** — match Sandpack theme to app's light/dark mode
- **Responsive file explorer** — collapse to dropdown on narrow screens
- **File size warning** — warn when artifact tokens approach output limits
- **Evaluator agent** — deterministic validator (JSON structure, entry points, imports vs dependencies)
