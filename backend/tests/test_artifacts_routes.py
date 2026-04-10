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
