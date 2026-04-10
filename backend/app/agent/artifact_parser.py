"""Parse <artifact> tags from LLM response text."""

import re
from typing import List, Tuple

_ARTIFACT_PATTERN = re.compile(
    r'<artifact\s+type="(?P<type>[^"]+)"\s+title="(?P<title>[^"]+)">\s*\n?'
    r"(?P<code>.*?)"
    r"\s*</artifact>",
    re.DOTALL,
)


def parse_artifacts(text: str) -> Tuple[str, List[dict]]:
    """Parse artifact tags from LLM response.

    Returns:
        (cleaned_text, list of {type, title, code} dicts)
    """
    artifacts = []

    for match in _ARTIFACT_PATTERN.finditer(text):
        artifacts.append(
            {
                "type": match.group("type"),
                "title": match.group("title"),
                "code": match.group("code").strip(),
            }
        )

    cleaned = _ARTIFACT_PATTERN.sub("", text).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned, artifacts
