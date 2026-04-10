# Artifacts — Design Spec

## Overview

Add a Claude-style artifacts feature where the AI can generate live-rendered React components and HTML pages in a right-side panel. Users can view the rendered output, edit the code, and save changes. Artifacts persist in the database and reload when reopening a chat.

## How the AI Creates Artifacts

The system prompt instructs the AI to wrap renderable code in `<artifact>` tags:

```
<artifact type="react" title="Todo App">
export default function App() {
  return <h1>Hello</h1>;
}
</artifact>
```

Supported types: `react` (JSX component) and `html` (plain HTML with inline CSS/JS).

The AI decides automatically when to create artifacts based on the user's request. No explicit trigger button needed.

## Data Model

New `artifacts` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | int | PK, autoincrement |
| `public_id` | String(22) | Unique, prefix `art-` |
| `message_id` | int | FK → `messages.id`, ON DELETE CASCADE |
| `chat_id` | int | FK → `chats.id`, ON DELETE CASCADE |
| `user_id` | int | FK → `users.id` |
| `title` | String | Display name, e.g. "Todo App" |
| `artifact_type` | String(20) | `"react"` or `"html"` |
| `code` | Text | The source code |
| `created_at` | DateTime | Server default `now()` |
| `updated_at` | DateTime | Server default `now()`, onupdate `now()` |

Migration: `0017_create_artifacts_table.py`

## Backend Changes

### System Prompt

Append to the existing system prompt in `llm/provider.py`:

```
When the user asks you to build, create, or generate a UI component, web page, 
or interactive application, wrap your code in an artifact tag:

<artifact type="react" title="Component Name">
export default function App() {
  // Your React component here
}
</artifact>

For plain HTML/CSS pages, use type="html":

<artifact type="html" title="Page Name">
<!DOCTYPE html>
<html>...</html>
</artifact>

Rules:
- Use a single file. Put all styles inline or use Tailwind CSS classes.
- React artifacts must export a default function component named App.
- Always include the artifact tag when generating UI code.
- You can still include explanation text outside the artifact tag.
```

### Artifact Parser

New module `app/agent/artifact_parser.py`:

- `parse_artifacts(text: str) -> tuple[str, list[dict]]` — scans response text for `<artifact>` tags
- Returns: (cleaned text with artifacts removed, list of `{type, title, code}` dicts)
- Handles streaming: may need to buffer until the closing `</artifact>` tag is found

### SSE Protocol

New event type `artifact`:

```
event: artifact
data: {"id": "art-a1b2c3d4", "type": "react", "title": "Todo App", "code": "..."}
```

Emitted after the full response is collected and artifacts are parsed. One event per artifact.

### API Endpoints

- `GET /api/chats/{chat_id}/artifacts` — list all artifacts in a chat (for loading on chat open)
- `PATCH /api/artifacts/{artifact_id}` — update artifact code (user edits in the panel)
- `GET /api/artifacts/{artifact_id}` — get a single artifact (for direct linking)

### Message Flow Change

In `routers/chats.py` `send_message`, after the full response is collected:

1. Parse response for `<artifact>` tags
2. For each artifact found: save to DB, emit `artifact` SSE event
3. Strip artifact tags from the message text before saving to `messages` table
4. The text response (without artifact code) is what gets stored and displayed in chat bubbles

## Frontend Changes

### Layout

When an artifact is active, the chat page splits:

```
┌─────────────────────┬─────────────────────┐
│                     │                     │
│    Chat (left)      │  Artifact (right)   │
│                     │                     │
│  Messages           │  [Preview] [Code]   │
│  ...                │                     │
│  "Here's your       │  ┌───────────────┐  │
│   todo app"         │  │               │  │
│                     │  │  Live render   │  │
│                     │  │               │  │
│  [input box]        │  └───────────────┘  │
│                     │                     │
└─────────────────────┴─────────────────────┘
```

Without an active artifact, the chat is full-width as before.

### Components

**`ArtifactPanel`** — right-side panel container
- Two tabs: Preview and Code
- Close button to collapse back to full-width chat
- Title display

**`ArtifactPreview`** — sandboxed iframe for live rendering
- For `html` type: set `srcdoc` directly to the code
- For `react` type: inject a wrapper HTML that loads React 18 + ReactDOM + Tailwind CSS from CDN, then renders the user's component
- Iframe has `sandbox="allow-scripts"` — no access to parent page

React iframe template:
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body { margin: 0; font-family: system-ui, sans-serif; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${USER_CODE}
    const App = typeof module !== 'undefined' && module.exports 
      ? module.exports.default || module.exports 
      : (typeof App !== 'undefined' ? App : () => <div>No App component found</div>);
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
```

**`ArtifactEditor`** — code editing
- Textarea with monospace font and basic syntax highlighting
- On change: debounced update to preview (live) + save to DB via PATCH
- Line numbers (CSS-based, simple)

### Chat Message Integration

- When a message has an associated artifact, show a clickable "artifact card" in the message bubble (small preview with title and type badge)
- Clicking the card opens/focuses the artifact panel
- Multiple artifacts per chat supported — clicking different cards switches the panel content

### State Management

- `activeArtifact` state in the chat page — which artifact is currently shown in the panel
- Artifacts loaded on chat open via `GET /api/chats/{chat_id}/artifacts`
- New artifacts pushed via SSE `artifact` event during streaming

## Single-File Constraint

- React artifacts: one file, one default export `App` component, inline styles or Tailwind classes
- HTML artifacts: one file with inline `<style>` and `<script>` tags
- No imports between files, no bundler, no node_modules
- CDN dependencies injected: React 18, ReactDOM 18, Babel (for JSX transform), Tailwind CSS

## Security

- Iframe uses `sandbox="allow-scripts"` — prevents access to parent page, cookies, localStorage
- No `allow-same-origin` — artifact code cannot access the main app
- User code runs entirely client-side in the iframe — no server-side execution
- Artifact code is stored as-is in the DB, never executed on the backend

## Error Handling

- If React component throws during render: show error message in the preview iframe (Babel/React error boundary)
- If artifact tag parsing fails: treat the response as plain text (no artifact created)
- If code edit fails to save: show toast error, keep local state

## Testing

Backend:
- `test_artifact_parser.py`: parse artifacts from text, handle edge cases (no artifacts, multiple, malformed tags)
- `test_artifacts_routes.py`: CRUD endpoints, auth, persistence
- Integration: verify artifacts are created during message streaming

Frontend:
- Verify iframe renders React and HTML correctly
- Verify code editing updates preview
- Verify artifact cards appear in messages

## Future Improvements (V2)

- **Multi-file / folder structure** — support multiple files per artifact using Sandpack or WebContainers, enabling imports between files and proper project structure
- **Resizable panel** — drag handle to resize the chat/artifact split
- **Additional artifact types** — SVG rendering, Mermaid diagrams, markdown documents, code files with syntax highlighting
- **Version history** — track edits to an artifact, allow reverting to previous versions
- **Export / download** — download artifact as a standalone HTML file or zip
