import json

from app.agent.artifact_parser import parse_artifacts


def test_no_artifacts():
    text = "Here is some plain text response."
    cleaned, artifacts = parse_artifacts(text)
    assert cleaned == text
    assert artifacts == []


def test_single_file_react_project():
    files = {"/App.js": "export default function App() { return <h1>Hello</h1>; }"}
    manifest = json.dumps({"files": files})
    text = (
        "Here is your app:\n\n"
        f'<artifact type="project" title="Hello App" template="react">\n'
        f"{manifest}\n"
        "</artifact>\n\n"
        "Let me know if you want changes."
    )
    cleaned, artifacts = parse_artifacts(text)
    assert "artifact" not in cleaned.lower()
    assert "Let me know" in cleaned
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a["type"] == "project"
    assert a["title"] == "Hello App"
    assert a["template"] == "react"
    assert a["files"] == files
    assert a["dependencies"] == {}


def test_multi_file_react_project_with_deps():
    files = {
        "/App.js": "import TodoList from './TodoList';\nexport default function App() { return <TodoList />; }",
        "/TodoList.js": "export default function TodoList() { return <ul><li>Learn React</li></ul>; }",
    }
    deps = {"uuid": "latest"}
    manifest = json.dumps({"files": files, "dependencies": deps})
    text = (
        f'<artifact type="project" title="Todo App" template="react">\n'
        f"{manifest}\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a["type"] == "project"
    assert a["template"] == "react"
    assert a["files"] == files
    assert a["dependencies"] == deps


def test_vanilla_project():
    files = {"/index.html": "<!DOCTYPE html><html><body>Hi</body></html>"}
    manifest = json.dumps({"files": files})
    text = (
        f'<artifact type="project" title="Static Site" template="vanilla">\n'
        f"{manifest}\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a["template"] == "vanilla"
    assert a["files"] == files
    assert a["dependencies"] == {}


def test_multiple_project_artifacts():
    files1 = {"/App.js": "function App() {}"}
    files2 = {"/index.html": "<div>hi</div>"}
    text = (
        f'<artifact type="project" title="React App" template="react">\n'
        f'{json.dumps({"files": files1})}\n'
        "</artifact>\n"
        "And also:\n"
        f'<artifact type="project" title="HTML Page" template="vanilla">\n'
        f'{json.dumps({"files": files2})}\n'
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 2
    assert artifacts[0]["title"] == "React App"
    assert artifacts[0]["files"] == files1
    assert artifacts[1]["title"] == "HTML Page"
    assert artifacts[1]["files"] == files2


def test_template_defaults_to_react():
    files = {"/App.js": "function App() {}"}
    manifest = json.dumps({"files": files})
    text = (
        f'<artifact type="project" title="No Template">\n'
        f"{manifest}\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    assert artifacts[0]["template"] == "react"


def test_invalid_json_returns_empty():
    text = (
        '<artifact type="project" title="Bad" template="react">\n'
        "this is not json\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert artifacts == []
    assert cleaned.strip() == ""


def test_malformed_no_closing_tag():
    text = '<artifact type="project" title="Broken" template="react">\nsome code\n'
    cleaned, artifacts = parse_artifacts(text)
    assert artifacts == []
    assert "some code" in cleaned


from app.agent.artifact_parser import detect_dependencies


def test_detect_missing_npm_deps():
    files = {
        "/App.js": "import { motion } from 'framer-motion';\nimport axios from 'axios';",
        "/utils.js": "import { v4 } from 'uuid';\nimport React from 'react';",
    }
    declared = {}
    missing = detect_dependencies(files, declared)
    assert "framer-motion" in missing
    assert "axios" in missing
    assert "uuid" in missing
    assert "react" not in missing


def test_detect_skips_relative_imports():
    files = {
        "/App.js": "import Foo from './Foo';\nimport Bar from '../Bar';",
    }
    missing = detect_dependencies(files, {})
    assert missing == {}


def test_detect_skips_already_declared():
    files = {
        "/App.js": "import axios from 'axios';",
    }
    declared = {"axios": "^1.0.0"}
    missing = detect_dependencies(files, declared)
    assert missing == {}


def test_detect_scoped_packages():
    files = {
        "/App.js": "import { Button } from '@radix-ui/react-button';\nimport styled from '@emotion/styled';",
    }
    missing = detect_dependencies(files, {})
    assert "@radix-ui/react-button" in missing
    assert "@emotion/styled" in missing


from app.agent.artifact_parser import detect_template


def test_detect_react_ts_from_tsx_files():
    files = {"/App.tsx": "code", "/utils.ts": "code"}
    assert detect_template(files) == "react-ts"


def test_detect_react_from_js_files():
    files = {"/App.js": "code", "/utils.js": "code"}
    assert detect_template(files) == "react"


def test_detect_vanilla_from_html_entry():
    files = {"/index.html": "<html>", "/script.js": "code"}
    assert detect_template(files) == "vanilla"


def test_detect_mixed_prefers_ts():
    files = {"/App.tsx": "code", "/helpers.js": "code"}
    assert detect_template(files) == "react-ts"


def test_detect_nextjs_from_next_config():
    files = {"/next.config.js": "module.exports = {}", "/app/page.tsx": "export default function Home() {}"}
    assert detect_template(files) == "nextjs"


def test_detect_nextjs_from_app_layout():
    files = {"/app/layout.tsx": "export default function Layout({ children }) {}", "/app/page.tsx": "code"}
    assert detect_template(files) == "nextjs"


def test_detect_node_server_from_express():
    files = {"/server.js": "const express = require('express');\nconst app = express();"}
    assert detect_template(files) == "node-server"


def test_detect_node_server_from_fastify():
    files = {"/server.ts": "import Fastify from 'fastify';\nconst server = Fastify();"}
    assert detect_template(files) == "node-server"


def test_detect_node_server_ignores_next_with_server():
    """If next.config exists alongside server.js, it's a Next.js project, not a plain node server."""
    files = {"/next.config.js": "{}", "/server.js": "const express = require('express');"}
    assert detect_template(files) == "nextjs"


def test_detect_vite_from_config():
    files = {"/vite.config.ts": "export default {}", "/src/main.tsx": "code"}
    assert detect_template(files) == "vite"


def test_detect_simple_react_unchanged():
    """Simple React projects should still return 'react', not a WebContainer template."""
    files = {"/App.js": "export default function App() { return <h1>Hi</h1>; }"}
    assert detect_template(files) == "react"
