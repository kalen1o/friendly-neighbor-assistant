# Vision & File Attachments — Design Spec

## Overview

Allow users to attach images and files to chat messages. Images are sent to a vision-capable LLM for understanding. PDFs and text files have their content extracted and added as context. Files are stored on the local filesystem and served via API.

## Config Additions

```env
VISION_MODEL=GLM-4.5V
VISION_API_KEY=              # Leave empty to use OPENAI_API_KEY
VISION_BASE_URL=             # Leave empty to use OPENAI_BASE_URL
UPLOAD_DIR=uploads           # Local directory for uploaded files
MAX_UPLOAD_SIZE_MB=10        # Max file size
```

## Data Model

New `chat_files` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | int | PK, autoincrement |
| `public_id` | String(22) | Unique, prefix `file-` |
| `message_id` | int | FK → messages.id, nullable (linked after message is sent) |
| `chat_id` | int | FK → chats.id, ON DELETE CASCADE |
| `user_id` | int | FK → users.id |
| `filename` | String | Original filename |
| `file_type` | String(100) | MIME type (image/png, application/pdf, etc.) |
| `file_size` | int | Size in bytes |
| `storage_path` | String | Relative path on disk within UPLOAD_DIR |
| `created_at` | DateTime | Server default now() |

Migration: `0019_create_chat_files_table.py`

## API Endpoints

### `POST /api/uploads`

Upload a file. Requires auth. Returns file metadata.

**Request:** `multipart/form-data` with `file` field and optional `chat_id` field.

**Response (201):**
```json
{
  "id": "file-a1b2c3d4",
  "filename": "screenshot.png",
  "file_type": "image/png",
  "file_size": 45230
}
```

**Behavior:**
1. Validate file size (< MAX_UPLOAD_SIZE_MB)
2. Validate MIME type (images, PDFs, text files only)
3. Generate unique filename: `{uuid}.{ext}` to avoid collisions
4. Save to `UPLOAD_DIR/{user_public_id}/{uuid}.{ext}`
5. Create ChatFile record (message_id is null until message is sent)
6. Return metadata

### `GET /api/uploads/{file_id}`

Serve a file. Requires auth (owner only).

Returns the file with correct `Content-Type` header.

## Message Flow

### Request Format Change

`POST /api/chats/{chat_id}/messages` body:
```json
{
  "content": "What's in this image?",
  "file_ids": ["file-a1b2c3d4"]
}
```

`file_ids` is optional — defaults to empty list (backward compatible).

### Backend Processing

In `routers/chats.py` `send_message`:

1. If `file_ids` is present, look up ChatFile records, verify ownership, link to message
2. Separate files by type:
   - Images → will be sent as `image_url` content blocks to vision LLM
   - PDFs → extract text with pypdf (already in requirements)
   - Text files → read content directly
3. Build LLM content array:
   ```python
   content = [
       {"type": "text", "text": user_message + extracted_text},
   ]
   for image_file in image_files:
       content.append({
           "type": "image_url",
           "image_url": {"url": f"data:{file.file_type};base64,{base64_data}"}
       })
   ```
4. If images are present → pass `vision=True` to the LLM provider

### LLM Provider Changes

Add to `Settings`:
```python
vision_model: str = ""
vision_api_key: str = ""
vision_base_url: str = ""
upload_dir: str = "uploads"
max_upload_size_mb: int = 10
```

In `llm/provider.py`:
- `stream_with_tools` and other functions accept `vision: bool = False`
- When `vision=True` and provider is `openai`:
  - Use `vision_model` instead of `openai_model` (if set)
  - Use `vision_api_key` / `vision_base_url` if set, else fall back to openai settings
- When `vision=True` and provider is `anthropic`:
  - Anthropic Claude already supports vision natively, use the same model
  - Convert `image_url` format to Anthropic's `image` content block format

### Content Format by Provider

**OpenAI/GLM (OpenAI-compatible):**
```python
{"role": "user", "content": [
    {"type": "text", "text": "What's this?"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
]}
```

**Anthropic:**
```python
{"role": "user", "content": [
    {"type": "text", "text": "What's this?"},
    {"type": "image", "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "..."
    }}
]}
```

## Frontend Changes

### Chat Input Modifications

- **Attach button** — paperclip icon to the left of the send button. Opens file picker (accept: images, PDFs, text).
- **Paste handler** — intercept `paste` event on the textarea. If clipboard contains image data, upload it automatically.
- **File preview** — when files are attached (before sending), show thumbnails/icons above the input area with a remove button.
- **State** — `pendingFiles: {id, filename, file_type, previewUrl}[]` in the chat input component.

### Message Display

- When a message has associated images, display them inline in the message bubble (before or after the text).
- Images are loaded from `GET /api/uploads/{file_id}`.
- Non-image files show a file icon with filename.

### API Types

```typescript
interface ChatFileOut {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
}

// MessageCreate body gains optional file_ids
interface MessageCreate {
  content: string;
  mode?: ChatMode;
  file_ids?: string[];
}
```

## Supported File Types

| Type | MIME | Handling |
|------|------|---------|
| PNG | image/png | Vision LLM (base64) |
| JPEG | image/jpeg | Vision LLM (base64) |
| GIF | image/gif | Vision LLM (base64) |
| WebP | image/webp | Vision LLM (base64) |
| PDF | application/pdf | Text extraction (pypdf) |
| Text | text/plain | Read content directly |
| Markdown | text/markdown | Read content directly |

## File Storage

- Base directory: `UPLOAD_DIR` (default: `uploads/` relative to backend working dir)
- Per-user subdirectory: `{UPLOAD_DIR}/{user_public_id}/`
- Filename: `{uuid4_hex}.{original_extension}` (prevents collisions and path traversal)
- The `uploads/` directory should be added to `.gitignore`

## Security

- File size limit enforced server-side (MAX_UPLOAD_SIZE_MB)
- MIME type validated (only allowed types accepted)
- Filenames sanitized — stored with UUID, original name kept in DB only
- Files served through API with auth check — no direct filesystem access
- Path traversal prevented by UUID-based storage paths
- Base64 encoding for LLM means files don't leave the server as URLs

## Testing

- `test_uploads.py`:
  - Upload an image, verify metadata returned
  - Upload oversized file, verify rejected
  - Upload unsupported type, verify rejected
  - Serve uploaded file, verify content
  - Auth required for upload and serve
  - Send message with file_ids, verify files linked to message
