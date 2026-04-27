# Inline PDF Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click an attached PDF in chat → opens inline in a new browser tab (browser's built-in PDF viewer takes over). Also: replace the hand-rolled in-chat file-card `<a>` with a shadcn `Button asChild` for visual consistency.

**Architecture:** Two surgical changes. Backend: pass `content_disposition_type="inline"` to `FileResponse` in `backend/app/routers/uploads.py` so the browser displays files inline instead of downloading them. Frontend: swap the non-image file-card branch in `frontend/src/components/message-bubble.tsx` from a hand-rolled anchor to shadcn `Button asChild` paired with `lucide-react` icons (`FileText` for PDFs, `Paperclip` otherwise).

**Tech Stack:** FastAPI / Starlette `FileResponse`, Next.js, React, shadcn/ui (`Button`), `lucide-react`. Backend tests run via `docker exec fn-backend python -m pytest tests/...`.

**Reference spec:** `docs/superpowers/specs/2026-04-27-inline-pdf-viewing-design.md`

---

## Pre-flight

- [ ] **Verify the backend container is running and the existing upload tests pass.**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py -v`
Expected: All 5 existing tests pass (`test_upload_image`, `test_upload_unsupported_type`, `test_serve_uploaded_file`, `test_upload_requires_auth`, `test_serve_nonexistent_file`).

If the container isn't running, start it: `make up` (or `docker compose up -d` from the project root).

---

## Task 1: Backend — `Content-Disposition: inline`

**Files:**
- Modify: `backend/app/routers/uploads.py:99-103`
- Test: `backend/tests/test_uploads.py` (extend existing file)

- [ ] **Step 1: Append the failing test to `backend/tests/test_uploads.py`**

The file already has `test_serve_uploaded_file` which uploads a PNG and GETs it back. Add a new test right after it that asserts the response's `Content-Disposition` header begins with `inline;`.

Open `backend/tests/test_uploads.py` and append the following just before `test_upload_requires_auth` (at the end, before the auth tests):

```python
@pytest.mark.anyio
async def test_serve_uploaded_file_uses_inline_content_disposition(client):
    """The /api/uploads/{id} response must use Content-Disposition: inline so
    that browsers display PDFs (and other displayable types) inline in a new
    tab rather than triggering a download."""
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
        b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    upload = await client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(png_bytes), "image/png")},
    )
    file_id = upload.json()["id"]

    response = await client.get(f"/api/uploads/{file_id}")
    assert response.status_code == 200
    disposition = response.headers.get("content-disposition", "")
    assert disposition.lower().startswith("inline"), (
        f"expected Content-Disposition to start with 'inline'; got: {disposition!r}"
    )
```

- [ ] **Step 2: Run the new test — it must fail**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py::test_serve_uploaded_file_uses_inline_content_disposition -v`

Expected: FAIL with assertion message similar to:
```
AssertionError: expected Content-Disposition to start with 'inline'; got: 'attachment; filename="test.png"'
```

This is the TDD failing-first step. Do not skip it. If the test passes here, the assertion isn't actually testing what we think.

- [ ] **Step 3: Add `content_disposition_type="inline"` to `FileResponse`**

Open `backend/app/routers/uploads.py`. Find the existing `FileResponse(...)` call near line 99 (inside the `serve_file` function):

**Before:**
```python
return FileResponse(
    chat_file.storage_path,
    media_type=chat_file.file_type,
    filename=chat_file.filename,
)
```

**After:**
```python
return FileResponse(
    chat_file.storage_path,
    media_type=chat_file.file_type,
    filename=chat_file.filename,
    content_disposition_type="inline",
)
```

Single line addition (`content_disposition_type="inline",`). No other changes to this file.

- [ ] **Step 4: Run the new test — it must pass**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py::test_serve_uploaded_file_uses_inline_content_disposition -v`

Expected: PASS.

- [ ] **Step 5: Run the full uploads test file — all tests must still pass**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py -v`

Expected: 6 tests pass (5 pre-existing + 1 new).

