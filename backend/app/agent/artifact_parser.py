"""Parse <artifact> tags from LLM response text."""

import json
import re
from typing import List, Tuple

# Attributes may appear in any order. The content must be followed by </artifact>.
_ARTIFACT_PATTERN = re.compile(
    r"<artifact(?P<attrs>\s+[^>]*)>\s*\n?"
    r"(?P<content>.*?)"
    r"\s*</artifact>",
    re.DOTALL,
)
_ATTR_PATTERN = re.compile(r'(\w+)="([^"]*)"')


def _parse_attrs(attrs_str: str) -> dict:
    return {m.group(1): m.group(2) for m in _ATTR_PATTERN.finditer(attrs_str)}


def parse_artifacts(text: str) -> Tuple[str, List[dict]]:
    """Parse artifact tags from LLM response.

    Returns:
        (cleaned_text, list of artifact dicts)
        Each artifact: {id?, type, title, template, files, dependencies, deleted_files?}
        Artifacts with invalid JSON are skipped.
    """
    artifacts = []

    for match in _ARTIFACT_PATTERN.finditer(text):
        attrs = _parse_attrs(match.group("attrs"))
        title = attrs.get("title", "Untitled")
        template = attrs.get("template") or "react"
        content = match.group("content").strip()

        try:
            manifest = json.loads(content)
        except (json.JSONDecodeError, ValueError):
            continue

        art = {
            "type": "project",
            "title": title,
            "template": template,
            "files": manifest.get("files", {}),
            "dependencies": manifest.get("dependencies", {}),
        }
        if attrs.get("id"):
            art["id"] = attrs["id"]
        deleted = manifest.get("deleted_files")
        if isinstance(deleted, list) and deleted:
            art["deleted_files"] = [p for p in deleted if isinstance(p, str)]
        artifacts.append(art)

    cleaned = _ARTIFACT_PATTERN.sub("", text).strip()
    cleaned = _strip_orphan_closers(cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned, artifacts


_CODE_LINE_STARTS = frozenset("}])\"<\\'/")
_CODE_AFTER_PROSE = re.compile(
    r"(?<=[.!?])\s+(?=(?:key=|className=|<[a-zA-Z/!]|[{}()\[\]]))"
)


def _strip_orphan_closers(text: str) -> str:
    """Remove stray `</artifact>` tags that survived primary parsing.

    Happens when an LLM emits a valid artifact, then keeps generating
    code residue and a duplicate close tag. We walk backward line by line
    from the orphan close, dropping code-like lines, then trim any
    inline code tail that follows a sentence boundary.
    """
    # Bounded loop — defensive against pathological input.
    for _ in range(3):
        if "</artifact>" not in text:
            return text
        idx = text.rfind("</artifact>")
        before, after = text[:idx], text[idx + len("</artifact>"):]

        lines = before.rstrip().split("\n")
        while lines:
            stripped = lines[-1].lstrip()
            if not stripped:
                lines.pop()
                continue
            if stripped[0] in _CODE_LINE_STARTS:
                lines.pop()
                continue
            break

        # The last remaining line may be prose with code tacked on the end
        # (e.g. "Fixed now. key={i} className=...</span>"). Cut at the
        # first code-ish token that follows sentence punctuation.
        if lines:
            m = _CODE_AFTER_PROSE.search(lines[-1])
            if m:
                lines[-1] = lines[-1][: m.start()].rstrip()

        rebuilt = "\n".join(lines).rstrip()
        text = rebuilt + ("\n\n" + after.lstrip() if after.strip() else "")
    return text.strip()


# Packages bundled with Sandpack templates — never flag as missing
_BUILTIN_PACKAGES = frozenset(
    {
        "react",
        "react-dom",
        "react-scripts",
        "react-is",
        "next",
        "vue",
        "svelte",
        "angular",
    }
)

_IMPORT_PATTERN = re.compile(
    r"""(?:import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))"""
)


def detect_dependencies(files: dict, declared: dict) -> dict:
    """Scan files for npm imports not in declared dependencies.

    Returns dict of {package_name: "latest"} for missing packages.
    """
    imported = set()
    for code in files.values():
        for m in _IMPORT_PATTERN.finditer(code):
            pkg = m.group(1) or m.group(2)
            if not pkg or pkg.startswith(".") or pkg.startswith("/"):
                continue
            if pkg.startswith("@"):
                parts = pkg.split("/")
                pkg_name = "/".join(parts[:2]) if len(parts) >= 2 else pkg
            else:
                pkg_name = pkg.split("/")[0]
            imported.add(pkg_name)

    missing = {}
    for pkg in imported:
        if pkg not in declared and pkg not in _BUILTIN_PACKAGES:
            missing[pkg] = "latest"
    return missing


_SERVER_FRAMEWORKS = re.compile(
    r"(?:require\(['\"](?:express|fastify)['\"]|from\s+['\"](?:express|fastify)['\"]|http\.createServer)"
)


def detect_template(files: dict) -> str:
    """Auto-detect template from file contents.

    Priority: nextjs > vite > node-server > react-ts > vanilla > react
    """
    paths = set(files.keys())

    # Next.js: has next.config.* or app directory structure
    has_next_config = any(p.split("/")[-1].startswith("next.config") for p in paths)
    has_app_dir = any(
        p.startswith("/app/page") or p.startswith("/app/layout") for p in paths
    )
    if has_next_config or has_app_dir:
        return "nextjs"

    # Vite: has vite.config.*
    has_vite_config = any(p.split("/")[-1].startswith("vite.config") for p in paths)
    if has_vite_config:
        return "vite"

    # Node server: has server.js/server.ts with express/fastify/http.createServer
    for p in paths:
        filename = p.split("/")[-1]
        if filename in ("server.js", "server.ts"):
            code = files.get(p, "")
            if _SERVER_FRAMEWORKS.search(code):
                return "node-server"

    # Existing Sandpack detection
    has_ts = any(p.endswith(".tsx") or p.endswith(".ts") for p in paths)
    has_html_entry = "/index.html" in paths

    if has_ts:
        return "react-ts"
    if has_html_entry and "/App.js" not in paths:
        return "vanilla"
    return "react"
