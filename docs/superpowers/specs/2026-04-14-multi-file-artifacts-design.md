# Multi-File Artifact Generation with Sandpack

## Overview

Extend the existing artifact system to support multi-file project artifacts rendered via Sandpack. Users ask the chatbot to generate educational multi-file code examples (e.g., "show me a React app with context + hooks"), and the result appears as an interactive, editable mini-IDE in the artifact panel.

Existing single-file artifacts (`type="react"`, `type="html"`) remain unchanged.

## LLM Output Format

New artifact tag for multi-file projects:

```
<artifact type="project" title="Todo App Example" template="react">
{
  "files": {
    "/App.js": "import TodoList from './TodoList';\n...",
    "/TodoList.js": "export default function TodoList() { ... }"
  },
  "dependencies": {
    "uuid": "latest"
  }
}
</artifact>
```

**Rules:**
- `template` attribute: `"react"` (default) or `"vanilla"`
- `files`: keys are absolute paths starting with `/`, values are code strings
- `dependencies`: optional, maps package name to version string
- `/App.js` required for React template (Sandpack entry point)
- `/index.html` required for vanilla template
- Existing `<artifact type="react">` and `<artifact type="html">` tags are unaffected

## Backend Changes

### Artifact Parser (`agent/artifact_parser.py`)

- Extend regex to capture optional `template` attribute from the tag
- When `type="project"`: parse content as JSON, extract `files` and `dependencies`
- Return artifact dict with `template`, `files`, `dependencies` fields for project type
- Existing types return unchanged (raw `code` string)

### Artifact Model (`models/artifact.py`)

Add three nullable columns:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `template` | `String(20)` | `None` | Sandpack template name |
| `files` | `JSON` | `None` | File path -> code mapping |
| `dependencies` | `JSON` | `None` | Package name -> version mapping |

Existing `code` column remains for single-file artifacts. Project artifacts use `files` instead (code is `None`).

New Alembic migration to add these columns.

### Artifact Schema (`schemas/artifact.py`)

- `ArtifactOut`: Add optional `template: str | None`, `files: dict | None`, `dependencies: dict | None`
- `ArtifactUpdate`: Add optional `files: dict | None` for saving edits to project artifacts

### SSE Event (`routers/chats.py`)

Project artifacts emit the same `"artifact"` SSE event with additional fields:

```json
{
  "id": "abc123",
  "type": "project",
  "title": "Todo App Example",
  "template": "react",
  "files": { "/App.js": "...", "/TodoList.js": "..." },
  "dependencies": { "uuid": "latest" }
}
```

### PATCH Endpoint (`routers/chats.py`)

For project artifacts, accept `files` dict updates (full replacement) alongside existing `code`/`title` updates.

## Frontend Changes

### New Dependency

`@codesandbox/sandpack-react` (~200KB gzipped)

### ArtifactPanel (`artifact-panel.tsx`)

Major rework with type-based branching:

- **Single-file artifacts** (`type === "react" | "html"`): Current Monaco + iframe flow, unchanged
- **Project artifacts** (`type === "project"`): Sandpack-based rendering

**Project artifact layout:**

```
+----------------------------------+
|  Title         [Copy] [Reload] X |
+----------------------------------+
|  [Code]  [Preview]               |
+--------+-------------------------+
| Files  |  Active view            |
|        |  (editor or preview)    |
| App.js |                         |
| Todo.. |                         |
| index. |                         |
+--------+-------------------------+
```

- Tabbed view: Code tab and Preview tab (consistent with existing single-file UX)
- File explorer: ~150px fixed width on the left, scrollable, visible in both tabs
- Code tab: `<SandpackCodeEditor>` showing the selected file
- Preview tab: `<SandpackPreview>` with live rendering
- Responsive: file explorer collapses to dropdown on narrow screens

**Sandpack integration:**
- `<SandpackProvider>` wraps the entire panel
- `template` prop mapped from artifact data
- `files` prop passed directly from artifact data
- `customSetup.dependencies` passed from artifact data
- `onFileChange` listener with debounced save (1000ms) to backend via PATCH

**Controls:**
- Copy: copies the active file's code
- Reload: forces Sandpack preview refresh
- Close: closes the panel

### ArtifactCard (`artifact-card.tsx`)

- New icon: `Layers` icon for project type (existing: `Code` for react, `Globe` for html)
- File count badge (e.g., "3 files")
- Download: exports as `.zip` file for project type (single files stay as `.jsx`/`.html`)

### Type Updates (`api.ts`)

Extend `ArtifactData`:

```typescript
interface ArtifactData {
  id: string;
  type: "react" | "html" | "project";
  title: string;
  code?: string;           // single-file
  template?: string;       // project
  files?: Record<string, string>;  // project
  dependencies?: Record<string, string>;  // project
}
```

### Sandpack Theming

- Dark theme to match existing artifact panel
- Accent colors aligned with app's Tailwind/shadcn palette

## Components Not Changed

- `artifact-preview.tsx`: Project artifacts bypass this (Sandpack handles preview)
- `use-message-stream.ts`: Already handles artifact events generically
- `active-streams.ts`: No structural changes needed

## System Prompt Update

Add to the LLM system prompt in `llm/provider.py`:

```
For multi-file projects, use:
<artifact type="project" title="..." template="react|vanilla">
JSON with "files" object (keys = file paths starting with /, values = code)
and optional "dependencies" object (keys = package names, values = versions)
</artifact>

Use type="project" when the example needs multiple files (components, utilities, etc.).
Use type="react" or type="html" for simple single-file examples.
React projects must include /App.js as the entry point.
Vanilla projects must include /index.html as the entry point.
```

## Migration Plan

Single Alembic migration adding `template`, `files`, `dependencies` columns to the `artifacts` table. All nullable, no data migration needed — existing artifacts continue to use `code` column.