- [ ] **Step 6: Run the broader agent-path test suite for sanity**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py tests/test_chat_e2e.py tests/test_chat_routes.py -q`

Expected: All pass. (No tests outside this scope should be affected by the one-line change, but verify since `serve_file` is consumed by chat-related tests indirectly.)

- [ ] **Step 7: Commit the backend change**

```bash
git add backend/app/routers/uploads.py backend/tests/test_uploads.py
git commit -m "$(cat <<'EOF'
feat(uploads): serve files with Content-Disposition: inline

Browsers now display PDFs (and images, text) inline in a new tab instead
of triggering a download. The PDF viewer's own download button still lets
users save when they want to.

Adds test_serve_uploaded_file_uses_inline_content_disposition asserting
the response header starts with `inline;` to guard against regression.

6 tests pass (5 pre-existing + 1 new) in test_uploads.py.
EOF
)"
```

---

## Task 2: Frontend — shadcn `Button asChild` file card

**Files:**
- Modify: `frontend/src/components/message-bubble.tsx` (the non-image branch in the user-message file-list, currently lines ~280-291)

- [ ] **Step 1: Read the current message-bubble file-list block**

Open `frontend/src/components/message-bubble.tsx` and locate the `{files && files.length > 0 && (` block (around line 268). Inside it is a `.map((f, i) => f.type.startsWith("image/") ? <img .../> : <a .../>)`. The `<a>` branch is what we're replacing — currently spanning roughly lines 280-291.

Confirm you have the right block: it should contain `<a key={i} href={f.url} target="_blank" rel="noopener noreferrer"`, an inline `<svg>` file-icon, and the filename `{f.name}`.

- [ ] **Step 2: Verify shadcn `Button` and `lucide-react` are available**

Run: `ls frontend/src/components/ui/button.tsx`
Expected: file exists (this is the shadcn-generated Button component).

Run (from `frontend/`): `grep -l "lucide-react" frontend/package.json`
Expected: matches — `lucide-react` is already a dependency. (Other components in this repo import from it, e.g., `Send` in `message-bubble.tsx` already.)

If either is missing, stop and report — the spec assumes both are present.

- [ ] **Step 3: Add the imports if not already present**

At the top of `frontend/src/components/message-bubble.tsx`, ensure these imports exist:

```tsx
import { Button } from "@/components/ui/button"
import { FileText, Paperclip } from "lucide-react"
```

If `Button` is already imported elsewhere from the file, leave that import alone. If `lucide-react` already imports other icons (e.g., `Send`, `Pencil`), extend that existing import line with `FileText` and `Paperclip` rather than adding a second import statement. Example: `import { Send, Pencil, FileText, Paperclip } from "lucide-react"`.

- [ ] **Step 4: Replace the non-image file-card `<a>` block**

Find the existing block (around lines 280-291):

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

Replace with:

```tsx
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

The `key` moves from the `<a>` to the outer `<Button>` (React's key requirement is on the outermost element returned from `.map`). The image branch directly above is **not changed**.

- [ ] **Step 5: Verify the file compiles without TypeScript errors**

Run (from project root): `docker exec fn-frontend npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`

Expected: no errors related to `message-bubble.tsx`. (Pre-existing errors unrelated to your change can be ignored — focus on lines you touched.)

If `fn-frontend` isn't a running container, run instead from the host with `cd frontend && npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 6: Manual smoke test — PDF inline viewing**

Start the local stack if not already running:
```
make local-db
make local-backend
make local-frontend
```

In a browser:
1. Sign in to the app.
2. Open or create a chat.
3. Attach a PDF using the existing chat-input attachment control. Use any small PDF — your resume, a manual, anything.
4. Send the message.
5. Confirm: the file card in your sent user message renders with the new shadcn styling (a `secondary`-variant button-shaped pill, rounded corners, the lucide `FileText` icon next to the filename, hover/focus states reactive).
6. Click the file card.
7. Confirm: a new browser tab opens at `http://localhost:.../api/uploads/<file-id>` and the browser's built-in PDF viewer renders the document inline (not a download prompt). The PDF viewer should show page thumbnails (Chrome/Edge), zoom controls, page navigation, search, and a download button — all browser-provided.

If the click triggers a download instead of inline view, the backend change in Task 1 didn't take effect. Re-check that `content_disposition_type="inline"` is present and the backend container picked up the reload (`make local-backend` runs uvicorn with `--reload`).

- [ ] **Step 7: Manual smoke test — image still works, text/markdown render with `Paperclip`**

Still in the browser:
1. In the same chat, attach a small image (PNG or JPEG). Send.
2. Confirm: image renders as an inline `<img>` preview in your sent message (existing behavior — the image branch at `message-bubble.tsx:271-278` was untouched).
3. Attach a `.txt` or `.md` file. Send.
4. Confirm: the file card renders with the lucide `Paperclip` icon (not `FileText`), filename truncated if long.
5. Click the text file card. Confirm: opens inline as plain text in a new tab.

- [ ] **Step 8: Long-filename truncation check**

1. Attach a file with a 60+ character filename (e.g., create a copy of an existing file renamed to something like `2026-04-27-extremely-long-filename-for-testing-truncation-behavior-edge-case.pdf`). Send.
2. Confirm: in the chat, the file card displays the filename truncated with an ellipsis (the `truncate max-w-[18rem]` class), and the row layout stays intact (no horizontal overflow). Hovering shows the full name via the `aria-label` (or browser tooltip from screen reader hints).

- [ ] **Step 9: Commit the frontend change**

```bash
git add frontend/src/components/message-bubble.tsx
git commit -m "$(cat <<'EOF'
feat(chat): use shadcn Button for in-chat file attachment cards

Replaces the hand-rolled <a> file card in message-bubble.tsx with a
shadcn Button (variant=secondary) rendered via asChild so it stays a
real anchor for keyboard navigation and screen readers. Adds lucide
icons (FileText for PDFs, Paperclip for other non-image types) and
truncates long filenames. The image-preview branch is unchanged.

Pairs with the backend Content-Disposition: inline change so clicking
the file card now opens the PDF inline in a new tab (browser's
built-in PDF viewer) instead of triggering a download.
EOF
)"
```

---

## Task 3: Verification

- [ ] **Step 1: Confirm both commits are in `git log`**

Run: `git log --oneline -3`

Expected output (top to bottom, most recent first):
```
<sha2> feat(chat): use shadcn Button for in-chat file attachment cards
<sha1> feat(uploads): serve files with Content-Disposition: inline
<previous-commit>
```

- [ ] **Step 2: Confirm the spec's "Behavior Preservation" claims hold**

The spec says these stay unchanged. Spot-check by reading the relevant lines:

- Image inline rendering — open `frontend/src/components/message-bubble.tsx`. The `<img>` branch at the top of the `.map` (around lines 271-278) should be byte-identical to before this feature.
- Auth on the upload route — `backend/app/routers/uploads.py:85` should still have `user: User = Depends(get_current_user)` in `serve_file`'s signature.
- File scoping — `backend/app/routers/uploads.py:88-90` should still filter `ChatFile.user_id == user.id`.
- LLM PDF embedding — `backend/app/routers/chats.py` around line 1360 (`elif f.file_type == "application/pdf":`) should be untouched.

If any of those have changed beyond what this plan describes, stop and investigate — it's an unintended side effect.

- [ ] **Step 3: Final test pass**

Run: `docker exec fn-backend python -m pytest tests/test_uploads.py tests/test_chat_e2e.py tests/test_chat_routes.py -q`

Expected: all pass (the 6 uploads tests + everything in chat_e2e/chat_routes).

---

## Done

The feature is complete:

- Clicking a PDF attachment in chat opens the file inline in a new browser tab. The browser's built-in PDF viewer provides thumbnails, zoom, page navigation, search, download, and print — all without any custom viewer code on our side.
- The in-chat file card uses shadcn's `Button` for visual consistency with the rest of the UI, lucide icons that distinguish PDFs from other file types, and proper ARIA labels for accessibility.
- Image previews in chat continue to render inline as before.
- Backend test guards against future regressions of the `Content-Disposition: inline` behavior.
