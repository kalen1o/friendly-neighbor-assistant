# Artifact Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four high-impact enhancements to multi-file artifact generation: streaming file delivery, edit-and-iterate context, dependency auto-detection, and error recovery.

**Architecture:** Backend streams individual files as they're parsed from the LLM token stream (new `artifact_file` SSE event). Frontend accumulates files into the Sandpack panel progressively. Edit context is injected by sending current artifact files in the message payload. Dependency detection runs post-parse in Python. Error recovery adds a "Fix this" button that sends Sandpack errors back to the LLM.

**Tech Stack:** Python/FastAPI (backend streaming + parsing), Next.js/React/Sandpack (frontend), SSE events

---

## File Map

**Backend — Create:**
- `backend/app/agent/artifact_stream_parser.py` — incremental parser that yields files as they complete during token streaming

**Backend — Modify:**
- `backend/app/agent/artifact_parser.py` — add `detect_dependencies()` function
- `backend/app/routers/chats.py:920-1063` — stream artifact files incrementally, inject artifact context
- `backend/app/schemas/chat.py:17-20` — add optional `artifact_context` field to MessageCreate

**Backend — Test:**
- `backend/tests/test_artifact_parser.py` — add dependency detection tests
- `backend/tests/test_artifact_stream_parser.py` — new tests for incremental parsing

**Frontend — Modify:**
- `frontend/src/lib/api.ts:412-508` — add `artifact_file` SSE handler, add `artifact_context` to sendMessage
- `frontend/src/hooks/use-message-stream.ts` — accumulate streamed files, pass artifact context on send
- `frontend/src/components/artifact-panel.tsx` — add error overlay with "Fix this" button
- `frontend/src/components/chat-input.tsx` — (minor) accept artifact context prop

---

### Task 1: Incremental Artifact Stream Parser

**Files:**
- Create: `backend/app/agent/artifact_stream_parser.py`
- Create: `backend/tests/test_artifact_stream_parser.py`

- [ ] **Step 1: Write tests for the incremental parser**

Create `backend/tests/test_artifact_stream_parser.py`:

```python
import json
from app.agent.artifact_stream_parser import ArtifactStreamParser


def test_yields_file_as_completed():
    """Parser yields each file as soon as its value closes in the JSON."""
    parser = ArtifactStreamParser()

    chunks = [
        '<artifact type="project" title="App" template="react">\n',
        '{\n  "files": {\n',
        '    "/App.js": "export default function App() { return <h1>Hi</h1>; }"',
        ',\n    "/utils.js": "export const x = 1;"',
        '\n  },\n  "dependencies": {}\n}\n',
        '</artifact>',
    ]

    events = []
    for chunk in chunks:
        events.extend(parser.feed(chunk))

    # Should get: artifact_start, file, file, artifact_end
    types = [e["event"] for e in events]
    assert types == ["artifact_start", "artifact_file", "artifact_file", "artifact_end"]

    assert events[0]["data"]["title"] == "App"
    assert events[0]["data"]["template"] == "react"
    assert events[1]["data"]["path"] == "/App.js"
    assert "export default" in events[1]["data"]["code"]
    assert events[2]["data"]["path"] == "/utils.js"
    assert events[3]["data"]["files"] == {
        "/App.js": "export default function App() { return <h1>Hi</h1>; }",
        "/utils.js": "export const x = 1;",
    }
    assert events[3]["data"]["dependencies"] == {}


def test_handles_no_artifact():
    parser = ArtifactStreamParser()
    events = parser.feed("Just some plain text with no artifacts.")
    assert events == []


def test_handles_split_across_many_chunks():
    """Token-by-token feeding still produces correct events."""
    parser = ArtifactStreamParser()
    full = (
        'Here is your code:\n'
        '<artifact type="project" title="Test" template="react">\n'
        '{"files": {"/App.js": "function App() {}"}, "dependencies": {}}\n'
        '</artifact>\n'
        'Enjoy!'
    )
    events = []
    # Feed character by character
    for char in full:
        events.extend(parser.feed(char))

    types = [e["event"] for e in events]
    assert "artifact_start" in types
    assert "artifact_file" in types
    assert "artifact_end" in types


def test_collects_dependencies():
    parser = ArtifactStreamParser()
    text = (
        '<artifact type="project" title="T" template="react">\n'
        '{"files": {"/App.js": "import {v4} from \'uuid\'; export default function App() {}"}, '
        '"dependencies": {"uuid": "latest"}}\n'
        '</artifact>'
    )
    events = []
    events.extend(parser.feed(text))
    end_event = [e for e in events if e["event"] == "artifact_end"][0]
    assert end_event["data"]["dependencies"] == {"uuid": "latest"}


def test_multiple_artifacts_in_stream():
    parser = ArtifactStreamParser()
    text = (
        '<artifact type="project" title="A" template="react">\n'
        '{"files": {"/App.js": "A"}}\n</artifact>\n'
        'some text\n'
        '<artifact type="project" title="B" template="vanilla">\n'
        '{"files": {"/index.html": "B"}}\n</artifact>'
    )
    events = list(parser.feed(text))
    starts = [e for e in events if e["event"] == "artifact_start"]
    assert len(starts) == 2
    assert starts[0]["data"]["title"] == "A"
    assert starts[1]["data"]["title"] == "B"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant && python3 -m pytest backend/tests/test_artifact_stream_parser.py -v`

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the incremental parser**

