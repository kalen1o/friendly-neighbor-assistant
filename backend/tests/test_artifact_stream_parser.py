from app.agent.artifact_stream_parser import ArtifactStreamParser


def test_yields_file_as_completed():
    parser = ArtifactStreamParser()
    chunks = [
        '<artifact type="project" title="App" template="react">\n',
        '{\n  "files": {\n',
        '    "/App.js": "export default function App() { return <h1>Hi</h1>; }"',
        ',\n    "/utils.js": "export const x = 1;"',
        '\n  },\n  "dependencies": {}\n}\n',
        "</artifact>",
    ]
    events = []
    for chunk in chunks:
        events.extend(parser.feed(chunk))

    types = [e["event"] for e in events]
    assert types == ["artifact_start", "artifact_file", "artifact_file", "artifact_end"]
    assert events[0]["data"]["title"] == "App"
    assert events[0]["data"]["template"] == "react"
    assert events[1]["data"]["path"] == "/App.js"
    assert "export default" in events[1]["data"]["code"]
    assert events[2]["data"]["path"] == "/utils.js"
    assert events[3]["data"]["files"] == {
        "/App.js": "export default function App() { return <h1>Hi</h1>; }",
        "/utils.js": "export const x = 1;",
    }
    assert events[3]["data"]["dependencies"] == {}


def test_handles_no_artifact():
    parser = ArtifactStreamParser()
    events = parser.feed("Just some plain text with no artifacts.")
    assert events == []


def test_handles_split_across_many_chunks():
    parser = ArtifactStreamParser()
    full = (
        "Here is your code:\n"
        '<artifact type="project" title="Test" template="react">\n'
        '{"files": {"/App.js": "function App() {}"}, "dependencies": {}}\n'
        "</artifact>\n"
        "Enjoy!"
    )
    events = []
    for char in full:
        events.extend(parser.feed(char))

    types = [e["event"] for e in events]
    assert "artifact_start" in types
    assert "artifact_file" in types
    assert "artifact_end" in types


def test_collects_dependencies():
    parser = ArtifactStreamParser()
    text = (
        '<artifact type="project" title="T" template="react">\n'
        '{"files": {"/App.js": "import {v4} from \'uuid\'; export default function App() {}"}, '
        '"dependencies": {"uuid": "latest"}}\n'
        "</artifact>"
    )
    events = list(parser.feed(text))
    end_event = [e for e in events if e["event"] == "artifact_end"][0]
    assert end_event["data"]["dependencies"] == {"uuid": "latest"}


def test_multiple_artifacts_in_stream():
    parser = ArtifactStreamParser()
    text = (
        '<artifact type="project" title="A" template="react">\n'
        '{"files": {"/App.js": "A"}}\n</artifact>\n'
        "some text\n"
        '<artifact type="project" title="B" template="vanilla">\n'
        '{"files": {"/index.html": "B"}}\n</artifact>'
    )
    events = list(parser.feed(text))
    starts = [e for e in events if e["event"] == "artifact_start"]
    assert len(starts) == 2
    assert starts[0]["data"]["title"] == "A"
    assert starts[1]["data"]["title"] == "B"
