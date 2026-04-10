import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Response
from jose import JWTError, jwt

from app.config import Settings


# ── Access tokens ──


def create_access_token(public_id: str, settings: Settings) -> str:
    """Create a short-lived JWT access token using the user's public_id."""
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload = {
        "sub": public_id,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> Optional[str]:
    """Decode JWT and return public_id, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except (JWTError, ValueError):
        return None


# ── Refresh tokens ──


def generate_refresh_token() -> str:
    """Generate a cryptographically random refresh token."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """Hash a refresh token for safe DB storage."""
    return hashlib.sha256(token.encode()).hexdigest()


# ── Cookie helpers ──


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    settings: Settings,
) -> None:
    """Set httpOnly cookies for access and refresh tokens."""
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.jwt_access_expire_minutes * 60,
        path="/",
        domain=settings.cookie_domain or None,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.jwt_refresh_expire_days * 86400,
        path="/api/auth",  # Only sent to auth endpoints
        domain=settings.cookie_domain or None,
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    """Clear auth cookies on logout."""
    for key, path in [("access_token", "/"), ("refresh_token", "/api/auth")]:
        response.delete_cookie(
            key=key,
            path=path,
            domain=settings.cookie_domain or None,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )
