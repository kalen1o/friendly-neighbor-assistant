import pytest

from app.models.chat import Chat, Message


@pytest.fixture
async def chats_with_messages(client, db_engine):
    """Create chats with messages for search testing."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from sqlalchemy import select

    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Create two chats
    chat1 = await client.post("/api/chats", json={"title": "Python Help"})
    chat2 = await client.post("/api/chats", json={"title": "Recipe Ideas"})

    async with session_factory() as session:
        c1 = (
            await session.execute(
                select(Chat).where(Chat.public_id == chat1.json()["id"])
            )
        ).scalar_one()
        c2 = (
            await session.execute(
                select(Chat).where(Chat.public_id == chat2.json()["id"])
            )
        ).scalar_one()

        # Add messages
        session.add(
            Message(
                chat_id=c1.id, role="user", content="How do I use decorators in Python?"
            )
        )
        session.add(
            Message(
                chat_id=c1.id,
                role="assistant",
                content="Decorators are functions that modify other functions.",
            )
        )
        session.add(
            Message(chat_id=c2.id, role="user", content="Give me a pasta recipe")
        )
        session.add(
            Message(
                chat_id=c2.id,
                role="assistant",
                content="Here is a simple spaghetti carbonara recipe.",
            )
        )
        await session.commit()


@pytest.mark.anyio
async def test_search_finds_matching_messages(client, chats_with_messages):
    response = await client.get("/api/chats/search", params={"q": "decorators"})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert any("decorator" in r["content"].lower() for r in data["results"])


@pytest.mark.anyio
async def test_search_no_results(client, chats_with_messages):
    response = await client.get("/api/chats/search", params={"q": "xyznonexistent"})
    assert response.status_code == 200
    assert response.json()["total"] == 0
    assert response.json()["results"] == []


@pytest.mark.anyio
async def test_search_across_chats(client, chats_with_messages):
    response = await client.get("/api/chats/search", params={"q": "recipe"})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert any("recipe" in r["content"].lower() for r in data["results"])


@pytest.mark.anyio
async def test_search_requires_auth(anon_client):
    response = await anon_client.get("/api/chats/search", params={"q": "test"})
    assert response.status_code == 401


@pytest.mark.anyio
async def test_search_requires_query(client):
    response = await client.get("/api/chats/search")
    assert response.status_code == 422
