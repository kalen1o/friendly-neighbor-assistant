from app.agent.artifact_parser import parse_artifacts


def test_no_artifacts():
    text = "Here is some plain text response."
    cleaned, artifacts = parse_artifacts(text)
    assert cleaned == text
    assert artifacts == []


def test_single_react_artifact():
    text = (
        "Here is your app:\n\n"
        '<artifact type="react" title="Todo App">\n'
        "export default function App() {\n"
        "  return <h1>Hello</h1>;\n"
        "}\n"
        "</artifact>\n\n"
        "Let me know if you want changes."
    )
    cleaned, artifacts = parse_artifacts(text)
    assert "artifact" not in cleaned.lower()
    assert "Let me know" in cleaned
    assert len(artifacts) == 1
    assert artifacts[0]["type"] == "react"
    assert artifacts[0]["title"] == "Todo App"
    assert "export default" in artifacts[0]["code"]


def test_single_html_artifact():
    text = (
        '<artifact type="html" title="Landing Page">\n'
        "<!DOCTYPE html>\n<html><body>Hi</body></html>\n"
        "</artifact>"
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 1
    assert artifacts[0]["type"] == "html"
    assert artifacts[0]["title"] == "Landing Page"
    assert "<!DOCTYPE html>" in artifacts[0]["code"]


def test_multiple_artifacts():
    text = (
        '<artifact type="react" title="App">\nfunction App() {}\n</artifact>\n'
        "Some text\n"
        '<artifact type="html" title="Page">\n<div>hi</div>\n</artifact>'
    )
    cleaned, artifacts = parse_artifacts(text)
    assert len(artifacts) == 2
    assert artifacts[0]["title"] == "App"
    assert artifacts[1]["title"] == "Page"


def test_malformed_no_closing_tag():
    text = '<artifact type="react" title="Broken">\nsome code\n'
    cleaned, artifacts = parse_artifacts(text)
    assert artifacts == []
    assert "some code" in cleaned
