import pytest


@pytest.mark.anyio
async def test_create_public_share(client):
    chat = await client.post("/api/chats", json={"title": "Share Me"})
    chat_id = chat.json()["id"]
    response = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    assert response.status_code == 201
    data = response.json()
    assert data["visibility"] == "public"
    assert data["active"] is True
    assert data["id"].startswith("share-")


@pytest.mark.anyio
async def test_view_public_share(anon_client, client):
    chat = await client.post("/api/chats", json={"title": "Public Chat"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    share_id = share.json()["id"]
    response = await anon_client.get(f"/api/shared/{share_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Public Chat"
    assert isinstance(data["messages"], list)


@pytest.mark.anyio
async def test_view_authenticated_share_requires_auth(anon_client, client):
    chat = await client.post("/api/chats", json={"title": "Auth Chat"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "authenticated"}
    )
    share_id = share.json()["id"]
    response = await anon_client.get(f"/api/shared/{share_id}")
    assert response.status_code == 401
    response = await client.get(f"/api/shared/{share_id}")
    assert response.status_code == 200


@pytest.mark.anyio
async def test_revoke_share(client):
    chat = await client.post("/api/chats", json={"title": "Revoke Me"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    share_id = share.json()["id"]
    response = await client.delete(f"/api/shared/{share_id}")
    assert response.status_code == 204
    response = await client.get(f"/api/shared/{share_id}")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_list_shares(client):
    chat = await client.post("/api/chats", json={"title": "List Shares"})
    chat_id = chat.json()["id"]
    await client.post(f"/api/chats/{chat_id}/share", json={"visibility": "public"})
    await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "authenticated"}
    )
    response = await client.get(f"/api/chats/{chat_id}/shares")
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.anyio
async def test_share_nonexistent_chat(client):
    response = await client.post(
        "/api/chats/chat-nonexist/share", json={"visibility": "public"}
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_snapshot_is_frozen(client, anon_client):
    chat = await client.post("/api/chats", json={"title": "Snapshot"})
    chat_id = chat.json()["id"]
    share = await client.post(
        f"/api/chats/{chat_id}/share", json={"visibility": "public"}
    )
    share_id = share.json()["id"]
    response = await anon_client.get(f"/api/shared/{share_id}")
    assert response.status_code == 200
    assert len(response.json()["messages"]) == 0
