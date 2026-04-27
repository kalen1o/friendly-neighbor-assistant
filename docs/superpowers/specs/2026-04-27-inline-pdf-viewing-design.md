# Inline PDF Viewing — Design Spec

## Problem

When a user attaches a PDF to a chat and clicks the file card in their sent message, the browser triggers a **download** instead of opening the PDF inline in a new tab. Reason: `backend/app/routers/uploads.py:99` calls `FileResponse(..., filename=...)` without specifying `content_disposition_type`, so Starlette defaults to `Content-Disposition: attachment; filename="..."`. The user wants to view the PDF the way claude.ai does — open in a new tab, browser's built-in PDF viewer takes over (page thumbnails, zoom, page navigation, search, download button, print — all browser-provided).

Secondary: the file card itself in `message-bubble.tsx:280-291` is a hand-rolled `<a>` element with custom Tailwind classes. The rest of the UI uses shadcn primitives. Replacing this card with a shadcn `Button asChild` is a visual consistency cleanup that pairs naturally with the inline-viewing change.

## Solution

Two small changes:

1. **Backend.** `FileResponse` in `uploads.py` gets `content_disposition_type="inline"`. The browser then renders displayable types (PDFs, images, text) inline in the new tab instead of downloading.

2. **Frontend.** Replace the hand-rolled file-card `<a>` in `message-bubble.tsx:280-291` with a shadcn `Button` using the `asChild` pattern, paired with a `lucide-react` icon (`FileText` for PDFs, `Paperclip` for other non-image types). Click → new tab → browser's native PDF viewer (or the appropriate inline display for other types).

The image branch in `message-bubble.tsx:271-278` stays as-is — images already render as `<img>` previews in the chat, no change needed.

## Decisions Already Made

The brainstorm settled these axes:

- **Open-in-new-tab** model (option D from the layout question). No modal, no side panel, no dedicated viewer route. The browser's native PDF viewer is good enough and matches what claude.ai delivers feature-for-feature.
- **No custom viewer.** No `react-pdf`, no PDF.js iframe, no custom thumbnail sidebar. The browser owns the viewer chrome entirely.
- **Shadcn for the file card** (option A from the shadcn question). The "use shadcn" directive applies to the in-chat file card, not to a built-from-scratch viewer.
- **Image inline rendering unchanged** — images already render in chat via `<img>`; no change there.

## Backend Change

`backend/app/routers/uploads.py:99-103` — add one line:

```python
return FileResponse(
    chat_file.storage_path,
    media_type=chat_file.file_type,
    filename=chat_file.filename,
    content_disposition_type="inline",
)
```

This affects the `GET /api/uploads/{file_id}` route only. With `inline`, the browser:
- **PDFs** → built-in PDF viewer renders the document in the new tab.
- **Images** → browser displays the image directly.
- **Text / markdown** → browser displays as plain text.

