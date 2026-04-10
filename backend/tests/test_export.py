import pytest

from app.models.chat import Chat, Message


@pytest.fixture
async def chat_with_messages(client, db_engine):
    """Create a chat with messages for export testing."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    chat_resp = await client.post("/api/chats", json={"title": "Export Test"})
    chat_data = chat_resp.json()

    async with session_factory() as session:
        result = await session.execute(
            select(Chat).where(Chat.public_id == chat_data["id"])
        )
        chat = result.scalar_one()

        session.add(
            Message(chat_id=chat.id, role="user", content="Hello, how are you?")
        )
        session.add(
            Message(
                chat_id=chat.id,
                role="assistant",
                content="I'm doing great! How can I help you today?",
            )
        )
        session.add(
            Message(chat_id=chat.id, role="user", content="Tell me about Python.")
        )
        session.add(
            Message(
                chat_id=chat.id,
                role="assistant",
                content="Python is a versatile programming language.",
            )
        )
        await session.commit()

    return chat_data["id"]


@pytest.mark.anyio
async def test_export_markdown(client, chat_with_messages):
    chat_id = chat_with_messages
    response = await client.get(
        f"/api/chats/{chat_id}/export", params={"format": "markdown"}
    )
    assert response.status_code == 200
    assert "text/markdown" in response.headers["content-type"]
    content = response.text
    assert "# Export Test" in content
    assert "Hello, how are you?" in content
    assert "Python is a versatile" in content


@pytest.mark.anyio
async def test_export_pdf(client, chat_with_messages):
    chat_id = chat_with_messages
    response = await client.get(
        f"/api/chats/{chat_id}/export", params={"format": "pdf"}
    )
    assert response.status_code == 200
    assert "application/pdf" in response.headers["content-type"]
    # PDF starts with %PDF
    assert response.content[:5] == b"%PDF-"


@pytest.mark.anyio
async def test_export_default_is_markdown(client, chat_with_messages):
    chat_id = chat_with_messages
    response = await client.get(f"/api/chats/{chat_id}/export")
    assert response.status_code == 200
    assert "text/markdown" in response.headers["content-type"]


@pytest.mark.anyio
async def test_export_not_found(client):
    response = await client.get(
        "/api/chats/chat-nonexist/export", params={"format": "markdown"}
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_export_requires_auth(anon_client):
    response = await anon_client.get(
        "/api/chats/chat-fake/export", params={"format": "markdown"}
    )
    assert response.status_code == 401