Create `backend/app/agent/artifact_stream_parser.py`:

```python
"""Incremental artifact parser for SSE streaming.

Feeds on token chunks as they arrive from the LLM and yields events:
  - artifact_start: {title, template} — opening tag detected
  - artifact_file:  {path, code}      — one file's JSON value fully received
  - artifact_end:   {files, dependencies} — closing tag detected, full manifest available
"""

import json
import re
from typing import List

_OPEN_TAG = re.compile(
    r'<artifact\s+type="(?P<type>[^"]+)"\s+title="(?P<title>[^"]+)"'
    r'(?:\s+template="(?P<template>[^"]+)")?\s*>'
)
_CLOSE_TAG = re.compile(r"</artifact>")


class ArtifactStreamParser:
    def __init__(self):
        self._buffer = ""
        self._inside = False
        self._tag_meta: dict = {}
        self._content_start = 0
        self._files_emitted: dict = {}

    def feed(self, chunk: str) -> List[dict]:
        """Feed a chunk of streamed text. Returns a list of events (possibly empty)."""
        self._buffer += chunk
        events: List[dict] = []

        while True:
            if not self._inside:
                m = _OPEN_TAG.search(self._buffer)
                if not m:
                    break
                self._inside = True
                self._tag_meta = {
                    "title": m.group("title"),
                    "template": m.group("template") or "react",
                }
                self._content_start = m.end()
                self._files_emitted = {}
                events.append({
                    "event": "artifact_start",
                    "data": {**self._tag_meta},
                })
                self._buffer = self._buffer[m.end():]
                self._content_start = 0
                continue

            # Inside an artifact — look for closing tag
            close = _CLOSE_TAG.search(self._buffer)
            if close:
                content = self._buffer[:close.start()].strip()
                self._inside = False

                # Parse the full JSON to get dependencies and any remaining files
                try:
                    manifest = json.loads(content)
                    all_files = manifest.get("files", {})
                    deps = manifest.get("dependencies", {})
                except (json.JSONDecodeError, ValueError):
                    all_files = self._files_emitted
                    deps = {}

                # Emit any files not yet emitted
                for path, code in all_files.items():
                    if path not in self._files_emitted:
                        self._files_emitted[path] = code
                        events.append({
                            "event": "artifact_file",
                            "data": {"path": path, "code": code},
                        })

                events.append({
                    "event": "artifact_end",
                    "data": {
                        "files": all_files,
                        "dependencies": deps,
                    },
                })

                self._buffer = self._buffer[close.end():]
                continue

            # Still inside, no closing tag yet — try to extract completed files
            events.extend(self._try_extract_files())
            break

        return events

    def _try_extract_files(self) -> List[dict]:
        """Try to extract completed file entries from partial JSON in buffer."""
        events = []
        # Match pattern: "/path": "code" — completed key-value pairs
        # We look for `"/path": "..."` patterns where the string value is complete
        pattern = re.compile(
            r'"(/[^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}\]]'
        )
        for m in pattern.finditer(self._buffer):
            path = m.group(1)
            if path not in self._files_emitted:
                # Unescape JSON string
                try:
                    code = json.loads('"' + m.group(2) + '"')
                except (json.JSONDecodeError, ValueError):
                    code = m.group(2)
                self._files_emitted[path] = code
                events.append({
                    "event": "artifact_file",
                    "data": {"path": path, "code": code},
                })
        return events
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant && python3 -m pytest backend/tests/test_artifact_stream_parser.py -v`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/artifact_stream_parser.py backend/tests/test_artifact_stream_parser.py
git commit -m "feat: add incremental artifact stream parser for SSE file streaming"
```

---

### Task 2: Stream Artifact Files via SSE

**Files:**
- Modify: `backend/app/routers/chats.py:920-1063`
- Modify: `frontend/src/lib/api.ts:412-508`
- Modify: `frontend/src/hooks/use-message-stream.ts`

- [ ] **Step 1: Update backend SSE to stream artifact files**

In `backend/app/routers/chats.py`, add import at the top (near other artifact imports around line 14):

```python
from app.agent.artifact_stream_parser import ArtifactStreamParser
```

Replace the streaming loop (around lines 920-935) to also feed the stream parser. Find this block:

```python
                async for chunk in _buffered_stream(
                    response_stream, flush_interval=flush_interval, min_chars=min_chars
                ):
                    # Drain action queue — send immediately
                    while not tool_action_queue.empty():
                        action = await tool_action_queue.get()
                        await queue.put({"event": "action", "data": action})
                    full_response += chunk
                    await queue.put({"event": "message", "data": chunk})
