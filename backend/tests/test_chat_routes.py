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
