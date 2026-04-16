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