```

Replace with:

```python
                art_stream = ArtifactStreamParser()
                async for chunk in _buffered_stream(
                    response_stream, flush_interval=flush_interval, min_chars=min_chars
                ):
                    # Drain action queue — send immediately
                    while not tool_action_queue.empty():
                        action = await tool_action_queue.get()
                        await queue.put({"event": "action", "data": action})
                    full_response += chunk
                    await queue.put({"event": "message", "data": chunk})

                    # Stream artifact files as they complete
                    for art_event in art_stream.feed(chunk):
                        await queue.put({
                            "event": art_event["event"],
                            "data": json.dumps(art_event["data"]),
                        })
```

- [ ] **Step 2: Add SSE handlers in frontend api.ts**

In `frontend/src/lib/api.ts`, add to the `SSECallbacks` interface (around line 418):

```typescript
  onArtifactStart?: (data: { title: string; template: string }) => void;
  onArtifactFile?: (data: { path: string; code: string }) => void;
  onArtifactEnd?: (data: { files: Record<string, string>; dependencies: Record<string, string> }) => void;
```

In the SSE switch statement (around line 504-508), replace the `"artifact"` case and add new cases:

```typescript
            case "artifact":
              try {
                callbacks.onArtifact?.(JSON.parse(data));
              } catch {}
              break;
            case "artifact_start":
              try {
                callbacks.onArtifactStart?.(JSON.parse(data));
              } catch {}
              break;
            case "artifact_file":
              try {
                callbacks.onArtifactFile?.(JSON.parse(data));
              } catch {}
              break;
            case "artifact_end":
              try {
                callbacks.onArtifactEnd?.(JSON.parse(data));
              } catch {}
              break;
