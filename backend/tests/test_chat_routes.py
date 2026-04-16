import pytest


@pytest.mark.anyio
async def test_create_chat(client):
    response = await client.post("/api/chats", json={"title": "My Chat"})
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "My Chat"
    assert data["id"] is not None
    assert data["messages"] == []


@pytest.mark.anyio
async def test_create_chat_no_title(client):
    response = await client.post("/api/chats", json={})
    assert response.status_code == 201
    data = response.json()
    assert data["title"] is None


@pytest.mark.anyio
async def test_list_chats(client):
    await client.post("/api/chats", json={"title": "Chat A"})
    await client.post("/api/chats", json={"title": "Chat B"})

    response = await client.get("/api/chats")
    assert response.status_code == 200
    data = response.json()
    chats = data.get("chats", data) if isinstance(data, dict) else data
    assert len(chats) == 2
    titles = {c["title"] for c in chats}
    assert titles == {"Chat A", "Chat B"}


@pytest.mark.anyio
async def test_get_chat(client):
    create_resp = await client.post("/api/chats", json={"title": "Detail"})
    chat_id = create_resp.json()["id"]

    response = await client.get(f"/api/chats/{chat_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Detail"
    assert data["messages"] == []


@pytest.mark.anyio
async def test_get_chat_not_found(client):
    response = await client.get("/api/chats/9999")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_update_chat(client):
    create_resp = await client.post("/api/chats", json={"title": "Old"})
    chat_id = create_resp.json()["id"]

    response = await client.patch(f"/api/chats/{chat_id}", json={"title": "New"})
    assert response.status_code == 200
    assert response.json()["title"] == "New"


@pytest.mark.anyio
async def test_update_chat_not_found(client):
    response = await client.patch("/api/chats/9999", json={"title": "X"})
    assert response.status_code == 404


@pytest.mark.anyio
async def test_delete_chat(client):
    create_resp = await client.post("/api/chats", json={"title": "Delete Me"})
    chat_id = create_resp.json()["id"]

    response = await client.delete(f"/api/chats/{chat_id}")
    assert response.status_code == 204

    response = await client.get(f"/api/chats/{chat_id}")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_delete_chat_not_found(client):
    response = await client.delete("/api/chats/9999")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_list_chats_is_generating_false_by_default(client):
    await client.post("/api/chats", json={"title": "Test"})
    response = await client.get("/api/chats")
    assert response.status_code == 200
    chats = response.json()["chats"]
    assert len(chats) == 1
    assert chats[0]["is_generating"] is False


@pytest.mark.anyio
async def test_list_chats_is_generating_true_when_message_generating(client, db):
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Gen Test"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()
    msg = Message(
        chat_id=chat.id, role="assistant", content="partial...", status="generating"
    )
    db.add(msg)
    await db.commit()

    response = await client.get("/api/chats")
    chats = response.json()["chats"]
    gen_chat = next(c for c in chats if c["id"] == chat_id)
    assert gen_chat["is_generating"] is True


@pytest.mark.anyio
async def test_get_chat_message_status(client, db):
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Status Test"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()

    msg_completed = Message(
        chat_id=chat.id, role="assistant", content="done", status="completed"
    )
    msg_generating = Message(
        chat_id=chat.id, role="assistant", content="in progress...", status="generating"
    )
    db.add_all([msg_completed, msg_generating])
    await db.commit()

    response = await client.get(f"/api/chats/{chat_id}")
    assert response.status_code == 200
    messages = response.json()["messages"]
    assert messages[0]["status"] == "completed"
    assert messages[1]["status"] == "generating"


@pytest.mark.anyio
async def test_message_status_default_completed(client, db):
    """New user messages should default to 'completed' status."""
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Status Default"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()
    msg = Message(chat_id=chat.id, role="user", content="hello")
    db.add(msg)
    await db.commit()

    response = await client.get(f"/api/chats/{chat_id}")
    messages = response.json()["messages"]
    assert messages[0]["status"] == "completed"


@pytest.mark.anyio
async def test_is_generating_clears_after_completion(client, db):
    """is_generating should be false after message status changes to completed."""
    from app.models.chat import Chat, Message

    create_resp = await client.post("/api/chats", json={"title": "Gen Clear"})
    chat_id = create_resp.json()["id"]

    result = await db.execute(
        __import__("sqlalchemy").select(Chat).where(Chat.public_id == chat_id)
    )
    chat = result.scalar_one()

    # Start with generating
    msg = Message(chat_id=chat.id, role="assistant", content="...", status="generating")
    db.add(msg)
    await db.commit()

    response = await client.get("/api/chats")
    gen_chat = next(c for c in response.json()["chats"] if c["id"] == chat_id)
    assert gen_chat["is_generating"] is True

    # Complete the message
    await db.refresh(msg)
    msg.status = "completed"
    await db.commit()

    response = await client.get("/api/chats")
    gen_chat = next(c for c in response.json()["chats"] if c["id"] == chat_id)
    assert gen_chat["is_generating"] is False
