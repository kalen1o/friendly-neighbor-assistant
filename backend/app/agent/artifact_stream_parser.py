"""Incremental artifact parser for SSE streaming.

Feeds on token chunks as they arrive from the LLM and yields events:
  - artifact_start: {id?, title, template} — opening tag detected
  - artifact_file:  {path, code}      — one file's JSON value fully received
  - artifact_end:   {id?, files, dependencies, deleted_files?} — closing tag detected
"""

import json
import re
from typing import List

_OPEN_TAG = re.compile(r"<artifact(?P<attrs>\s+[^>]*)>")
_ATTR_PATTERN = re.compile(r'(\w+)="([^"]*)"')
_CLOSE_TAG = re.compile(r"</artifact>")


def _parse_attrs(attrs_str: str) -> dict:
    return {m.group(1): m.group(2) for m in _ATTR_PATTERN.finditer(attrs_str)}


class ArtifactStreamParser:
    def __init__(self):
        self._buffer = ""
        self._inside = False
        self._tag_meta: dict = {}
        self._content_start = 0
        self._files_emitted: dict = {}

    def feed(self, chunk: str) -> List[dict]:
        self._buffer += chunk
        events: List[dict] = []

        while True:
            if not self._inside:
                m = _OPEN_TAG.search(self._buffer)
                if not m:
                    break
                self._inside = True
                attrs = _parse_attrs(m.group("attrs"))
                self._tag_meta = {
                    "title": attrs.get("title", "Untitled"),
                    "template": attrs.get("template") or "react",
                }
                if attrs.get("id"):
                    self._tag_meta["id"] = attrs["id"]
                self._files_emitted = {}
                events.append(
                    {
                        "event": "artifact_start",
                        "data": {**self._tag_meta},
                    }
                )
                self._buffer = self._buffer[m.end() :]
                continue

            close = _CLOSE_TAG.search(self._buffer)
            if close:
                content = self._buffer[: close.start()].strip()
                self._inside = False

                deleted_files: list = []
                try:
                    manifest = json.loads(content)
                    all_files = manifest.get("files", {})
                    deps = manifest.get("dependencies", {})
                    raw_deleted = manifest.get("deleted_files")
                    if isinstance(raw_deleted, list):
                        deleted_files = [p for p in raw_deleted if isinstance(p, str)]
                except (json.JSONDecodeError, ValueError):
                    all_files = self._files_emitted
                    deps = {}

                for path, code in all_files.items():
                    if path not in self._files_emitted:
                        self._files_emitted[path] = code
                        events.append(
                            {
                                "event": "artifact_file",
                                "data": {"path": path, "code": code},
                            }
                        )

                end_data = {
                    "files": all_files,
                    "dependencies": deps,
                }
                if self._tag_meta.get("id"):
                    end_data["id"] = self._tag_meta["id"]
                if deleted_files:
                    end_data["deleted_files"] = deleted_files

                events.append(
                    {
                        "event": "artifact_end",
                        "data": end_data,
                    }
                )

                self._buffer = self._buffer[close.end() :]
                continue

            events.extend(self._try_extract_files())
            break

        return events

    def _try_extract_files(self) -> List[dict]:
        events = []
        pattern = re.compile(r'"(/[^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}\]]')
        for m in pattern.finditer(self._buffer):
            path = m.group(1)
            if path not in self._files_emitted:
                try:
                    code = json.loads('"' + m.group(2) + '"')
                except (json.JSONDecodeError, ValueError):
                    code = m.group(2)
                self._files_emitted[path] = code
                events.append(
                    {
                        "event": "artifact_file",
                        "data": {"path": path, "code": code},
                    }
                )
        return events
