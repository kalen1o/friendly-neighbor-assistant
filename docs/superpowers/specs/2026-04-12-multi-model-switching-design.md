# Multi-Model Switching Design

Users can add their own LLM models with API keys, set a personal default, and override the model per-chat. Three-level fallback: per-chat model → user default → project default (from .env).

## Data Model

### New Table: `user_models`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | auto-increment |
| `public_id` | str(22), unique | prefix `umod_` |
| `user_id` | int, FK → users.id, CASCADE | owner |
| `name` | str(100), NOT NULL | display name, e.g. "My GPT-4o" |
| `provider` | str(20), NOT NULL | `openai`, `anthropic`, `openai_compatible` |
| `model_id` | str(100), NOT NULL | actual model identifier, e.g. `gpt-4o`, `claude-sonnet-4-20250514` |
| `api_key_encrypted` | text, NOT NULL | Fernet-encrypted API key |
| `base_url` | str(500), nullable | custom endpoint (required for `openai_compatible`) |
| `is_default` | bool, default false | user's default model (at most one per user) |
| `created_at` | datetime(tz) | auto |

### Chat Table Changes

Add one nullable column:
- `model_id` (int, FK → user_models.id, SET NULL on delete, nullable) — null means "use user default or project default"

### Encryption

API keys encrypted at rest using Fernet symmetric encryption (`cryptography` library). Encryption key stored as env var `ENCRYPTION_KEY`, generated via `Fernet.generate_key()`. If `ENCRYPTION_KEY` is not set, custom model endpoints return 403 "Encryption not configured" — project default still works.

Keys are decrypted only at request time in memory, never returned to the frontend.

## API Endpoints

### Model CRUD

#### `POST /api/models`

Create a custom model. Validates API key with a test call before saving.

**Request:**
```json
{
  "name": "My GPT-4o",
  "provider": "openai",
  "model_id": "gpt-4o",
  "api_key": "sk-...",
  "base_url": null
}
```

**Validation:**
- `provider` must be one of: `openai`, `anthropic`, `openai_compatible`
- `base_url` required when provider is `openai_compatible`
- API key validated with a minimal test call (single-token completion)
- If test call fails, return 400 with provider error message

**Response:** `201` with `ModelOut`

#### `GET /api/models`

List user's models plus the project default.

**Response:** `200` with `ModelOut[]`

The project default is always included as a special entry:
```json
{
  "id": "project-default",
  "name": "Project Default",
  "provider": "openai",
  "model_id": "glm-5.1",
  "base_url": null,
  "is_default": false,
  "builtin": true,
  "created_at": null
}
```

#### `PATCH /api/models/{id}`

Update model properties. Setting `is_default=true` clears any other default for the user.

**Request (all fields optional):**
```json
{
  "name": "Renamed Model",
  "model_id": "gpt-4o-mini",
  "api_key": "sk-new-...",
  "base_url": null,
  "is_default": true
}
```

If `api_key` is provided, it's re-validated with a test call.

#### `DELETE /api/models/{id}`

Delete a model. Chats using it fall back to default (FK SET NULL).

**Response:** `204`

#### `POST /api/models/{id}/test`

Test connectivity with stored API key.

**Response:**
```json
{ "success": true, "message": "Connection successful" }
```
or
```json
{ "success": false, "message": "Invalid API key" }
```

### Chat Changes

#### `PATCH /api/chats/{id}`

Add optional `model_id` to existing update body:
- Set to a model's public_id to use that model for this chat
- Set to `"project-default"` to explicitly use the project default
- Set to `null` to reset (inherit user default or project default)

#### `GET /api/chats/{id}` and `GET /api/chats`

Response includes `model_id` (public_id of the model, or `"project-default"`, or null).

### Response Schema

```python
class ModelOut(BaseModel):
    id: str
    name: str
    provider: str
    model_id: str
    base_url: str | None
    is_default: bool
    builtin: bool       # true for project default
    created_at: str | None
```