```

- [ ] **Step 3: Handle streaming artifact events in use-message-stream.ts**

In `frontend/src/hooks/use-message-stream.ts`, add a ref for the streaming artifact being built (near line 52):

```typescript
  const streamingArtifactRef = useRef<{
    title: string;
    template: string;
    files: Record<string, string>;
  } | null>(null);
```

In the `startStream` callbacks section (and the `reattachStream` callbacks — both places have identical callback objects), add these three new callbacks alongside the existing `onArtifact`:

```typescript
        onArtifactStart: (data) => {
          streamingArtifactRef.current = {
            title: data.title,
            template: data.template,
            files: {},
          };
          // Show panel immediately with empty project
          const placeholder: ArtifactData = {
            id: `streaming-${Date.now()}`,
            type: "project",
            title: data.title,
            template: data.template,
            files: {},
            dependencies: {},
          };
          setActiveArtifact(placeholder);
        },
        onArtifactFile: (data) => {
          if (!streamingArtifactRef.current) return;
          streamingArtifactRef.current.files[data.path] = data.code;
          // Update the active artifact with the new file
          setActiveArtifact((prev) => {
            if (!prev || !prev.id.startsWith("streaming-")) return prev;
            return {
              ...prev,
              files: { ...streamingArtifactRef.current!.files },
            };
          });
        },
        onArtifactEnd: (data) => {
          streamingArtifactRef.current = null;
          // The full artifact SSE event will follow from the existing
          // post-stream artifact save — that replaces the streaming placeholder
        },
```

Update the existing `onArtifact` callback to replace the streaming placeholder:

```typescript
        onArtifact: (artifact) => {
          setArtifacts((prev) => [...prev, artifact]);
          // Replace streaming placeholder with real artifact
          setActiveArtifact((prev) =>
            prev?.id.startsWith("streaming-") ? artifact : artifact
          );
        },
```

- [ ] **Step 4: Run backend tests**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant && python3 -m pytest backend/tests/ -v`

Expected: All tests PASS.

- [ ] **Step 5: Verify frontend builds**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/frontend && npx next build`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/chats.py frontend/src/lib/api.ts frontend/src/hooks/use-message-stream.ts
git commit -m "feat: stream artifact files incrementally via SSE"
```

---

### Task 3: Edit-and-Iterate with Artifact Context

**Files:**
- Modify: `backend/app/schemas/chat.py:17-20`
- Modify: `backend/app/routers/chats.py` (message context injection)
- Modify: `frontend/src/lib/api.ts` (sendMessage)
- Modify: `frontend/src/hooks/use-message-stream.ts` (pass context)

- [ ] **Step 1: Add artifact_context to MessageCreate schema**

In `backend/app/schemas/chat.py`, update `MessageCreate`:

```python
class MessageCreate(BaseModel):
    content: str
    mode: str = "balanced"  # "fast", "balanced", "thinking"
    file_ids: List[str] = []
    artifact_context: Optional[dict] = None  # {files: {...}, template: str, title: str}
```

Add `Optional` to the imports at the top if not already there.

- [ ] **Step 2: Inject artifact context into LLM messages**

In `backend/app/routers/chats.py`, find where `llm_messages` is built from chat history (before the pre_llm hooks, around line 880). Add this block just before `# 4. pre_llm hooks`:

```python
            # Inject active artifact context if provided
            if body.artifact_context and body.artifact_context.get("files"):
                art_ctx = body.artifact_context
                ctx_lines = ["\n\n[Active artifact context — the user is viewing this project:]\n"]
                ctx_lines.append(f"Title: {art_ctx.get('title', 'Untitled')}")
                ctx_lines.append(f"Template: {art_ctx.get('template', 'react')}")
                ctx_lines.append("Current files:")
                for path, code in art_ctx["files"].items():
                    ctx_lines.append(f"\n--- {path} ---\n{code}")
                ctx_str = "\n".join(ctx_lines)
                llm_messages[-1] = {
                    "role": "user",
                    "content": llm_messages[-1]["content"] + ctx_str,
                }
```