The `filename` is still set so the user-facing download (via the PDF viewer's own download button, or right-click → save) still produces a sensibly-named file.

No other backend changes. No new endpoints. No DB migration. No settings change.

## Frontend Change

`frontend/src/components/message-bubble.tsx:280-291` — replace the existing `<a>` element with a shadcn `Button asChild`.

**Before** (current):

```tsx
<a
  key={i}
  href={f.url}
  target="_blank"
  rel="noopener noreferrer"
  className="flex items-center gap-2 rounded-lg bg-primary-foreground/10 px-3 py-1.5 text-xs text-primary-foreground/80 hover:text-primary-foreground"
>
  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
  {f.name}
</a>
```

**After**:

```tsx
import { Button } from "@/components/ui/button"
import { FileText, Paperclip } from "lucide-react"

<Button
  key={i}
  variant="secondary"
  size="sm"
  asChild
  className="h-auto gap-2 px-3 py-1.5 text-xs"
>
  <a
    href={f.url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`Open ${f.name} in a new tab`}
  >
    {f.type === "application/pdf" ? (
      <FileText className="h-4 w-4 shrink-0" />
    ) : (
      <Paperclip className="h-4 w-4 shrink-0" />
    )}
    <span className="truncate max-w-[18rem]">{f.name}</span>
  </a>
</Button>
```

**Why these choices:**

- **`Button asChild`** — shadcn idiom for "Button-styled element that's actually a link." Keyboard focus, hover, and click semantics work like a real anchor; styling comes from the `Button` variant.
- **`variant="secondary"`** — matches the existing muted-pill look from the prior `bg-primary-foreground/10` background. If the project's `secondary` variant is too prominent, `variant="outline"` is the fallback. (Confirm at implementation time by visual inspection.)
- **`size="sm"` + custom `h-auto px-3 py-1.5`** — preserves the existing pill height (`text-xs` and tight vertical padding) rather than the default `size="sm"` height which is taller. This keeps the in-chat density.
- **Icon by type** — `FileText` for PDFs, `Paperclip` for everything else (text, markdown, anything not an image). Two icons total. Per the "Out of Scope" section below, type-specific icons for text/markdown are a follow-up.
- **`truncate max-w-[18rem]`** — long filenames truncate with ellipsis instead of breaking row layout. The original code didn't truncate.
- **`aria-label`** — explicit screen-reader label that names the file. The original anchor relied on the visible filename text alone.

The image branch (`message-bubble.tsx:271-278`) is **not changed** in this spec.

## Out of Scope

- **Clickable image thumbnails.** Currently the inline `<img>` previews aren't wrapped in `<a target="_blank">`. Adding that to open full-size in a new tab is a one-line follow-up but not part of this feature.
- **Type-specific icons** for `text/markdown`, `text/plain`, etc. All non-image, non-PDF types currently render with `Paperclip`. Adding `FileCode2` for source files, `FileType` for text, etc., is a small follow-up.
- **Custom viewer page** at `/files/{id}` with `react-pdf` and a thumbnails sidebar. Explicit user choice (option A vs B in the brainstorm) — using the browser's viewer is the agreed approach.
- **Filename in the new tab's browser title.** Browsers don't reliably honor the `Content-Disposition: inline; filename="..."` hint for tab titles. Out of our control.
- **Inline viewer embedded in the chat (without leaving to a new tab).** Keeps focus in chat but adds bundle weight and complexity; explicitly rejected during the brainstorm.
- **Restricted-type fallback.** Files of unsupported display types (e.g., a hypothetical `.zip` upload, if we ever allowed it) would still hit the same endpoint. The browser would attempt inline display and either show a download prompt anyway or render gibberish. Currently the upload route only allows `image/*`, `application/pdf`, `text/plain`, `text/markdown` (`uploads.py:20-28`), all of which display fine inline. If we expand `ALLOWED_TYPES`, we may need to revisit.

## Testing

### Backend

Add a test in `backend/tests/test_uploads.py`:

- `test_serve_file_uses_inline_content_disposition` — upload a fixture PDF (or any allowed type), GET `/api/uploads/{public_id}`, assert response header `content-disposition` starts with `inline;` (not `attachment;`). Catches the regression if anyone removes the new arg later.

If `test_uploads.py` already exists, append the test. If not, create it with the standard async test client fixture.

### Frontend

The Playwright test `frontend/tests/debug-file-attach.spec.ts` already exercises the upload + attach flow. A light addition:

- Assert the rendered file card is a `Button asChild` (i.e., the rendered DOM has `role="link"`, `target="_blank"`, and the correct `href` pattern `/api/uploads/<public_id>`).

Optional. The visual change is covered by manual QA below.

### Manual QA

1. Start local stack: `make local-db`, `make local-backend`, `make local-frontend`.
2. Sign in, attach a PDF in chat, send the message.
3. Confirm the file card in the sent message uses the new shadcn `Button` styling (proper hover/focus, secondary background, lucide `FileText` icon for PDFs, truncated filename).
4. Click the file card → new tab opens → browser PDF viewer renders the document inline. Verify page thumbnails, zoom, page navigation, search, download button, print all work (all browser-provided).
5. Attach an image → confirm inline `<img>` preview is unchanged in the chat (no shadcn styling applied; image branch was untouched).
6. Attach a `.txt` or `.md` → confirm shadcn file card uses `Paperclip` icon, opens inline as plain text in new tab.
7. Long filename test: attach a file with a 60+ character name → confirm the file card truncates with ellipsis, full name visible via `aria-label` / browser tooltip.

## Risk & Rollback

**Risk surface is small.** Two files changed: one line in `uploads.py`, ~12 lines in `message-bubble.tsx`. No DB changes, no schema changes, no new endpoints, no new settings.

**Failure modes:**
- Some browser PDF viewer is broken or absent (e.g., a niche browser or a corporate-policy-disabled viewer) → user gets the browser's fallback behavior (download prompt). Acceptable; matches behavior in any web app that opens PDFs inline.
- `Content-Disposition: inline` ignored by some download manager extensions → user gets a download instead of inline view. Acceptable; degrades to current behavior.

**Rollback:** revert the two-file commit. Pre-feature behavior (download PDF, hand-rolled file card) recovered exactly. No DB to migrate back, no caches to clear, no users mid-flow.

## Behavior Preservation

- Existing image-inline rendering: unchanged.
- Existing message-bubble rendering for assistant messages, edit mode, sources: unchanged.
- Existing upload route auth (cookie-based, requires `get_current_user`): unchanged. Files remain user-scoped (`ChatFile.user_id == user.id` filter in `serve_file`).
- Existing chat history serialization (`MessageOut.files: MessageFileRef[]`): unchanged.
- Existing PDF base64 → LLM content embedding (chats.py:1360 area): unchanged. The LLM continues to see the PDF; this feature only changes the user-facing viewer behavior.
