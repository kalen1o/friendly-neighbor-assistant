from authlib.integrations.httpx_client import AsyncOAuth2Client
from app.config import Settings


async def get_google_user(code: str, redirect_uri: str, settings: Settings) -> dict:
    """Exchange Google auth code for user info."""
    client = AsyncOAuth2Client(
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
    )
    await client.fetch_token(
        "https://oauth2.googleapis.com/token",
        code=code,
        redirect_uri=redirect_uri,
    )
    resp = await client.get("https://www.googleapis.com/oauth2/v3/userinfo")
    resp.raise_for_status()
    await client.aclose()
    user_info = resp.json()
    return {
        "email": user_info["email"],
        "name": user_info.get("name", user_info["email"].split("@")[0]),
        "oauth_id": user_info["sub"],
        "provider": "google",
    }


async def get_github_user(code: str, redirect_uri: str, settings: Settings) -> dict:
    """Exchange GitHub auth code for user info."""
    client = AsyncOAuth2Client(
        client_id=settings.github_client_id,
        client_secret=settings.github_client_secret,
    )
    await client.fetch_token(
        "https://github.com/login/oauth/access_token",
        code=code,
        redirect_uri=redirect_uri,
    )
    resp = await client.get("https://api.github.com/user")
    resp.raise_for_status()
    profile = resp.json()

    email = profile.get("email")
    if not email:
        emails_resp = await client.get("https://api.github.com/user/emails")
        emails_resp.raise_for_status()
        emails = emails_resp.json()
        primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
        if not primary:
            await client.aclose()
            raise ValueError("No verified email found on GitHub account")
        email = primary["email"]

    await client.aclose()
    return {
        "email": email,
        "name": profile.get("name") or profile.get("login", email.split("@")[0]),
        "oauth_id": str(profile["id"]),
        "provider": "github",
    }


def build_google_authorize_url(redirect_uri: str, settings: Settings, state: str) -> str:
    """Build Google OAuth2 authorization URL."""
    client = AsyncOAuth2Client(
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        redirect_uri=redirect_uri,
        scope="openid email profile",
    )
    url, _ = client.create_authorization_url(
        "https://accounts.google.com/o/oauth2/auth",
        state=state,
    )
    return url


def build_github_authorize_url(redirect_uri: str, settings: Settings, state: str) -> str:
    """Build GitHub OAuth2 authorization URL."""
    client = AsyncOAuth2Client(
        client_id=settings.github_client_id,
        client_secret=settings.github_client_secret,
        redirect_uri=redirect_uri,
        scope="user:email",
    )
    url, _ = client.create_authorization_url(
        "https://github.com/login/oauth/authorize",
        state=state,
    )
    return url
