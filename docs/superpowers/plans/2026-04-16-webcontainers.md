# WebContainers Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebContainer support for full-stack artifacts (Next.js, Express, Vite) while keeping Sandpack as the fast path for simple React/vanilla projects.

**Architecture:** WebContainers run in an isolated `/sandbox` route (COOP/COEP headers) embedded via iframe in the main app. The `ArtifactPanel` branches on template — Sandpack for `react`/`react-ts`/`vanilla`, WebContainerFrame for `nextjs`/`node-server`/`vite`. Backend auto-detects template from file contents and corrects the LLM's choice if needed.

**Tech Stack:** `@webcontainer/api`, `@xterm/xterm`, `@xterm/addon-fit`, CodeMirror (`@codemirror/view` + extensions), Next.js App Router, nginx.

---

## File Structure

### New Files
- `frontend/src/app/sandbox/page.tsx` — isolated WebContainer sandbox page (terminal + preview)
- `frontend/src/components/webcontainer-frame.tsx` — iframe wrapper with postMessage protocol + status bar
- `frontend/src/components/standalone-editor.tsx` — CodeMirror editor for WebContainer artifacts
- `frontend/src/components/standalone-file-explorer.tsx` — file tree for WebContainer artifacts

### Modified Files
- `backend/app/agent/artifact_parser.py` — extend `detect_template()` for nextjs/node-server/vite
- `backend/tests/test_artifact_parser.py` — tests for new template detection
- `backend/app/llm/provider.py` — update `SYSTEM_PROMPT` with new templates
- `frontend/src/components/artifact-panel.tsx` — branch Sandpack vs WebContainerFrame
- `frontend/next.config.ts` — COOP/COEP headers for `/sandbox`
- `nginx/nginx.conf` — COOP/COEP headers for `/sandbox` location
- `frontend/package.json` — new dependencies
- `docs/superpowers/specs/2026-04-15-artifact-roadmap.md` — mark Phase 2 done

---

### Task 1: Backend — Extend Template Detection

**Files:**
- Modify: `backend/app/agent/artifact_parser.py:90-101`
- Test: `backend/tests/test_artifact_parser.py`

- [ ] **Step 1: Write failing tests for new template detection**

Add to `backend/tests/test_artifact_parser.py`:

```python
def test_detect_nextjs_from_next_config():
    files = {"/next.config.js": "module.exports = {}", "/app/page.tsx": "export default function Home() {}"}
    assert detect_template(files) == "nextjs"


def test_detect_nextjs_from_app_layout():
    files = {"/app/layout.tsx": "export default function Layout({ children }) {}", "/app/page.tsx": "code"}
    assert detect_template(files) == "nextjs"


def test_detect_node_server_from_express():
    files = {"/server.js": "const express = require('express');\nconst app = express();"}
    assert detect_template(files) == "node-server"


def test_detect_node_server_from_fastify():
    files = {"/server.ts": "import Fastify from 'fastify';\nconst server = Fastify();"}
    assert detect_template(files) == "node-server"


def test_detect_node_server_ignores_next_with_server():
    """If next.config exists alongside server.js, it's a Next.js project, not a plain node server."""
    files = {"/next.config.js": "{}", "/server.js": "const express = require('express');"}
    assert detect_template(files) == "nextjs"


def test_detect_vite_from_config():
    files = {"/vite.config.ts": "export default {}", "/src/main.tsx": "code"}
    assert detect_template(files) == "vite"


def test_detect_simple_react_unchanged():
    """Simple React projects should still return 'react', not a WebContainer template."""
    files = {"/App.js": "export default function App() { return <h1>Hi</h1>; }"}
    assert detect_template(files) == "react"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_artifact_parser.py -v -k "nextjs or node_server or vite or simple_react_unchanged"`
Expected: 6 FAIL (new tests), 1 PASS (simple_react_unchanged)

- [ ] **Step 3: Implement extended detect_template**

Replace the `detect_template` function in `backend/app/agent/artifact_parser.py`:

