import pytest


@pytest.mark.anyio
async def test_list_hooks(client):
    response = await client.get("/api/hooks")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.anyio
async def test_create_hook(client):
    response = await client.post(
        "/api/hooks",
        json={
            "name": "test_hook",
            "description": "A test hook",
            "hook_type": "observability",
            "hook_point": "post_message",
            "priority": 100,
            "content": "Log the message.",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "test_hook"
    assert isinstance(data["id"], str)


@pytest.mark.anyio
async def test_update_hook(client):
    create = await client.post(
        "/api/hooks",
        json={
            "name": "update_hook",
            "description": "Before",
            "hook_type": "observability",
            "hook_point": "post_message",
            "priority": 100,
            "content": "old",
        },
    )
    hook_id = create.json()["id"]
    response = await client.patch(
        f"/api/hooks/{hook_id}", json={"description": "After"}
    )
    assert response.status_code == 200
    assert response.json()["description"] == "After"


@pytest.mark.anyio
async def test_delete_hook(client):
    create = await client.post(
        "/api/hooks",
        json={
            "name": "delete_hook",
            "description": "Gone",
            "hook_type": "observability",
            "hook_point": "pre_message",
            "priority": 100,
            "content": "bye",
        },
    )
    hook_id = create.json()["id"]
    response = await client.delete(f"/api/hooks/{hook_id}")
    assert response.status_code == 204


@pytest.mark.anyio
async def test_hooks_require_auth(anon_client):
    response = await anon_client.get("/api/hooks")
    assert response.status_code == 401
