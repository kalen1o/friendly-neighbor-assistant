import pytest


@pytest.mark.anyio
async def test_list_skills(client):
    response = await client.get("/api/skills")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Should include builtin skills
    names = {s["name"] for s in data}
    assert "web_search" in names or len(data) > 0


@pytest.mark.anyio
async def test_create_skill(client):
    response = await client.post(
        "/api/skills",
        json={
            "name": "test_skill",
            "description": "A test skill",
            "skill_type": "knowledge",
            "content": "You are a helpful test assistant.",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "test_skill"
    assert data["builtin"] is False
    assert isinstance(data["id"], str)


@pytest.mark.anyio
async def test_create_duplicate_skill(client):
    body = {
        "name": "dup_skill",
        "description": "Dup",
        "skill_type": "knowledge",
        "content": "content",
    }
    await client.post("/api/skills", json=body)
    response = await client.post("/api/skills", json=body)
    assert response.status_code == 409


@pytest.mark.anyio
async def test_update_skill(client):
    create = await client.post(
        "/api/skills",
        json={
            "name": "update_me",
            "description": "Before",
            "skill_type": "knowledge",
            "content": "old",
        },
    )
    skill_id = create.json()["id"]
    response = await client.patch(
        f"/api/skills/{skill_id}", json={"description": "After"}
    )
    assert response.status_code == 200
    assert response.json()["description"] == "After"


@pytest.mark.anyio
async def test_delete_skill(client):
    create = await client.post(
        "/api/skills",
        json={
            "name": "delete_me",
            "description": "Gone",
            "skill_type": "knowledge",
            "content": "bye",
        },
    )
    skill_id = create.json()["id"]
    response = await client.delete(f"/api/skills/{skill_id}")
    assert response.status_code == 204


@pytest.mark.anyio
async def test_delete_nonexistent_skill(client):
    response = await client.delete("/api/skills/skill-nonexist")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_skills_require_auth(anon_client):
    response = await anon_client.get("/api/skills")
    assert response.status_code == 401