- [ ] **Step 3: Update frontend sendMessage to include artifact context**

In `frontend/src/lib/api.ts`, update the `sendMessage` function signature (line 427):

```typescript
export function sendMessage(
  chatId: string,
  content: string,
  callbacks: SSECallbacks,
  mode: ChatMode = "balanced",
  fileIds: string[] = [],
  artifactContext?: { files: Record<string, string>; template: string; title: string } | null
): () => void {
```

Update the fetch body (line 442):

```typescript
        body: JSON.stringify({
          content,
          mode,
          file_ids: fileIds,
          artifact_context: artifactContext ?? undefined,
        }),
```

- [ ] **Step 4: Pass active artifact context when sending messages**

In `frontend/src/hooks/use-message-stream.ts`, find the `send` function. It calls `startStream` which calls `sendMessage`. Update the `startStream` / `sendMessage` call to pass the active artifact.

Find where `sendMessage` is called within the hook (search for `sendMessage(chatId`). Add the artifact context parameter. The active artifact is available as `activeArtifact` state. Pass it if it exists and has a real (non-streaming) ID:

```typescript
const artCtx = activeArtifact && !activeArtifact.id.startsWith("streaming-")
  ? { files: activeArtifact.files, template: activeArtifact.template, title: activeArtifact.title }
  : undefined;
```

Pass `artCtx` as the last argument to `sendMessage`.

- [ ] **Step 5: Run tests and verify build**

Run: `python3 -m pytest backend/tests/ -v`
Run: `cd frontend && npx next build`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/chat.py backend/app/routers/chats.py frontend/src/lib/api.ts frontend/src/hooks/use-message-stream.ts
git commit -m "feat: inject active artifact context for edit-and-iterate"
```

---

### Task 4: Dependency Auto-Detection

**Files:**
- Modify: `backend/app/agent/artifact_parser.py`
- Modify: `backend/tests/test_artifact_parser.py`

- [ ] **Step 1: Write failing tests for dependency detection**

Add to `backend/tests/test_artifact_parser.py`:

```python
from app.agent.artifact_parser import detect_dependencies


def test_detect_missing_npm_deps():
    files = {
        "/App.js": "import { motion } from 'framer-motion';\nimport axios from 'axios';",
        "/utils.js": "import { v4 } from 'uuid';\nimport React from 'react';",
    }
    declared = {}
    missing = detect_dependencies(files, declared)
    assert "framer-motion" in missing
    assert "axios" in missing
    assert "uuid" in missing
    # react is a built-in, should NOT be detected as missing
    assert "react" not in missing


def test_detect_skips_relative_imports():
    files = {
        "/App.js": "import Foo from './Foo';\nimport Bar from '../Bar';",
    }
    missing = detect_dependencies(files, {})
    assert missing == {}


def test_detect_skips_already_declared():
    files = {
        "/App.js": "import axios from 'axios';",
    }
    declared = {"axios": "^1.0.0"}
    missing = detect_dependencies(files, declared)
    assert missing == {}


def test_detect_scoped_packages():
    files = {
        "/App.js": "import { Button } from '@radix-ui/react-button';\nimport styled from '@emotion/styled';",
    }
    missing = detect_dependencies(files, {})
    assert "@radix-ui/react-button" in missing
    assert "@emotion/styled" in missing
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_artifact_parser.py::test_detect_missing_npm_deps -v`

Expected: FAIL — function doesn't exist.

- [ ] **Step 3: Implement detect_dependencies**

Add to `backend/app/agent/artifact_parser.py`:

```python
import re as _re_mod

# Packages bundled with Sandpack templates — never flag as missing
_BUILTIN_PACKAGES = frozenset({
    "react", "react-dom", "react-scripts", "react-is",
    "next", "vue", "svelte", "angular",
})

