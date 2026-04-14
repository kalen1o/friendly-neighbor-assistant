import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.jwt import (
    clear_auth_cookies,
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    set_auth_cookies,
)
from app.auth.oauth import (
    get_google_user,
    get_github_user,
    build_google_authorize_url,
    build_github_authorize_url,
)
from app.auth.password import hash_password, verify_password
from app.auth.admin import get_client_ip, log_audit
from app.auth.rate_limit import rate_limit_login, rate_limit_register
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import LoginRequest, ProvidersResponse, RegisterRequest, TokenResponse, UserOut, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _create_tokens_and_set_cookies(
    user: User,
    response: Response,
    db: AsyncSession,
    settings: Settings,
) -> TokenResponse:
    """Create access + refresh tokens, store refresh in DB, set cookies."""
    access_token = create_access_token(user.public_id, settings)
    raw_refresh = generate_refresh_token()

    # Store hashed refresh token in DB
    refresh_record = RefreshToken(
        token_hash=hash_refresh_token(raw_refresh),
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(days=settings.jwt_refresh_expire_days),
    )
    db.add(refresh_record)
    await db.commit()

    set_auth_cookies(response, access_token, raw_refresh, settings)
    return TokenResponse(access_token=access_token)


@router.post("/register", status_code=201, response_model=TokenResponse)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _rate_limit: None = Depends(rate_limit_register),
):
    # Check if email exists
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    # Validate password
    pwd = body.password
    if len(pwd) < 8:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )
    if not re.search(r"[a-z]", pwd):
        raise HTTPException(
            status_code=400, detail="Password must contain a lowercase letter"
        )
    if not re.search(r"[A-Z]", pwd):
        raise HTTPException(
            status_code=400, detail="Password must contain an uppercase letter"
        )
    if not re.search(r"[0-9]", pwd):
        raise HTTPException(status_code=400, detail="Password must contain a number")

    # Create user
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.name,
    )
    # Check if email should get admin role
    admin_list = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    if body.email.lower() in admin_list:
        user.role = "admin"

    db.add(user)
    await db.commit()
    await db.refresh(user)

    await log_audit(
        db, "register",
        user_id=user.id,
        resource_type="user",
        resource_id=user.public_id,
        ip_address=get_client_ip(request),
    )

    return await _create_tokens_and_set_cookies(user, response, db, settings)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _rate_limit: None = Depends(rate_limit_login),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # Auto-promote to admin if email is in ADMIN_EMAILS
    admin_list = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    if user.email.lower() in admin_list and user.role != "admin":
        user.role = "admin"
        await db.commit()

    await log_audit(
        db, "login",
        user_id=user.id,
        resource_type="user",
        resource_id=user.public_id,
        ip_address=get_client_ip(request),
    )

    return await _create_tokens_and_set_cookies(user, response, db, settings)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_token: str = Cookie(None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Use the refresh token cookie to get a new access token."""
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
        )

    token_hash = hash_refresh_token(refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    if record.expires_at < datetime.utcnow():
        # Expired — revoke and reject
        record.revoked = True
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )

    # Load user
    user_result = await db.execute(
        select(User).where(User.id == record.user_id, User.is_active == True)  # noqa: E712
    )
    user = user_result.scalar_one_or_none()
    if not user:
        record.revoked = True
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Rotate: revoke old refresh token, issue new pair
    record.revoked = True
    await db.commit()

    return await _create_tokens_and_set_cookies(user, response, db, settings)


@router.post("/logout")
async def logout(
    response: Response,
    refresh_token: str = Cookie(None),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Revoke refresh token and clear cookies."""
    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        record = result.scalar_one_or_none()
        if record:
            record.revoked = True
            await db.commit()

    clear_auth_cookies(response, settings)
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.memory_enabled is not None:
        user.memory_enabled = body.memory_enabled
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/me", status_code=204)
async def delete_account(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Delete the current user's account and all associated data."""
    from sqlalchemy import delete as sql_delete
    from app.models.chat import Chat, Message
    from app.models.document import Document
    from app.models.artifact import Artifact
    from app.models.chat_file import ChatFile
    from app.models.shared_chat import SharedChat
    from app.models.skill import Skill
    from app.models.hook import Hook

    user_id = user.id

    # Delete user-owned data (order matters for FK constraints)
    # Chat-related: shared_chats -> artifacts -> chat_files -> messages -> chats
    chat_ids_result = await db.execute(select(Chat.id).where(Chat.user_id == user_id))
    chat_ids = [r[0] for r in chat_ids_result.fetchall()]

    if chat_ids:
        await db.execute(sql_delete(SharedChat).where(SharedChat.chat_id.in_(chat_ids)))
        await db.execute(sql_delete(Artifact).where(Artifact.chat_id.in_(chat_ids)))
        await db.execute(sql_delete(ChatFile).where(ChatFile.chat_id.in_(chat_ids)))
        await db.execute(sql_delete(Message).where(Message.chat_id.in_(chat_ids)))
        await db.execute(sql_delete(Chat).where(Chat.user_id == user_id))

    # Documents (chunks cascade via FK)
    await db.execute(sql_delete(Document).where(Document.user_id == user_id))

    # User config: skills, hooks, MCP servers
    await db.execute(sql_delete(Skill).where(Skill.user_id == user_id))
    await db.execute(sql_delete(Hook).where(Hook.user_id == user_id))

    try:
        from app.models.mcp_server import MCPServer
        await db.execute(sql_delete(MCPServer).where(MCPServer.user_id == user_id))
    except Exception:
        pass

    # User record itself (refresh_tokens, user_quotas, user_models, folders cascade via FK)
    await db.execute(sql_delete(User).where(User.id == user_id))
    await db.commit()

    # Clear auth cookies
    clear_auth_cookies(response, settings)


@router.get("/usage")
async def get_my_usage(user: User = Depends(get_current_user)):
    from app.usage import get_usage

    return await get_usage(user.id)


# ---------------------------------------------------------------------------
# OAuth / SSO
# ---------------------------------------------------------------------------


async def _oauth_create_or_link(
    db: AsyncSession,
    user_info: dict,
    settings: Settings,
) -> User:
    """Create or link user account from OAuth provider info. Returns the User."""
    email = user_info["email"]
    provider = user_info["provider"]
    oauth_id = user_info["oauth_id"]
    name = user_info["name"]

    # Check existing user by email
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user:
        # Link OAuth if not already set
        if not user.oauth_provider:
            user.oauth_provider = provider
            user.oauth_id = oauth_id
    else:
        # Create new user (no password — OAuth only)
        user = User(
            email=email,
            name=name,
            password_hash="",
            oauth_provider=provider,
            oauth_id=oauth_id,
        )
        db.add(user)

    # Admin auto-promotion
    admin_list = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    if email.lower() in admin_list:
        user.role = "admin"

    await db.commit()
    await db.refresh(user)
    return user


async def _oauth_login_redirect(
    user_info: dict,
    db: AsyncSession,
    settings: Settings,
) -> RedirectResponse:
    """Create/link user, set JWT cookies, redirect to frontend."""
    user = await _oauth_create_or_link(db, user_info, settings)

    # Create JWT tokens
    access_token = create_access_token(user.public_id, settings)
    raw_refresh = generate_refresh_token()

    # Save hashed refresh token
    rt = RefreshToken(
        token_hash=hash_refresh_token(raw_refresh),
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(days=settings.jwt_refresh_expire_days),
    )
    db.add(rt)
    await db.commit()

    # Redirect to frontend with cookies set
    response = RedirectResponse(url=settings.frontend_url, status_code=302)
    set_auth_cookies(response, access_token, raw_refresh, settings)
    # Clear the OAuth state cookie
    response.delete_cookie("oauth_state")
    return response


@router.get("/providers", response_model=ProvidersResponse)
async def get_providers(settings: Settings = Depends(get_settings)):
    """Return which OAuth providers are configured."""
    return ProvidersResponse(
        google=bool(settings.google_client_id and settings.google_client_secret),
        github=bool(settings.github_client_id and settings.github_client_secret),
    )


@router.get("/google")
async def google_login(request: Request, settings: Settings = Depends(get_settings)):
    """Redirect to Google consent screen."""
    if not settings.google_client_id:
        raise HTTPException(status_code=404, detail="Google OAuth not configured")
    state = secrets.token_urlsafe(32)
    redirect_uri = str(request.base_url) + "api/auth/google/callback"
    url = build_google_authorize_url(redirect_uri, settings, state)
    response = RedirectResponse(url)
    response.set_cookie("oauth_state", state, max_age=300, httponly=True, samesite="lax")
    return response


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Handle Google OAuth callback."""
    saved_state = request.cookies.get("oauth_state")
    if not saved_state or saved_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    redirect_uri = str(request.base_url) + "api/auth/google/callback"
    user_info = await get_google_user(code, redirect_uri, settings)
    return await _oauth_login_redirect(user_info, db, settings)


@router.get("/github")
async def github_login(request: Request, settings: Settings = Depends(get_settings)):
    """Redirect to GitHub consent screen."""
    if not settings.github_client_id:
        raise HTTPException(status_code=404, detail="GitHub OAuth not configured")
    state = secrets.token_urlsafe(32)
    redirect_uri = str(request.base_url) + "api/auth/github/callback"
    url = build_github_authorize_url(redirect_uri, settings, state)
    response = RedirectResponse(url)
    response.set_cookie("oauth_state", state, max_age=300, httponly=True, samesite="lax")
    return response


@router.get("/github/callback")
async def github_callback(
    request: Request,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Handle GitHub OAuth callback."""
    saved_state = request.cookies.get("oauth_state")
    if not saved_state or saved_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    redirect_uri = str(request.base_url) + "api/auth/github/callback"
    user_info = await get_github_user(code, redirect_uri, settings)
    return await _oauth_login_redirect(user_info, db, settings)