```python
_SERVER_FRAMEWORKS = re.compile(r"(?:require\(['\"](?:express|fastify)['\"]|from\s+['\"](?:express|fastify)['\"]|http\.createServer)")


def detect_template(files: dict) -> str:
    """Auto-detect template from file contents.

    Priority: nextjs > vite > node-server > react-ts > vanilla > react
    """
    paths = set(files.keys())

    # Next.js: has next.config.* or app directory structure
    has_next_config = any(p.split("/")[-1].startswith("next.config") for p in paths)
    has_app_dir = any(p.startswith("/app/page") or p.startswith("/app/layout") for p in paths)
    if has_next_config or has_app_dir:
        return "nextjs"

    # Vite: has vite.config.*
    has_vite_config = any(p.split("/")[-1].startswith("vite.config") for p in paths)
    if has_vite_config:
        return "vite"

    # Node server: has server.js/server.ts with express/fastify/http.createServer
    for p in paths:
        filename = p.split("/")[-1]
        if filename in ("server.js", "server.ts"):
            code = files.get(p, "")
            if _SERVER_FRAMEWORKS.search(code):
                return "node-server"

    # Existing Sandpack detection
    has_ts = any(p.endswith(".tsx") or p.endswith(".ts") for p in paths)
    has_html_entry = "/index.html" in paths

    if has_ts:
        return "react-ts"
    if has_html_entry and "/App.js" not in paths:
        return "vanilla"
    return "react"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_artifact_parser.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/artifact_parser.py backend/tests/test_artifact_parser.py
git commit -m "feat: extend template detection for nextjs, node-server, and vite"
```

---

### Task 2: Backend — Update System Prompt

**Files:**
- Modify: `backend/app/llm/provider.py:66-85`

- [ ] **Step 1: Update SYSTEM_PROMPT with new templates**

In `backend/app/llm/provider.py`, replace the `SYSTEM_PROMPT` string with:

```python
SYSTEM_PROMPT = (
    "You are Friendly Neighbor, a helpful AI assistant. "
    "You answer questions clearly and concisely.\n\n"
    "When the user asks you to build, create, or generate a UI component, "
    "web page, or interactive application, wrap your code in an artifact tag.\n\n"
    "Always use the project format with a JSON manifest:\n\n"
    '<artifact type="project" title="Project Name" template="react">\n'
    '{\n'
    '  "files": {\n'
    '    "/App.js": "export default function App() { return <h1>Hello</h1>; }"\n'
    '  },\n'
    '  "dependencies": {}\n'
    '}\n'
    "</artifact>\n\n"
    "For multi-file projects:\n\n"
    '<artifact type="project" title="Todo App" template="react">\n'
    '{\n'
    '  "files": {\n'
    '    "/App.js": "import Counter from \'./Counter\';\\nexport default function App() { return <Counter />; }",\n'
    '    "/Counter.js": "export default function Counter() { ... }",\n'
    '    "/styles.css": "body { font-family: sans-serif; }"\n'
    '  },\n'
    '  "dependencies": {\n'
    '    "uuid": "latest"\n'
    '  }\n'
    '}\n'
    "</artifact>\n\n"
    "STRICT rules for artifacts:\n"
    "- Always use type=\"project\" with a JSON manifest.\n"
    "- template: \"react\" (JS/JSX files, entry /App.js), \"react-ts\" (TS/TSX files, entry /App.tsx), or \"vanilla\" (plain HTML/JS, entry /index.html).\n"
    "- If using TypeScript or type annotations, use template=\"react-ts\" with .tsx/.ts files and /App.tsx entry point.\n"
    "- If using plain JavaScript, use template=\"react\" with .js/.jsx files and /App.js entry point.\n"
    "- CSS files use .css extension. Import them as './styles.css' in JS/TSX files.\n"
    "- The files object has file paths as keys (starting with /) and code strings as values.\n"
    "- The dependencies object maps npm package names to version strings. Use {} if none.\n"
    "- Even simple single-component UIs use this format (one file is fine).\n"
    "- Always include the artifact tag when generating UI code.\n"
    "- Keep artifacts concise — prefer inline styles or a single CSS file over many small files.\n"
    "- You can still include explanation text outside the artifact tag.\n"
    "- The JSON must be valid. Escape all special characters in strings properly (newlines as \\n, quotes as \\\", backslashes as \\\\).\n\n"
    "Full-stack templates (use ONLY when the user explicitly asks for these frameworks or needs server-side features):\n"
    "- template=\"nextjs\": Next.js App Router. Files: /next.config.js, /app/layout.tsx, /app/page.tsx. Include dependencies like \"next\", \"react\", \"react-dom\".\n"
    "- template=\"node-server\": Express or Fastify API server. Entry file: /server.js or /server.ts. No browser UI needed.\n"
    "- template=\"vite\": Vite-based frontend. Files: /vite.config.ts, /index.html, /src/main.tsx. For projects needing real npm packages that don't work in the browser bundler.\n"
    "- PREFER template=\"react\" or \"react-ts\" for simple components — they load instantly. Only use nextjs/node-server/vite when truly needed."
)
```

