"""Parse <artifact> tags from LLM response text."""

import json
import re
from typing import List, Tuple

_ARTIFACT_PATTERN = re.compile(
    r'<artifact\s+type="(?P<type>[^"]+)"\s+title="(?P<title>[^"]+)"'
    r'(?:\s+template="(?P<template>[^"]+)")?\s*>\s*\n?'
    r"(?P<content>.*?)"
    r"\s*</artifact>",
    re.DOTALL,
)


def parse_artifacts(text: str) -> Tuple[str, List[dict]]:
    """Parse artifact tags from LLM response.

    Returns:
        (cleaned_text, list of artifact dicts)
        Each artifact: {type, title, template, files, dependencies}
        Artifacts with invalid JSON are skipped.
    """
    artifacts = []

    for match in _ARTIFACT_PATTERN.finditer(text):
        title = match.group("title")
        template = match.group("template") or "react"
        content = match.group("content").strip()

        try:
            manifest = json.loads(content)
        except (json.JSONDecodeError, ValueError):
            continue

        artifacts.append(
            {
                "type": "project",
                "title": title,
                "template": template,
                "files": manifest.get("files", {}),
                "dependencies": manifest.get("dependencies", {}),
            }
        )

    cleaned = _ARTIFACT_PATTERN.sub("", text).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned, artifacts
