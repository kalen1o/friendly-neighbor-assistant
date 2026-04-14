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
