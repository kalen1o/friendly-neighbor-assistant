"""Validate artifacts before rendering — catch common issues deterministically."""

from typing import List

from app.agent.artifact_parser import _IMPORT_PATTERN


# Required entry files per template
_ENTRY_FILES = {
    "react": ["/App.js"],
    "react-ts": ["/App.tsx"],
    "vanilla": ["/index.html"],
    "nextjs": ["/app/page.tsx", "/app/page.jsx", "/app/page.js"],
    "vite": ["/index.html"],
    "node-server": [
        "/server.js",
        "/server.ts",
        "/index.js",
        "/index.ts",
        "/app.js",
        "/app.ts",
    ],
}


def evaluate_artifact(
    files: dict,
    dependencies: dict,
    template: str,
) -> tuple[dict, dict, list[str]]:
    """Run all validators on an artifact.

    Returns:
        (fixed_files, fixed_deps, warnings)
        - fixed_files/fixed_deps have auto-corrections applied
        - warnings is a list of human-readable warning strings
    """
    files = dict(files)
    deps = dict(dependencies)
    warnings: List[str] = []

    _check_entry_points(files, template, warnings)
    _check_local_imports(files, warnings)
    _check_truncated_files(files, warnings)
    _fix_template_consistency(files, template, deps, warnings)

    return files, deps, warnings


def _check_entry_points(files: dict, template: str, warnings: list[str]) -> None:
    """Warn if required entry files are missing."""
    required = _ENTRY_FILES.get(template)
    if not required:
        return

    # For templates with multiple options (nextjs, node-server), any one is fine
    paths = set(files.keys())
    if not any(r in paths for r in required):
        warnings.append(
            f"Missing entry file for '{template}' template. "
            f"Expected one of: {', '.join(required)}"
        )


def _check_local_imports(files: dict, warnings: list[str]) -> None:
    """Warn if local imports point to files that don't exist."""
    paths = set(files.keys())

    for file_path, code in files.items():
        for m in _IMPORT_PATTERN.finditer(code):
            imported = m.group(1) or m.group(2)
            if not imported or not imported.startswith("."):
                continue

            # Resolve relative import to absolute path
            base_dir = "/".join(file_path.split("/")[:-1]) or ""
            resolved = _resolve_path(base_dir, imported)

            # Check with common extensions
            candidates = [resolved]
            if not any(
                resolved.endswith(ext)
                for ext in (".js", ".jsx", ".ts", ".tsx", ".css", ".json")
            ):
                candidates.extend(
                    [
                        resolved + ext
                        for ext in (
                            ".tsx",
                            ".ts",
                            ".jsx",
                            ".js",
                            "/index.tsx",
                            "/index.ts",
                            "/index.jsx",
                            "/index.js",
                        )
                    ]
                )

            if not any(c in paths for c in candidates):
                warnings.append(
                    f"'{file_path}' imports '{imported}' but no matching file found"
                )


def _resolve_path(base: str, relative: str) -> str:
    """Resolve a relative import path against a base directory."""
    parts = base.split("/") if base else []
    for segment in relative.split("/"):
        if segment == "." or segment == "":
            continue
        elif segment == "..":
            if parts:
                parts.pop()
        else:
            parts.append(segment)
    result = "/".join(parts)
    if not result.startswith("/"):
        result = "/" + result
    return result


def _check_truncated_files(files: dict, warnings: list[str]) -> None:
    """Detect files that appear truncated (unmatched braces, unclosed strings)."""
    for file_path, code in files.items():
        if not code or file_path.endswith((".css", ".json", ".html", ".md")):
            continue

        # Check brace balance
        opens = code.count("{") + code.count("(") + code.count("[")
        closes = code.count("}") + code.count(")") + code.count("]")
        imbalance = opens - closes

        if imbalance >= 3:
            warnings.append(
                f"'{file_path}' may be truncated — {imbalance} unclosed brackets"
            )


def _fix_template_consistency(
    files: dict, template: str, deps: dict, warnings: list[str]
) -> None:
    """Auto-fix template/dependency mismatches."""
    paths = set(files.keys())

    # If template is "react" but files have .tsx, this should have been caught
    # by detect_template already. Just add a warning if it wasn't.
    has_ts = any(p.endswith(".tsx") or p.endswith(".ts") for p in paths)
    if template == "react" and has_ts:
        warnings.append(
            "Template is 'react' but project has TypeScript files — should be 'react-ts'"
        )

    # Ensure react/react-dom in deps for react templates
    if template in ("react", "react-ts", "vite", "nextjs"):
        if "react" not in deps and "/package.json" not in paths:
            deps["react"] = "latest"
        if "react-dom" not in deps and "/package.json" not in paths:
            deps["react-dom"] = "latest"