- [ ] **Step 2: Verify syntax**

Run: `python3 -c "import ast; ast.parse(open('backend/app/llm/provider.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/llm/provider.py
git commit -m "feat: add nextjs, node-server, and vite templates to system prompt"
```

---

### Task 3: Frontend — Install Dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install WebContainer and terminal packages**

```bash
cd frontend && npm install @webcontainer/api @xterm/xterm @xterm/addon-fit @codemirror/view @codemirror/state @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/theme-one-dark
```

- [ ] **Step 2: Verify install succeeded**

```bash
cd frontend && node -e "require('@webcontainer/api'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd frontend && git add package.json package-lock.json
git commit -m "feat: add webcontainer, xterm, and codemirror dependencies"
```

---

### Task 4: Frontend — COOP/COEP Headers

**Files:**
- Modify: `frontend/next.config.ts`
- Modify: `nginx/nginx.conf`

- [ ] **Step 1: Add headers to next.config.ts**

Replace `frontend/next.config.ts` with:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/sandbox",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Add COOP/COEP to nginx.conf for /sandbox**

In `nginx/nginx.conf`, add a new location block before the `location /` block:

```nginx
    # WebContainer sandbox (needs COOP/COEP for SharedArrayBuffer)
    location /sandbox {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
    }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/next.config.ts nginx/nginx.conf
git commit -m "feat: add COOP/COEP headers for /sandbox route"
```

---

### Task 5: Frontend — Sandbox Page

**Files:**
- Create: `frontend/src/app/sandbox/page.tsx`

- [ ] **Step 1: Create the sandbox page**

