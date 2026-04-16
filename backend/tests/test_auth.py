import pytest


# ── Register ──


@pytest.mark.anyio
async def test_register(anon_client):
    response = await anon_client.post(
        "/api/auth/register",
        json={"email": "new@example.com", "password": "Test1234", "name": "New User"},
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    # Should set httpOnly cookies
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


@pytest.mark.anyio
async def test_register_duplicate_email(anon_client):
    body = {"email": "dup@example.com", "password": "Test1234", "name": "User"}
    await anon_client.post("/api/auth/register", json=body)
    response = await anon_client.post("/api/auth/register", json=body)
    assert response.status_code == 409


@pytest.mark.anyio
async def test_register_weak_password(anon_client):
    response = await anon_client.post(
        "/api/auth/register",
        json={"email": "weak@example.com", "password": "short", "name": "User"},
    )
    assert response.status_code == 400


# ── Login ──


@pytest.mark.anyio
async def test_login(anon_client):
    # Register first
    await anon_client.post(
        "/api/auth/register",
        json={"email": "login@example.com", "password": "Test1234", "name": "User"},
    )
    # Login
    response = await anon_client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "Test1234"},
    )
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert "access_token" in response.cookies


@pytest.mark.anyio
async def test_login_wrong_password(anon_client):
    await anon_client.post(
        "/api/auth/register",
        json={"email": "wrong@example.com", "password": "Test1234", "name": "User"},
    )
    response = await anon_client.post(
        "/api/auth/login",
        json={"email": "wrong@example.com", "password": "WrongPass1"},
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_login_nonexistent_user(anon_client):
    response = await anon_client.post(
        "/api/auth/login",
        json={"email": "ghost@example.com", "password": "Test1234"},
    )
    assert response.status_code == 401


# ── Me ──


@pytest.mark.anyio
async def test_get_me(client):
    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@example.com"
    assert data["name"] == "Test User"
    assert "id" in data


@pytest.mark.anyio
async def test_get_me_unauthenticated(anon_client):
    response = await anon_client.get("/api/auth/me")
    assert response.status_code == 401


# ── Refresh ──


@pytest.mark.anyio
async def test_refresh_token(anon_client):
    # Register to get cookies
    reg = await anon_client.post(
        "/api/auth/register",
        json={"email": "refresh@example.com", "password": "Test1234", "name": "User"},
    )
    assert reg.status_code == 201

    # Use refresh endpoint — anon_client auto-sends cookies from previous response
    response = await anon_client.post("/api/auth/refresh")
    assert response.status_code == 200
    assert "access_token" in response.json()


@pytest.mark.anyio
async def test_refresh_without_cookie(anon_client):
    response = await anon_client.post("/api/auth/refresh")
    assert response.status_code == 401


# ── Logout ──


@pytest.mark.anyio
async def test_logout(anon_client):
    # Register
    await anon_client.post(
        "/api/auth/register",
        json={"email": "logout@example.com", "password": "Test1234", "name": "User"},
    )
    # Logout
    response = await anon_client.post("/api/auth/logout")
    assert response.status_code == 200

    # After logout, /me should fail
    response = await anon_client.get("/api/auth/me")
    assert response.status_code == 401


# ── Error format ──


@pytest.mark.anyio
async def test_error_response_format(anon_client):
    """All errors should return {error: {code, message, request_id}}."""
    response = await anon_client.get("/api/auth/me")
    assert response.status_code == 401
    data = response.json()
    assert "error" in data
    assert "code" in data["error"]
    assert "message" in data["error"]
    assert "request_id" in data["error"]
    assert data["error"]["code"] == "unauthorized"


@pytest.mark.anyio
async def test_404_error_format(client):
    response = await client.get("/api/chats/nonexistent-id")
    assert response.status_code == 404
    data = response.json()
    assert data["error"]["code"] == "not_found"


@pytest.mark.anyio
async def test_auth_providers(anon_client):
    response = await anon_client.get("/api/auth/providers")
    assert response.status_code == 200
    data = response.json()
    assert data["google"] is False
    assert data["github"] is False


@pytest.mark.anyio
async def test_oauth_creates_new_user(client, db):
    """OAuth login with new email creates a new user."""
    from app.routers.auth import _oauth_create_or_link
    from app.config import Settings

    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test",
        redis_url="redis://localhost:6379/0",
    )

    user = await _oauth_create_or_link(
        db,
        {
            "email": "oauth@example.com",
            "name": "OAuth User",
            "oauth_id": "google-123",
            "provider": "google",
        },
        settings,
    )

    assert user.email == "oauth@example.com"
    assert user.name == "OAuth User"
    assert user.oauth_provider == "google"
    assert user.oauth_id == "google-123"
    assert user.password_hash == ""


@pytest.mark.anyio
async def test_oauth_links_existing_user(client, db):
    """OAuth login with existing email links to existing account."""
    from app.routers.auth import _oauth_create_or_link
    from app.config import Settings

    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        jwt_secret="test",
        redis_url="redis://localhost:6379/0",
    )

    # The test fixture already created test@example.com
    user = await _oauth_create_or_link(
        db,
        {
            "email": "test@example.com",
            "name": "Test User",
            "oauth_id": "github-456",
            "provider": "github",
        },
        settings,
    )

    assert user.email == "test@example.com"
    assert user.oauth_provider == "github"
    assert user.oauth_id == "github-456"
    assert user.password_hash != ""
