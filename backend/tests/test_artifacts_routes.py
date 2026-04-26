import pytest

from app.models.artifact import Artifact
from app.models.chat import Chat, Message


@pytest.fixture
async def chat_with_artifact(client, db_engine):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    chat_resp = await client.post("/api/chats", json={"title": "Artifact Chat"})
    chat_data = chat_resp.json()

    async with session_factory() as session:
        result = await session.execute(
            select(Chat).where(Chat.public_id == chat_data["id"])
        )
        chat = result.scalar_one()

        msg = Message(chat_id=chat.id, role="assistant", content="Here is your app")
        session.add(msg)
        await session.flush()

        artifact = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=chat.user_id,
            title="Test App",
            artifact_type="react",
            code="export default function App() { return <h1>Hi</h1>; }",
        )
        session.add(artifact)
        await session.commit()
        await session.refresh(artifact)

        return {
            "chat_id": chat_data["id"],
            "artifact_id": artifact.public_id,
        }


@pytest.mark.anyio
async def test_list_artifacts(client, chat_with_artifact):
    response = await client.get(f"/api/chats/{chat_with_artifact['chat_id']}/artifacts")
    assert response.status_code == 200
    artifacts = response.json()
    assert len(artifacts) == 1
    assert artifacts[0]["title"] == "Test App"
    assert artifacts[0]["artifact_type"] == "react"


@pytest.mark.anyio
async def test_list_artifacts_includes_message_public_id(client, chat_with_artifact):
    """Frontend needs message_public_id to match an artifact against the last
    assistant message — required to decide whether to auto-open the panel."""
    response = await client.get(f"/api/chats/{chat_with_artifact['chat_id']}/artifacts")
    assert response.status_code == 200
    artifacts = response.json()
    assert artifacts[0]["message_public_id"] is not None
    assert artifacts[0]["message_public_id"].startswith("msg-")


@pytest.mark.anyio
async def test_list_artifacts_sorted_newest_first_with_limit(client, db_engine):
    """Listing without limit returns DESC; ?limit=N caps the result."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    chat_resp = await client.post("/api/chats", json={"title": "Multi"})
    chat_id = chat_resp.json()["id"]

    # Seed three artifacts with distinct titles in insertion order.
    async with session_factory() as session:
        result = await session.execute(select(Chat).where(Chat.public_id == chat_id))
        chat = result.scalar_one()
        for title in ("first", "second", "third"):
            msg = Message(chat_id=chat.id, role="assistant", content=title)
            session.add(msg)
            await session.flush()
            session.add(
                Artifact(
                    message_id=msg.id,
                    chat_id=chat.id,
                    user_id=chat.user_id,
                    title=title,
                    artifact_type="project",
                    template="react",
                    files={"/App.js": "x"},
                )
            )
        await session.commit()

    # Default: all, newest first.
    r = await client.get(f"/api/chats/{chat_id}/artifacts")
    assert r.status_code == 200
    titles = [a["title"] for a in r.json()]
    assert titles == ["third", "second", "first"]

    # limit=1: just the latest.
    r = await client.get(f"/api/chats/{chat_id}/artifacts?limit=1")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["title"] == "third"


@pytest.mark.anyio
async def test_get_artifact(client, chat_with_artifact):
    response = await client.get(f"/api/artifacts/{chat_with_artifact['artifact_id']}")
    assert response.status_code == 200
    assert response.json()["title"] == "Test App"


@pytest.mark.anyio
async def test_update_artifact_code(client, chat_with_artifact):
    response = await client.patch(
        f"/api/artifacts/{chat_with_artifact['artifact_id']}",
        json={"code": "export default function App() { return <h1>Updated</h1>; }"},
    )
    assert response.status_code == 200
    assert "Updated" in response.json()["code"]


@pytest.mark.anyio
async def test_get_nonexistent_artifact(client):
    response = await client.get("/api/artifacts/art-nonexist")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_artifacts_require_auth(anon_client):
    response = await anon_client.get("/api/chats/chat-fake/artifacts")
    assert response.status_code == 401


@pytest.fixture
async def chat_with_project_artifact(client, db_engine):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    chat_resp = await client.post("/api/chats", json={"title": "Project Chat"})
    chat_data = chat_resp.json()

    async with session_factory() as session:
        result = await session.execute(
            select(Chat).where(Chat.public_id == chat_data["id"])
        )
        chat = result.scalar_one()

        msg = Message(chat_id=chat.id, role="assistant", content="Here is your project")
        session.add(msg)
        await session.flush()

        artifact = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=chat.user_id,
            title="Test Project",
            artifact_type="project",
            template="react",
            files={"/App.js": "function App() {}", "/utils.js": "export const x = 1;"},
            dependencies={"uuid": "latest"},
        )
        session.add(artifact)
        await session.commit()
        await session.refresh(artifact)

        return {
            "chat_id": chat_data["id"],
            "artifact_id": artifact.public_id,
        }


@pytest.mark.anyio
async def test_get_project_artifact(client, chat_with_project_artifact):
    response = await client.get(
        f"/api/artifacts/{chat_with_project_artifact['artifact_id']}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["artifact_type"] == "project"
    assert data["template"] == "react"
    assert data["files"] == {
        "/App.js": "function App() {}",
        "/utils.js": "export const x = 1;",
    }
    assert data["dependencies"] == {"uuid": "latest"}
    assert data["code"] is None


@pytest.mark.anyio
async def test_update_project_artifact_files(client, chat_with_project_artifact):
    new_files = {"/App.js": "function App() { return <h1>Updated</h1>; }"}
    response = await client.patch(
        f"/api/artifacts/{chat_with_project_artifact['artifact_id']}",
        json={"files": new_files},
    )
    assert response.status_code == 200
    assert response.json()["files"] == new_files


# ───────────── Version diff endpoint ─────────────


@pytest.fixture
async def artifact_with_three_versions(client, db_engine):
    """Seed an artifact with three versions covering the three diff cases:
    modified, added, and removed files."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select
    from app.models.artifact import ArtifactVersion

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    chat_resp = await client.post("/api/chats", json={"title": "Diff Chat"})
    chat_id_public = chat_resp.json()["id"]

    async with session_factory() as session:
        result = await session.execute(
            select(Chat).where(Chat.public_id == chat_id_public)
        )
        chat = result.scalar_one()

        msg = Message(chat_id=chat.id, role="assistant", content="v1")
        session.add(msg)
        await session.flush()

        artifact = Artifact(
            message_id=msg.id,
            chat_id=chat.id,
            user_id=chat.user_id,
            title="Diff Test",
            artifact_type="project",
            template="react",
            files={"/App.js": "line1\nline2\nline3\n"},
        )
        session.add(artifact)
        await session.flush()

        # v1: original
        session.add(
            ArtifactVersion(
                artifact_id=artifact.id,
                version_number=1,
                title="Diff Test",
                files={"/App.js": "line1\nline2\nline3\n"},
            )
        )
        # v2: modify /App.js, add /styles.css
        session.add(
            ArtifactVersion(
                artifact_id=artifact.id,
                version_number=2,
                title="Diff Test",
                files={
                    "/App.js": "line1\nMODIFIED\nline3\n",
                    "/styles.css": "body {}\n",
                },
            )
        )
        # v3: remove /styles.css
        session.add(
            ArtifactVersion(
                artifact_id=artifact.id,
                version_number=3,
                title="Diff Test",
                files={"/App.js": "line1\nMODIFIED\nline3\n"},
            )
        )
        await session.commit()
        return {"artifact_id": artifact.public_id}