Create `frontend/src/app/sandbox/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { WebContainer } from "@webcontainer/api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Phase = "waiting" | "booting" | "installing" | "starting" | "ready" | "error";

const START_COMMANDS: Record<string, string[]> = {
  nextjs: ["npx", "next", "dev", "--port", "3111"],
  "node-server": ["node", "server.js"],
  vite: ["npx", "vite", "--port", "3111", "--host"],
};

function toWebContainerFiles(files: Record<string, string>) {
  const result: Record<string, { file: { contents: string } } | { directory: Record<string, unknown> }> = {};
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.replace(/^\//, "").split("/");
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = { directory: {} };
      }
      current = (current[parts[i]] as { directory: Record<string, unknown> }).directory as typeof result;
    }
    current[parts[parts.length - 1]] = { file: { contents } };
  }
  return result;
}

export default function SandboxPage() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const wcRef = useRef<WebContainer | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const processRef = useRef<{ kill: () => void } | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [statusMessage, setStatusMessage] = useState("Waiting for files...");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Send status to parent
  function sendStatus(p: Phase, msg: string) {
    setPhase(p);
    setStatusMessage(msg);
    window.parent.postMessage({ type: "status", phase: p, message: msg }, "*");
  }

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || termRef.current) return;
    const term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: "#1e1e1e" } });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    termRef.current = term;

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(terminalRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Listen for messages from parent
  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      const { data } = event;
      if (!data?.type) return;

      if (data.type === "mount") {
        await bootAndRun(data.files, data.dependencies, data.template);
      } else if (data.type === "file-update" && wcRef.current) {
        const filePath = data.path.replace(/^\//, "");
        await wcRef.current.fs.writeFile(filePath, data.code);
      } else if (data.type === "restart") {
        if (processRef.current) processRef.current.kill();
        if (wcRef.current && data.template) {
          const cmd = START_COMMANDS[data.template] || START_COMMANDS.vite;
          await spawnProcess(cmd);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function spawnProcess(cmd: string[]) {
    if (!wcRef.current || !termRef.current) return;
    const process = await wcRef.current.spawn(cmd[0], cmd.slice(1));
    processRef.current = process;
    process.output.pipeTo(
      new WritableStream({
        write(chunk) {
          termRef.current?.write(chunk);
        },
      }),
    );
    return process;
  }

  async function bootAndRun(
    files: Record<string, string>,
    dependencies: Record<string, string>,
    template: string,
  ) {
    const term = termRef.current;
    if (!term) return;

    try {
      // Boot
      sendStatus("booting", "Booting WebContainer...");
      term.writeln("\x1b[36m▸ Booting WebContainer...\x1b[0m");
      if (!wcRef.current) {
        wcRef.current = await WebContainer.boot();
      }
      const wc = wcRef.current;

      // Listen for server-ready
      wc.on("server-ready", (_port: number, url: string) => {
        setPreviewUrl(url);
        sendStatus("ready", "Dev server ready");
        window.parent.postMessage({ type: "preview-url", url }, "*");
      });

      // Mount files
      const packageJson = JSON.stringify(
        { name: "sandbox-project", private: true, dependencies },
        null,
        2,
      );
      const wcFiles = toWebContainerFiles(files);
      wcFiles["package.json"] = { file: { contents: packageJson } };
      await wc.mount(wcFiles);

      // npm install
      sendStatus("installing", "Installing dependencies...");
      term.writeln("\x1b[36m▸ npm install\x1b[0m");
      const installProcess = await wc.spawn("npm", ["install"]);
      installProcess.output.pipeTo(
        new WritableStream({
          write(chunk) {
            term.write(chunk);
          },
        }),
      );
      const installCode = await installProcess.exit;
      if (installCode !== 0) {
        sendStatus("error", `npm install failed (exit code ${installCode})`);
        return;
      }

      // Start dev server
      const cmd = START_COMMANDS[template] || START_COMMANDS.vite;
      sendStatus("starting", `Starting ${cmd.join(" ")}...`);
      term.writeln(`\x1b[36m▸ ${cmd.join(" ")}\x1b[0m`);
      await spawnProcess(cmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendStatus("error", msg);
      term?.writeln(`\x1b[31m✗ ${msg}\x1b[0m`);
    }
  }

  const phaseColors: Record<Phase, string> = {
    waiting: "text-muted-foreground",
    booting: "text-yellow-500",
    installing: "text-yellow-500",
    starting: "text-yellow-500",
    ready: "text-green-500",
    error: "text-red-500",
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#1e1e1e]">
      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-[#333] px-3 py-1.5">
        {phase !== "ready" && phase !== "error" && phase !== "waiting" && (
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
        )}
        <span className={`text-xs font-medium ${phaseColors[phase]}`}>
          {statusMessage}
        </span>
      </div>

      {/* Terminal + Preview */}
      <div className="flex flex-1 overflow-hidden">
        <div ref={terminalRef} className="w-1/3 min-w-[250px] overflow-hidden border-r border-[#333]" />
        <div className="flex-1">
          {previewUrl ? (
            <iframe
              ref={previewRef}
              src={previewUrl}
              className="h-full w-full border-0"
              title="Preview"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[#666]">
              Preview will appear when the dev server starts
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify page loads in dev**

Run: `cd frontend && npm run dev`
Navigate to `http://localhost:3000/sandbox` — should see dark page with "Waiting for files..." status.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/sandbox/page.tsx
git commit -m "feat: add /sandbox page with WebContainer boot and terminal"
```

---

### Task 6: Frontend — WebContainerFrame Component

**Files:**
- Create: `frontend/src/components/webcontainer-frame.tsx`

- [ ] **Step 1: Create the WebContainerFrame component**

Create `frontend/src/components/webcontainer-frame.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

type Phase = "waiting" | "booting" | "installing" | "starting" | "ready" | "error";

interface WebContainerFrameProps {
  files: Record<string, string>;
  dependencies: Record<string, string>;
  template: string;
  artifactId: string;
}

export function WebContainerFrame({
  files,
  dependencies,
  template,
  artifactId,
}: WebContainerFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mountedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [statusMessage, setStatusMessage] = useState("Loading sandbox...");

  // Send mount message once iframe is loaded
  const handleIframeLoad = useCallback(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "mount", files, dependencies, template },
      "*",
    );
  }, [files, dependencies, template]);

  // Listen for status updates from sandbox
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const { data } = event;
      if (!data?.type) return;
      if (data.type === "status") {
        setPhase(data.phase);
        setStatusMessage(data.message);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Send file updates when files change (after initial mount)
  const prevFilesRef = useRef<string>("");
  useEffect(() => {
    if (!mountedRef.current) return;
    const snapshot = JSON.stringify(files);
    if (prevFilesRef.current && snapshot !== prevFilesRef.current) {
      const prev = JSON.parse(prevFilesRef.current) as Record<string, string>;
      for (const [path, code] of Object.entries(files)) {
        if (prev[path] !== code) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "file-update", path, code },
            "*",
          );
        }
      }
    }
    prevFilesRef.current = snapshot;
  }, [files]);

  const statusIcon =
    phase === "ready" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    ) : phase === "error" ? (
      <AlertCircle className="h-3.5 w-3.5 text-red-500" />
    ) : (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />
    );

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5">
        {statusIcon}
        <span className="text-xs text-muted-foreground">{statusMessage}</span>
      </div>

      {/* Sandbox iframe */}
      <iframe
        ref={iframeRef}
        src="/sandbox"
        className="flex-1 border-0"
        title="WebContainer Sandbox"
        onLoad={handleIframeLoad}
        allow="cross-origin-isolated"
        key={artifactId}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/webcontainer-frame.tsx
