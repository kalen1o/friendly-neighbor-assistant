# WebContainers Integration Design Spec

**Date**: 2026-04-16
**Status**: Approved
**Phase**: 2 (per artifact roadmap)

## Overview

Add WebContainer support for full-stack artifacts (Next.js, Express/Fastify, Vite) while keeping Sandpack as the fast path for simple React/vanilla projects. WebContainers run in an isolated `/sandbox` route embedded via iframe, avoiding COOP/COEP impact on the rest of the app.

## Decisions

- **Isolation: Iframe sandbox** — `/sandbox` route gets COOP/COEP headers, main app stays unaffected. Proven pattern (Bolt.new).
- **Templates: Three new** — `nextjs`, `node-server`, `vite`. Sandpack continues handling `react`, `react-ts`, `vanilla`.
- **Detection: LLM + backend auto-detect** — LLM picks template via system prompt guidance, backend validates/corrects by scanning files.
- **Keep Sandpack** — ~100ms boot vs ~2-5s for WebContainers. Simple artifacts stay fast. Safari compatibility preserved.

## New Templates

| Template | Use Case | Start Command | Entry File | Preview |
|---|---|---|---|---|
| `nextjs` | Next.js App Router, SSR, API routes | `npx next dev --port 3111` | `/app/page.tsx` + `/next.config.js` | iframe (dev server) |
| `node-server` | Express/Fastify APIs | `node server.js` | `/server.js` | terminal (+ iframe if HTTP) |
| `vite` | Vite frontend, real npm packages | `npx vite --port 3111` | `/index.html` + `/src/main.jsx` | iframe (dev server) |

All three use the same single WebContainer instance. The only difference is the start command.

## Architecture

### Rendering Flow

```
ArtifactPanel
├── template is react/react-ts/vanilla?
│   └── SandpackProvider (existing, unchanged)
└── template is nextjs/node-server/vite?
    └── WebContainerFrame (new)
        ├── Status bar (booting → installing → starting → ready)
        ├── <iframe src="/sandbox">
        └── postMessage communication
```

### `/sandbox` Page

Standalone Next.js page at `frontend/src/app/sandbox/page.tsx`. Contains terminal (xterm) + preview iframe. No file explorer or code editor — those stay in the main app's ArtifactPanel.

Layout:
```
┌─────────────────────────────────────┐
│  [Status Bar: "Installing deps..."] │
├──────────┬──────────────────────────┤
│          │                          │
│ Terminal │      Preview iframe      │
│  (xterm) │   (dev server output)    │
│          │                          │
└──────────┴──────────────────────────┘
```

### PostMessage Protocol

**Parent → Sandbox:**
- `{ type: "mount", files: Record<string, string>, dependencies: Record<string, string>, template: string }` — initial file mount + start
- `{ type: "file-update", path: string, code: string }` — user edits a file
- `{ type: "restart" }` — re-run dev server (after dependency changes)

**Sandbox → Parent:**
- `{ type: "status", phase: "booting" | "installing" | "starting" | "ready" | "error", message: string }` — progress updates
- `{ type: "terminal", data: string }` — terminal output chunks
- `{ type: "preview-url", url: string }` — dev server URL for preview iframe

### Boot Sequence (inside `/sandbox`)

1. Page loads → renders empty terminal + "Waiting for files..." status
2. Parent sends `mount` message
3. Boot `WebContainer.boot()` (singleton, reused across file updates)
4. Convert files dict to WebContainer format: `{ "App.js": { file: { contents: "..." } } }`
5. Mount files + generate `package.json` from dependencies
6. Spawn `npm install` → pipe stdout/stderr to xterm
7. Spawn start command (from template config map)
8. Listen for `webcontainer.on("server-ready")` → send `preview-url` to parent
9. Show preview in iframe within sandbox page

### File Update Handling

- Parent sends `file-update` message
- Write to WebContainer filesystem: `webcontainer.fs.writeFile(path, code)`
- HMR picks it up automatically (Next.js/Vite have built-in HMR)
- No restart needed for most changes

### Restart Handling

- Parent sends `restart` message
- Kill running dev server process
- Re-run start command
- Needed after `package.json` / dependency changes