@pytest.mark.anyio
async def test_diff_reports_modified_file_as_unified_diff(
    client, artifact_with_three_versions
):
    aid = artifact_with_three_versions["artifact_id"]
    r = await client.get(f"/api/artifacts/{aid}/versions/1/diff/2")
    assert r.status_code == 200
    body = r.json()
    assert body["from_version"] == 1
    assert body["to_version"] == 2

    by_path = {f["path"]: f for f in body["files"]}
    assert "/App.js" in by_path
    assert by_path["/App.js"]["status"] == "modified"
    diff = by_path["/App.js"]["diff"]
    assert "-line2" in diff
    assert "+MODIFIED" in diff
    assert by_path["/App.js"].get("content") is None


@pytest.mark.anyio
async def test_diff_reports_added_file_with_full_content(
    client, artifact_with_three_versions
):
    aid = artifact_with_three_versions["artifact_id"]
    r = await client.get(f"/api/artifacts/{aid}/versions/1/diff/2")
    by_path = {f["path"]: f for f in r.json()["files"]}
    assert by_path["/styles.css"]["status"] == "added"
    assert by_path["/styles.css"]["content"] == "body {}\n"
    assert by_path["/styles.css"].get("diff") is None


@pytest.mark.anyio
async def test_diff_reports_removed_file_with_full_content(
    client, artifact_with_three_versions
):
    aid = artifact_with_three_versions["artifact_id"]
    r = await client.get(f"/api/artifacts/{aid}/versions/2/diff/3")
    by_path = {f["path"]: f for f in r.json()["files"]}
    assert by_path["/styles.css"]["status"] == "removed"
    assert by_path["/styles.css"]["content"] == "body {}\n"


@pytest.mark.anyio
async def test_diff_drops_unchanged_files(client, artifact_with_three_versions):
    """Unchanged files must not appear — otherwise a 100-file project diff
    with one changed file would dump 99 no-op entries."""
    aid = artifact_with_three_versions["artifact_id"]
    r = await client.get(f"/api/artifacts/{aid}/versions/2/diff/3")
    files = r.json()["files"]
    # v2→v3: only /styles.css removed, /App.js unchanged
    assert len(files) == 1
    assert files[0]["path"] == "/styles.css"


@pytest.mark.anyio
async def test_diff_404_on_missing_version(client, artifact_with_three_versions):
    aid = artifact_with_three_versions["artifact_id"]
    r = await client.get(f"/api/artifacts/{aid}/versions/1/diff/999")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_diff_404_on_unknown_artifact(client):
    r = await client.get("/api/artifacts/art-nonexist/versions/1/diff/2")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_diff_requires_auth(anon_client):
    r = await anon_client.get("/api/artifacts/art-x/versions/1/diff/2")
    assert r.status_code == 401