git commit -m "feat: add WebContainerFrame component with postMessage protocol"
```

---

### Task 7: Frontend — Standalone Editor and File Explorer

**Files:**
- Create: `frontend/src/components/standalone-editor.tsx`
- Create: `frontend/src/components/standalone-file-explorer.tsx`

- [ ] **Step 1: Create the standalone CodeMirror editor**

Create `frontend/src/components/standalone-editor.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";

interface StandaloneEditorProps {
  code: string;
  filePath: string;
  onChange: (code: string) => void;
  theme?: "light" | "dark";
}

function langFromPath(path: string) {
  if (path.endsWith(".css")) return css();
  if (path.endsWith(".html")) return html();
  return javascript({ jsx: true, typescript: path.endsWith(".ts") || path.endsWith(".tsx") });
}

export function StandaloneEditor({ code, filePath, onChange, theme = "dark" }: StandaloneEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Create editor on mount or when filePath changes
  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      keymap.of(defaultKeymap),
      langFromPath(filePath),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];
    if (theme === "dark") {
      extensions.push(oneDark);
    }

    const state = EditorState.create({ doc: code, extensions });
    viewRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [filePath, theme]);

  // Update doc content when code prop changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
      });
    }
  }, [code]);

  return <div ref={containerRef} className="h-full overflow-auto" />;
}
```

- [ ] **Step 2: Create the standalone file explorer**

Create `frontend/src/components/standalone-file-explorer.tsx`:

```tsx
"use client";

import { FileCode, Folder } from "lucide-react";