## Headers & Infrastructure

### COOP/COEP (only on `/sandbox`)

**`next.config.ts`** — add `headers()`:
```
/sandbox →
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
```

**`nginx/nginx.conf`** — add matching headers for `/sandbox` location block only.

Rest of the app (OAuth popups, third-party embeds) stays unaffected.

### Preview iframe inside `/sandbox`

Dev server runs inside WebContainers on a local URL (e.g., `http://localhost:3111`). WebContainers expose this via `server-ready` event. The inner preview iframe loads this URL — served by WebContainers inside the same origin, so CORP is satisfied.

### Docker / Bundle

- No backend container changes needed
- No database changes — `template` is already a string column
- `@webcontainer/api` (~2-5MB) loaded only on `/sandbox` route via dynamic import — no impact on initial page load

## Backend Changes

### System Prompt Update (`provider.py`)

Add new templates to `SYSTEM_PROMPT` artifact instructions:
- `template="nextjs"` — Next.js with App Router. Entry: `/app/page.tsx` + `/next.config.js`
- `template="node-server"` — Express/Fastify APIs. Entry: `/server.js`
- `template="vite"` — Vite frontend projects. Entry: `/index.html` + `/src/main.jsx`

Rule: prefer `react`/`react-ts` for simple components (faster preview). Only use new templates when the user explicitly asks for those frameworks or the project genuinely needs server-side features / real npm install.

### Template Auto-Detection (`artifact_parser.py`)

New `detect_template(files: dict, declared_template: str) -> str` function. Runs after parsing the artifact JSON, before saving to DB:

- Has `next.config.*` or `app/page.*` or `app/layout.*` → `nextjs`
- Has `server.js`/`server.ts` with `express`/`fastify`/`http.createServer` import, no next config → `node-server`
- Has `vite.config.*` → `vite`
- Otherwise → keep declared template

### No New Endpoints / Migrations / Models

Existing artifact flow handles everything — just a new template string value flowing through the same pipeline.

## Frontend Changes

### New Dependencies

- `@webcontainer/api` — WebContainer runtime
- `@xterm/xterm` + `@xterm/addon-fit` — terminal in sandbox page
- `codemirror` (or `@codemirror/view` + extensions) — standalone code editor for WebContainer artifacts

### New Files

- `frontend/src/app/sandbox/page.tsx` — isolated sandbox page with COOP/COEP
- `frontend/src/components/webcontainer-frame.tsx` — iframe wrapper + postMessage communication + status bar
- `frontend/src/components/standalone-editor.tsx` — CodeMirror editor for WebContainer artifacts (replaces SandpackCodeEditor which requires SandpackProvider)

### Modified Files

- `frontend/src/components/artifact-panel.tsx` — branch on template: Sandpack vs WebContainerFrame
- `frontend/src/lib/api.ts` — no type changes needed (`template` is already `string`)
- `frontend/next.config.ts` — add `headers()` for `/sandbox`
- `nginx/nginx.conf` — add COOP/COEP headers for `/sandbox` location

## Error Handling

- `npm install` failure → send `{ type: "status", phase: "error" }` to parent, show terminal output
- Dev server crash → same error status, terminal shows stack trace
- Parent shows error state, existing "Fix this" button sends error back to LLM
- WebContainers boot failure (e.g., Safari without SharedArrayBuffer) → show message: "WebContainers not supported in this browser. Try Chrome or Edge."

## Testing

### Unit Tests
- `detect_template()` — given various file dicts, assert correct template override

### Manual Test Plan
- Next.js app generation → WebContainers boot, preview works
- Express API generation → terminal shows server, preview shows response
- Vite project generation → npm install, HMR works
- Simple React component → still uses Sandpack (fast path)
- File edit → HMR picks up changes
- "Fix this" button on build failure
- Safari → graceful fallback message

### Known Limitations
- Safari: SharedArrayBuffer not fully supported, WebContainers may not work
- Boot time: ~2-5s for WebContainers vs ~100ms for Sandpack
- Network required: `npm install` needs internet access
- Commercial license: WebContainers require a license for production use (free for open source / personal)
