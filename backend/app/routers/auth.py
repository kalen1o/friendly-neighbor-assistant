import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
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
from app.auth.password import hash_password, verify_password
from app.auth.admin import get_client_ip, log_audit
from app.auth.rate_limit import rate_limit_login, rate_limit_register
from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut

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


@router.get("/usage")
async def get_my_usage(user: User = Depends(get_current_user)):
    from app.usage import get_usage

    return await get_usage(user.id)