_IMPORT_PATTERN = _re_mod.compile(
    r"""(?:import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))"""
)


def detect_dependencies(
    files: dict, declared: dict
) -> dict:
    """Scan files for npm imports not in declared dependencies.

    Returns dict of {package_name: "latest"} for missing packages.
    Skips relative imports, built-in packages, and already-declared deps.
    """
    imported = set()
    for code in files.values():
        for m in _IMPORT_PATTERN.finditer(code):
            pkg = m.group(1) or m.group(2)
            if not pkg or pkg.startswith(".") or pkg.startswith("/"):
                continue
            # Extract package name (handle scoped packages like @org/pkg)
            if pkg.startswith("@"):
                parts = pkg.split("/")
                pkg_name = "/".join(parts[:2]) if len(parts) >= 2 else pkg
            else:
                pkg_name = pkg.split("/")[0]
            imported.add(pkg_name)

    missing = {}
    for pkg in imported:
        if pkg not in declared and pkg not in _BUILTIN_PACKAGES:
            missing[pkg] = "latest"
    return missing
```

- [ ] **Step 4: Run tests**

Run: `python3 -m pytest backend/tests/test_artifact_parser.py -v`

Expected: All tests PASS.

- [ ] **Step 5: Wire auto-detection into artifact save**

In `backend/app/routers/chats.py`, in the artifact save block (around line 1036), add dependency detection after creating the artifact data but before saving:

Find:
```python
                for art_data in found_artifacts:
                    artifact = Artifact(
```

Replace with:
```python
                for art_data in found_artifacts:
                    # Auto-detect missing dependencies
                    from app.agent.artifact_parser import detect_dependencies
                    art_files = art_data.get("files", {})
                    art_deps = art_data.get("dependencies", {})
                    missing_deps = detect_dependencies(art_files, art_deps)
                    if missing_deps:
                        art_deps = {**art_deps, **missing_deps}
                        art_data["dependencies"] = art_deps

                    artifact = Artifact(
```

- [ ] **Step 6: Run all backend tests**

Run: `python3 -m pytest backend/tests/ -v`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/agent/artifact_parser.py backend/tests/test_artifact_parser.py backend/app/routers/chats.py
git commit -m "feat: auto-detect missing npm dependencies in artifact files"
```

---

### Task 5: Error Recovery — "Fix This" Button

**Files:**
- Modify: `frontend/src/components/artifact-panel.tsx`
- Modify: `frontend/src/hooks/use-message-stream.ts`

- [ ] **Step 1: Add error capture component using Sandpack's error hook**

In `frontend/src/components/artifact-panel.tsx`, add a new component after `CopyActiveFile`:

```tsx
/* ── Error overlay with Fix button ── */

function SandpackErrorOverlay({ onFix }: { onFix: (error: string) => void }) {
  const { sandpack } = useSandpack();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Sandpack exposes errors through the status and error properties
    if (sandpack.status === "idle" && sandpack.error) {
      setError(sandpack.error.message);
    } else {
      setError(null);
    }
  }, [sandpack.status, sandpack.error]);

  if (!error) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/90 p-6">
      <div className="max-w-md rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="mb-3 text-sm font-medium text-destructive">Runtime Error</p>
        <pre className="mb-4 max-h-[200px] overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">
          {error}
        </pre>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onFix(error)}
        >
          Fix this
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire error overlay into SandpackContent**

In `SandpackContent`, add the `onFix` prop to `ArtifactPanelProps`:

```typescript
interface ArtifactPanelProps {
  artifact: ArtifactData;
  onClose: () => void;
  onFixError?: (error: string) => void;
}
```

In `SandpackContent`, add the overlay inside the content div (after `<SandpackSaveBridge>`):

```tsx
      {onClose && <SandpackErrorOverlay onFix={(err) => onFixError?.(err)} />}
```

Wait — cleaner approach. Add the overlay inside the content area, positioned absolutely:

In the `SandpackContent` component, wrap the content div:

```tsx
      {/* Content */}
      <div className="relative flex flex-1 overflow-hidden">
        <SandpackErrorOverlay onFix={(err) => onFixError?.(err)} />
        {/* File explorer */}
```

Pass `onFixError` through from `ArtifactPanel` to `SandpackContent`.

- [ ] **Step 3: Handle "Fix this" in the chat page**

In `frontend/src/hooks/use-message-stream.ts`, expose a `fixArtifactError` function from the hook that constructs a message like:

```typescript
  const fixArtifactError = useCallback((error: string) => {
    if (!activeArtifact || activeArtifact.id.startsWith("streaming-")) return;
    const fixPrompt = `Fix this runtime error in the artifact "${activeArtifact.title}":\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease generate a corrected version of the project.`;
    // Trigger a send with the fix prompt + artifact context
    send(fixPrompt, "balanced", []);
  }, [activeArtifact, send]);
```

Add `fixArtifactError` to the hook's return value.

- [ ] **Step 4: Pass onFixError from the chat page to ArtifactPanel**

In `frontend/src/app/chat/[id]/page.tsx`, find where `<ArtifactPanel>` is rendered. Add the `onFixError` prop:

```tsx
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
            onFixError={(error) => fixArtifactError(error)}
          />
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd /Users/kalen_1o/startup/friendly-neighbor-assistant/frontend && npx next build`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/artifact-panel.tsx frontend/src/hooks/use-message-stream.ts frontend/src/app/chat/[id]/page.tsx
git commit -m "feat: add error recovery with Fix This button for artifact runtime errors"
```

---

### Task 6: Template Auto-Detection

**Files:**
- Modify: `backend/app/agent/artifact_parser.py`
- Modify: `backend/tests/test_artifact_parser.py`

- [ ] **Step 1: Write tests for template auto-detection**

Add to `backend/tests/test_artifact_parser.py`:

```python
from app.agent.artifact_parser import detect_template


def test_detect_react_ts_from_tsx_files():
    files = {"/App.tsx": "code", "/utils.ts": "code"}
    assert detect_template(files) == "react-ts"


def test_detect_react_from_js_files():
    files = {"/App.js": "code", "/utils.js": "code"}
    assert detect_template(files) == "react"


def test_detect_vanilla_from_html_entry():
    files = {"/index.html": "<html>", "/script.js": "code"}
    assert detect_template(files) == "vanilla"


def test_detect_mixed_prefers_ts():
    files = {"/App.tsx": "code", "/helpers.js": "code"}
    assert detect_template(files) == "react-ts"
```

- [ ] **Step 2: Implement detect_template**

Add to `backend/app/agent/artifact_parser.py`:

```python
def detect_template(files: dict) -> str:
    """Auto-detect Sandpack template from file extensions.

    Returns "react-ts" if any .tsx/.ts files exist,
    "vanilla" if /index.html is the entry,
    "react" otherwise.
    """
    paths = set(files.keys())
    has_ts = any(p.endswith(".tsx") or p.endswith(".ts") for p in paths)
    has_html_entry = "/index.html" in paths

    if has_ts:
        return "react-ts"
    if has_html_entry and "/App.js" not in paths:
        return "vanilla"
    return "react"
```

- [ ] **Step 3: Wire into artifact save**

In `backend/app/routers/chats.py`, in the artifact save block, after the dependency detection code added in Task 4, add:

```python
                    # Auto-detect template from file extensions
                    from app.agent.artifact_parser import detect_template
                    detected_template = detect_template(art_files)
                    if detected_template != art_data.get("template", "react"):
                        art_data["template"] = detected_template
```

- [ ] **Step 4: Run all tests**

Run: `python3 -m pytest backend/tests/ -v`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/artifact_parser.py backend/tests/test_artifact_parser.py backend/app/routers/chats.py
git commit -m "feat: auto-detect Sandpack template from file extensions"
```