interface StandaloneFileExplorerProps {
  files: Record<string, string>;
  activeFile: string;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: Record<string, string>): TreeNode[] {
  const root: TreeNode[] = [];

  for (const path of Object.keys(files).sort()) {
    const parts = path.replace(/^\//, "").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const fullPath = "/" + parts.slice(0, i + 1).join("/");
      const isDir = i < parts.length - 1;
      let node = current.find((n) => n.name === name);

      if (!node) {
        node = { name, path: fullPath, isDir, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }

  return root;
}

function TreeItem({
  node,
  activeFile,
  onSelect,
  depth,
}: {
  node: TreeNode;
  activeFile: string;
  onSelect: (path: string) => void;
  depth: number;
}) {
  return (
    <>
      <button
        onClick={() => !node.isDir && onSelect(node.path)}
        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-muted/50 ${
          node.path === activeFile ? "bg-muted text-foreground" : "text-muted-foreground"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.isDir ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
        ) : (
          <FileCode className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          activeFile={activeFile}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function StandaloneFileExplorer({ files, activeFile, onSelectFile }: StandaloneFileExplorerProps) {
  const tree = buildTree(files);

  return (
    <div className="overflow-y-auto py-1">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} activeFile={activeFile} onSelect={onSelectFile} depth={0} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/standalone-editor.tsx frontend/src/components/standalone-file-explorer.tsx
git commit -m "feat: add standalone CodeMirror editor and file explorer for WebContainer artifacts"
```

---

### Task 8: Frontend — Update ArtifactPanel to Branch on Template

**Files:**
- Modify: `frontend/src/components/artifact-panel.tsx:248-296`

- [ ] **Step 1: Add WebContainer content component**

Add a new `WebContainerContent` component above the `ArtifactPanel` export in `frontend/src/components/artifact-panel.tsx`:

```tsx
import { WebContainerFrame } from "@/components/webcontainer-frame";
import { StandaloneEditor } from "@/components/standalone-editor";
import { StandaloneFileExplorer } from "@/components/standalone-file-explorer";
```

Then add this component before the `ArtifactPanel` export:

```tsx
const WEBCONTAINER_TEMPLATES = new Set(["nextjs", "node-server", "vite"]);

function WebContainerContent({ artifact, onClose, onFixError }: ArtifactPanelProps) {
  const { resolvedTheme } = useTheme();
  const [tab, setTab] = useState<"code" | "preview">("preview");
  const [activeFile, setActiveFile] = useState(Object.keys(artifact.files)[0] ?? "");
  const [files, setFiles] = useState(artifact.files);
  const fileCount = Object.keys(files).length;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreaming = artifact.id.startsWith("streaming-");

  const handleFileChange = (code: string) => {
    const updated = { ...files, [activeFile]: code };
    setFiles(updated);

    // Auto-save with debounce
    if (!isStreaming) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifact.id, { files: updated }).catch(() =>
          toast.error("Failed to save project"),
        );
      }, 1000);
    }
  };

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const code = files[activeFile];
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium max-w-[160px]">
          {artifact.title}
        </span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </Badge>
        <span className="text-muted-foreground text-xs">·</span>
        <Badge variant="outline" className="shrink-0 text-[10px] px-1.5">
          {artifact.template}
        </Badge>
        <span className="text-muted-foreground text-xs">·</span>
        <div className="flex items-center rounded-md bg-muted p-0.5">
          <button
            onClick={() => setTab("code")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              tab === "code"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code className="h-3 w-3" />
            Code
          </button>
          <button
            onClick={() => setTab("preview")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              tab === "preview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCopy}
          title={`Copy ${activeFile}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* File explorer */}
        <div className="w-[150px] shrink-0 overflow-y-auto border-r">
          <StandaloneFileExplorer
            files={files}
            activeFile={activeFile}
            onSelectFile={(path) => {
              setActiveFile(path);
              setTab("code");
            }}
          />
        </div>
        {/* Editor and Preview */}
        <div className="relative flex-1 overflow-hidden">
          <div className={tab === "code" ? "h-full" : "hidden"}>
            <StandaloneEditor
              code={files[activeFile] ?? ""}
              filePath={activeFile}
              onChange={handleFileChange}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
            />
          </div>
          <div className={tab === "preview" ? "h-full" : "hidden"}>
            <WebContainerFrame
              files={files}
              dependencies={artifact.dependencies ?? {}}
              template={artifact.template}
              artifactId={artifact.id}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ArtifactPanel to branch on template**

Replace the `ArtifactPanel` export function body (after the streaming check) to branch:

```tsx
export function ArtifactPanel(props: ArtifactPanelProps) {
  const { resolvedTheme } = useTheme();
  const isStreaming = props.artifact.id.startsWith("streaming-");

  if (isStreaming) {
    const fileCount = Object.keys(props.artifact.files).length;
    return (
      <div className="flex h-full flex-col items-center justify-center border-l bg-background gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">
          Generating {props.artifact.title}...
        </p>
        {fileCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {fileCount} {fileCount === 1 ? "file" : "files"} received
          </p>
        )}
      </div>
    );
  }

  // WebContainer templates
  if (WEBCONTAINER_TEMPLATES.has(props.artifact.template)) {
    return <WebContainerContent {...props} />;
  }

  // Sandpack templates (react, react-ts, vanilla)
  const TEMPLATES = {
    react: "react",
    "react-ts": "react-ts",
    vanilla: "vanilla",
  } as const;
  const template =
    TEMPLATES[props.artifact.template as keyof typeof TEMPLATES] ?? "react";
  const files = ensureEntryFiles(props.artifact.files, template);

  return (
    <SandpackProvider
      key={props.artifact.id}
      template={template}
      files={files}
      customSetup={{
        dependencies: props.artifact.dependencies ?? {},
      }}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      options={{
        activeFile: Object.keys(props.artifact.files)[0] ?? "/App.js",
        bundlerURL: "https://sandpack-bundler.codesandbox.io",
      }}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <SandpackContent {...props} />
    </SandpackProvider>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/artifact-panel.tsx
git commit -m "feat: branch ArtifactPanel to use WebContainerFrame for full-stack templates"
```

---

### Task 9: Integration Test — End to End

- [ ] **Step 1: Start the dev servers**

```bash
make local-db && make local-backend &
cd frontend && npm run dev &
```

- [ ] **Step 2: Test Sandpack still works (regression)**

In the chat, send: "Create a counter button component"
Expected: Artifact renders using Sandpack, loads instantly, preview shows the button.

- [ ] **Step 3: Test Next.js via WebContainers**

In the chat, send: "Build a Next.js app with App Router that has a homepage and an /about page"
Expected: Artifact shows with `nextjs` badge, WebContainerFrame loads, terminal shows `npm install` then `next dev`, preview shows the app.

- [ ] **Step 4: Test Express via WebContainers**

In the chat, send: "Build an Express server with a GET /health endpoint that returns { status: 'ok' }"
Expected: `node-server` template, terminal shows server starting, no preview iframe (or preview showing JSON).

- [ ] **Step 5: Test Vite via WebContainers**

In the chat, send: "Build a Vite React app with tailwindcss that shows a card component"
Expected: `vite` template, npm install includes tailwind, HMR works on file edits.

- [ ] **Step 6: Test file editing**

Open a WebContainer artifact, switch to Code tab, edit a file, switch back to Preview.
Expected: Changes reflected via HMR without manual restart.

- [ ] **Step 7: Test browser compatibility note**

Open `/sandbox` in Safari.
Expected: Either works or shows a graceful error about SharedArrayBuffer support.

---

### Task 10: Update Roadmap

**Files:**
- Modify: `docs/superpowers/specs/2026-04-15-artifact-roadmap.md`

- [ ] **Step 1: Move Phase 2 to Completed**

In the roadmap, move the Phase 2 section into the Completed section with a summary:

```markdown
### Multi-File Artifacts — Phase 2: WebContainers (Apr 16)

- WebContainer support for full-stack artifacts (Next.js, Express/Fastify, Vite)
- Isolated `/sandbox` route with COOP/COEP headers (main app unaffected)
- Terminal (xterm) + preview iframe in sandbox page
- PostMessage protocol for parent ↔ sandbox communication
- Standalone CodeMirror editor + file explorer for WebContainer artifacts
- Backend auto-detection of nextjs/node-server/vite templates from file contents
- LLM system prompt updated with new template instructions
- Sandpack retained as fast path for react/react-ts/vanilla (~100ms vs ~2-5s boot)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-15-artifact-roadmap.md
git commit -m "docs: mark WebContainers (Phase 2) as complete in roadmap"
```
