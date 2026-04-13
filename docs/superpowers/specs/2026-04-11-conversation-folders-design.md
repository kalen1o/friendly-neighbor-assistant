# Conversation Folders Design

Nested folder system for organizing conversations in the sidebar. Users can create hierarchical folders (up to 5 levels deep), assign chats to folders, customize folders with colors and icons, and reorder via drag-and-drop. The sidebar offers two views: a flat "All Chats" list and a "Folders" tree view.

## Data Model

### New Table: `folders`

| Column | Type | Notes |
|---|---|---|
| `id` | int, PK | auto-increment |
| `public_id` | str(22), unique | prefix `fld_` |
| `user_id` | int, FK → users.id, NOT NULL | owner |
| `parent_id` | int, FK → folders.id, nullable | null = root-level folder |
| `name` | str(100), NOT NULL | folder name |
| `color` | str(20), nullable | e.g., `"blue"`, `"#3b82f6"` |
| `icon` | str(50), nullable | emoji or icon name, e.g., `"briefcase"` |
| `position` | int, default 0 | ordering among siblings |
| `created_at` | datetime(tz) | auto |
| `updated_at` | datetime(tz) | auto |

**Constraints:**
- Unique: `(user_id, parent_id, name)` — no duplicate names at the same level
- ON DELETE of parent: handled in application code (not CASCADE)

### Chat Table Changes

Add one column:
- `folder_id` (int, FK → folders.id, SET NULL on delete, nullable) — null means unfiled

## API Endpoints

### Folder CRUD

#### `POST /api/folders`
Create a folder.

**Request:**
```json
{
  "name": "Work",
  "parent_id": null,
  "color": "blue",
  "icon": "briefcase"
}
```
- `parent_id` is optional (null = root-level). Uses public_id of parent folder.
- `color` and `icon` are optional.
- `position` auto-assigned to end of siblings.

**Response:** `201` with `FolderOut`

**Validation:**
- `parent_id` must exist and belong to the user
- Resulting depth must not exceed 5 levels
- Name must be unique among siblings

#### `GET /api/folders`
List all user's folders as a flat array. Frontend builds the tree.

**Response:** `200` with `FolderOut[]`

```json
[
  { "id": "fld_abc", "name": "Work", "parent_id": null, "color": "blue", "icon": "briefcase", "position": 0, "chat_count": 3 },
  { "id": "fld_def", "name": "Project X", "parent_id": "fld_abc", "color": null, "icon": null, "position": 0, "chat_count": 5 }
]
```

#### `PATCH /api/folders/{folder_id}`
Update folder properties. Any field can be updated independently.

**Request (all fields optional):**
```json
{
  "name": "Personal",
  "parent_id": "fld_abc",
  "color": "#ef4444",
  "icon": "heart",
  "position": 2
}
```

**Validation:**
- Cannot move a folder into itself or any of its descendants (cycle prevention)
- Resulting depth of folder + its subtree must not exceed 5 levels
- Name must be unique among new siblings

#### `DELETE /api/folders/{folder_id}?action=move_up|delete_all`
Delete a folder. The `action` query parameter is required.

- `move_up`: Chats and sub-folders get reassigned to the deleted folder's `parent_id`
- `delete_all`: Cascading delete of all sub-folders and all chats within them

**Response:** `204`

### Chat Endpoint Changes

#### `PATCH /api/chats/{chat_id}`
Add optional `folder_id` to the existing update body.
- Set to a folder's public_id to move chat into that folder
- Set to `null` to unfile the chat

#### `GET /api/chats`
Add optional `folder_id` query parameter:
- `?folder_id=fld_xxx` — chats in that specific folder only (not recursive)
- `?folder_id=none` — unfiled chats only
- No param — all chats regardless of folder (existing behavior)

### Schemas

```python
class FolderCreate(BaseModel):
    name: str = Field(max_length=100)
    parent_id: str | None = None
    color: str | None = Field(None, max_length=20)
    icon: str | None = Field(None, max_length=50)

class FolderUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    parent_id: str | None = None  # use literal "root" to move to root
    color: str | None = None
    icon: str | None = None
    position: int | None = None

class FolderOut(BaseModel):
    id: str
    name: str
    parent_id: str | None
    color: str | None
    icon: str | None
    position: int
    chat_count: int
```

## Frontend UI

### Sidebar View Toggle

A toggle at the top of the chat list area with two modes:
- **"All Chats"** — flat chronological list, identical to current behavior
- **"Folders"** — tree view with collapsible folders

Selected view persists in `localStorage` key `sidebar-view-mode`.

### Folder Tree (Folders View)

- Folders render as collapsible rows, indented per nesting level (16px per level)
- Each folder row: folder icon (custom or default) + colored dot (if color set) + name + chat count badge + expand/collapse chevron
- Clicking a folder toggles expand/collapse
- Chats inside a folder appear indented below it
- Unfiled chats appear at the bottom under a subtle "Unfiled" divider
- Expand/collapse state persists in `localStorage` key `folder-expanded-state`

### Drag & Drop

Uses HTML5 drag-and-drop (or a lightweight library like `@dnd-kit`):

- **Chats** can be dragged onto folders (assigns chat to folder) or to the "Unfiled" area (removes from folder)
- **Folders** can be dragged onto other folders (nesting) or reordered among siblings
- Visual feedback: highlight border on valid drop targets, blocked cursor on invalid targets
- **Invalid drops** (would exceed 5-level depth limit): show blocked cursor, no action
- Drop on self: no-op

### Folder Management Actions

- **Create:** "New Folder" button next to the view toggle. Right-click inside a folder → "New sub-folder"
- **Rename:** Double-click folder name for inline edit, or context menu → Rename
- **Delete:** Context menu → Delete, opens confirmation dialog:
  - "Move contents to parent folder" button
  - "Delete folder and all conversations" button (red/destructive styling)
  - Cancel button
- **Customize:** Context menu → Customize, opens a small popover with:
  - Color palette (8-10 preset colors + optional hex input)
  - Icon picker (curated set of ~20 common icons)
- **Move chat:** Right-click a chat → "Move to folder →" submenu showing folder tree

### Chat List Item Changes

Add a small folder indicator (colored dot or mini folder icon) next to chat title when in "All Chats" view, so users can see at a glance which folder a chat belongs to.

## Key Behaviors

### Depth Limit
- Maximum 5 levels of nesting
- Enforced on backend (create and move operations) and frontend (drag-drop rejection)
- Backend returns `400` with message "Maximum folder depth of 5 exceeded"

### Ordering
- Folders ordered by `position` ASC among siblings, then `name` ASC as tiebreaker
- New folders get `position = max(sibling positions) + 1`
- Drag-reorder updates `position` for affected siblings (gap-based: positions 0, 1, 2...)

### Cycle Prevention
- Backend checks the full ancestry chain of the target parent before allowing a `parent_id` update
- If the target parent is a descendant of the folder being moved, return `400` with "Cannot move a folder into its own descendant"

### Chat Count
- `chat_count` computed at query time via COUNT, not stored
- Counts only direct children (not recursive)

### Delete Behavior
- `move_up`: All direct child chats and sub-folders get `parent_id`/`folder_id` set to the deleted folder's `parent_id`
- `delete_all`: Recursive delete of all descendant folders and their chats
- Both require confirmation dialog on frontend

## Migration

Migration `0022_create_folders_table.py`:
1. Create `folders` table
2. Add `folder_id` column to `chats` table with FK to `folders.id` (SET NULL on delete)
3. Add index on `chats.folder_id`
4. Add unique constraint on `(user_id, parent_id, name)` for folders