API keys are never returned in responses.

## Provider Refactor

### ModelConfig Dataclass

```python
@dataclass
class ModelConfig:
    provider: str          # "anthropic", "openai", "openai_compatible"
    model_id: str          # "gpt-4o", "claude-sonnet-4-20250514"
    api_key: str           # decrypted key
    base_url: str | None   # custom endpoint
```

### Changes to provider.py

The streaming functions (`stream_with_tools`, `get_llm_response`, `_anthropic_stream`, `_openai_stream`, etc.) gain an optional `model_config: ModelConfig | None` parameter. If provided, it overrides the global settings. If `None`, falls back to project default from `.env`.

For `openai_compatible` provider, the code uses the same OpenAI client with a custom `base_url`.

### Resolution Order (in chat router)

At the start of `send_message()`:

1. Chat has `model_id` set → load that `UserModel`, decrypt key → `ModelConfig`
2. User has a default model (`is_default=True`) → load that, decrypt → `ModelConfig`
3. Neither → `None` (provider.py uses project default from settings)

This `ModelConfig` is passed through to all LLM calls for that message.

### Title Generation

`_generate_title()` always uses the project default (no `model_config`) — avoids burning user's API credits on auto-titles.

## Frontend UI

### Settings Dialog — "Models" Tab

Add a new tab to the existing settings dialog (alongside the existing theme/usage content):

- **Project Default** section at top — shows the admin-configured model (read-only): provider icon + model name + model_id
- **Your Models** section below — list of user's custom models:
  - Each row: provider icon + display name + model_id + "Default" badge (if default)
  - Hover actions: "Set as default" toggle, Edit (pencil), Delete (trash)
- **"Add Model" button** — opens inline form:
  - Provider dropdown: OpenAI, Anthropic, OpenAI-Compatible
  - Model ID text input (with placeholder hints per provider, e.g. "gpt-4o", "claude-sonnet-4-20250514")
  - API Key input (password field, never pre-filled on edit)
  - Base URL input (shown only when provider is OpenAI-Compatible)
  - Display name input
  - "Test Connection" button
  - Save / Cancel buttons

### Chat Input — Model Picker

A small model indicator to the left of the chat input box (left of the existing mode selector):
- Shows an icon + short model name (e.g., "GPT-4o" or "Claude Sonnet" or "Default")
- Clicking opens a dropdown:
  - "Default" option at top (shows what it resolves to: user default or project default)
  - Divider
  - User's custom models, each with provider icon + name
  - Project default at bottom
- Selecting a model calls `PATCH /api/chats/{id}` with the `model_id`
- Selection persists for that chat

### ChatSummary / ChatDetail Changes

Both include optional `model_id: string | null` so the frontend knows which model is active.

## Key Behaviors

### API Key Validation on Create/Update
When `api_key` is provided, make a minimal test call (short prompt, max_tokens=1) to verify. If it fails, return 400 with the provider's error message. Don't save the key if validation fails.

### Model Deletion
- Chats using it: `model_id` set to NULL via FK SET NULL → fall back to default
- If it was user's default: no default anymore → project default takes over

### Encryption Key Missing
If `ENCRYPTION_KEY` env var is not set:
- `POST /api/models` returns 403 "Encryption not configured"
- `GET /api/models` returns only the project default
- Everything else works normally with project default

### Provider Behavior
- **OpenAI**: `openai.AsyncOpenAI(api_key=...)`
- **Anthropic**: `anthropic.AsyncAnthropic(api_key=...)`
- **OpenAI-Compatible**: `openai.AsyncOpenAI(api_key=..., base_url=...)` — same client, custom endpoint

## Migration

Migration `0023_create_user_models_table.py`:
1. Create `user_models` table
2. Add `model_id` column to `chats` table (FK → user_models.id, SET NULL on delete, nullable, indexed)
