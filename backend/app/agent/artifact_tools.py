"""Artifact editing tools.

Exposed to the LLM only when an active artifact_context exists on a message —
these are *contextual* tools, not user-togglable skills, so they don't live in
the skill registry.

Design notes:
- `edit_artifact_file` uses exact-match string replacement (like Claude Code's
  `Edit` tool). No line numbers (they drift as the model streams). If the
  `old_string` isn't found or isn't unique, the tool returns a descriptive
  error and the model retries — this is by design.
- Every successful edit updates the DB row *and* emits an SSE event so the
  frontend can update the single file in place without reloading.
- Tool calls run inside the same request as the LLM turn, so back-pressure
  via the SSE queue is the natural rate-limit.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact

logger = logging.getLogger(__name__)


ARTIFACT_TOOL_NAMES = frozenset(
    {
        "list_artifact_files",
        "read_artifact_file",
        "edit_artifact_file",
    }
)


ARTIFACT_TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_artifact_files",
            "description": (
                "List the files in the active artifact project. Use this first "
                "when the user asks you to modify the project — it shows you "
                "exactly which files exist without dumping their full contents."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_artifact_file",
            "description": (
                "Read the full contents of one file in the active artifact. "
                "Use this right before editing a file so you know the exact "
                "text to replace. Prefer this over guessing — `edit_artifact_file` "
                "requires the old_string to match byte-for-byte."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path, e.g. '/styles.css' or '/App.js'.",
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_artifact_file",
            "description": (
                "Replace an exact substring of a file with new content. Use this "
                "for targeted edits instead of re-emitting the whole file. "
                "`old_string` MUST appear exactly once in the file — if it's not "
                "unique, include more surrounding context until it is. "
                "To create a new file, pass empty string as old_string and the "
                "full file content as new_string."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path to edit, e.g. '/styles.css'.",
                    },
                    "old_string": {
                        "type": "string",
                        "description": (
                            "Exact text to replace. Must match byte-for-byte "
                            "and appear exactly once. Empty string = create file."
                        ),
                    },
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text. Can be empty to delete a section.",
                    },
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": False,
            },
        },
    },
]


async def _load_artifact(
    db: AsyncSession, artifact_public_id: str, user_id: int, chat_id: int
) -> Optional[Artifact]:
    result = await db.execute(
        select(Artifact).where(
            Artifact.public_id == artifact_public_id,
            Artifact.chat_id == chat_id,
            Artifact.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


def make_artifact_tool_executor(
    db: AsyncSession,
    *,
    artifact_public_id: str,
    chat_id: int,
    user_id: int,
    sse_queue: asyncio.Queue,
) -> Callable[[str, Dict[str, Any]], Awaitable[str]]:
    """Return an async executor that handles the three artifact tools.

    The caller is responsible for gating: only invoke this when
    `tool_name in ARTIFACT_TOOL_NAMES`.

    `sse_queue` receives `artifact_tool_edit` events on successful file edits
    so the frontend can update the active artifact in place.
    """

    edit_counter = {"count": 0}

    async def handler(tool_name: str, args: Dict[str, Any]) -> str:
        try:
            if tool_name == "list_artifact_files":
                return await _list(db, artifact_public_id, user_id, chat_id)
            if tool_name == "read_artifact_file":
                return await _read(db, artifact_public_id, user_id, chat_id, args)
            if tool_name == "edit_artifact_file":
                result = await _edit(
                    db, artifact_public_id, user_id, chat_id, args, sse_queue
                )
                if result.get("ok"):
                    edit_counter["count"] += 1
                return result["content"]
            return f"Unknown artifact tool: {tool_name}"
        except Exception as e:
            logger.exception("artifact tool %s failed", tool_name)
            return f"Artifact tool error: {e}"

    handler.edit_counter = edit_counter  # type: ignore[attr-defined]
    return handler


async def _list(db, art_id, user_id, chat_id) -> str:
    art = await _load_artifact(db, art_id, user_id, chat_id)
    if not art:
        return f"Artifact {art_id} not found."
    files = art.files or {}
    if not files:
        return "(empty project)"
    rows = [
        f"- {path} ({_line_count(code)} lines, {len(code)} chars)"
        for path, code in sorted(files.items())
    ]
    return "Files in the active artifact:\n" + "\n".join(rows)


def _line_count(code: str) -> int:
    if not code:
        return 0
    return code.count("\n") + (0 if code.endswith("\n") else 1)


async def _read(db, art_id, user_id, chat_id, args) -> str:
    path = args.get("path", "")
    if not path:
        return "read_artifact_file requires a 'path' argument."
    art = await _load_artifact(db, art_id, user_id, chat_id)
    if not art:
        return f"Artifact {art_id} not found."
    files = art.files or {}
    if path not in files:
        available = ", ".join(sorted(files.keys())) or "(none)"
        return f"File {path!r} not found in artifact. Available paths: {available}"
    return files[path]


async def _edit(db, art_id, user_id, chat_id, args, sse_queue) -> Dict[str, Any]:
    path = args.get("path", "")
    old_string = args.get("old_string", "")
    new_string = args.get("new_string", "")
    if not path:
        return {
            "ok": False,
            "content": "edit_artifact_file requires a 'path' argument.",
        }

    art = await _load_artifact(db, art_id, user_id, chat_id)
    if not art:
        return {"ok": False, "content": f"Artifact {art_id} not found."}

    files = dict(art.files or {})

    # Empty old_string = create new file (or overwrite empty)
    if old_string == "":
        if path in files and files[path]:
            return {
                "ok": False,
                "content": (
                    f"File {path!r} already exists and is non-empty. "
                    "To modify, pass a non-empty `old_string` that matches its content."
                ),
            }
        files[path] = new_string
    else:
        if path not in files:
            return {
                "ok": False,
                "content": (
                    f"File {path!r} not found. To create it, pass an empty string "
                    "as old_string and the full content as new_string."
                ),
            }
        original = files[path]
        occurrences = original.count(old_string)
        if occurrences == 0:
            return {
                "ok": False,
                "content": (
                    f"`old_string` not found in {path!r}. "
                    "Use read_artifact_file to see the current contents and copy "
                    "the exact text you want to replace."
                ),
            }
        if occurrences > 1:
            return {
                "ok": False,
                "content": (
                    f"`old_string` appears {occurrences} times in {path!r}. "
                    "Add more surrounding context to make the match unique."
                ),
            }
        files[path] = original.replace(old_string, new_string, 1)

    art.files = files
    await db.commit()
    await db.refresh(art)

    # Stream the single-file update to the frontend.
    await sse_queue.put(
        {
            "event": "artifact_tool_edit",
            "data": json.dumps(
                {
                    "artifact_id": art.public_id,
                    "path": path,
                    "code": files[path],
                }
            ),
        }
    )

    changed_bytes = abs(len(new_string) - len(old_string))
    return {
        "ok": True,
        "content": (
            f"Edited {path}. {changed_bytes} bytes changed. "
            f"File now has {_line_count(files[path])} lines."
        ),
    }
