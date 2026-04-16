from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import Settings, get_settings
from app.db.session import get_db
from app.llm.encryption import decrypt_api_key, encrypt_api_key
from app.llm.model_config import ModelConfig
from app.models.user import User
from app.models.user_model import UserModel
from app.schemas.user_model import ModelCreate, ModelOut, ModelUpdate, ModelTestResult

router = APIRouter(prefix="/api/models", tags=["models"])


def _require_encryption(settings: Settings) -> str:
    if not settings.encryption_key:
        raise HTTPException(
            status_code=403,
            detail="Encryption not configured. Set ENCRYPTION_KEY to enable custom models.",
        )
    return settings.encryption_key


def _model_to_out(m: UserModel) -> ModelOut:
    return ModelOut(
        id=m.public_id,
        name=m.name,
        provider=m.provider,
        model_id=m.model_id,
        base_url=m.base_url,
        is_default=m.is_default,
        builtin=False,
        created_at=m.created_at,
    )


def _project_defaults(settings: Settings) -> list[ModelOut]:
    """Parse PROJECT_MODELS env var into builtin model entries.

    Format: "provider:model_id[@base_url],..."
    Examples:
      openai:gpt-4o
      openai:gpt-4o-mini
      anthropic:claude-sonnet-4-20250514
      openai:glm-5.1@https://api.z.ai/api/coding/paas/v4

    If no @base_url is given, falls back to OPENAI_BASE_URL for openai/openai_compatible,
    or None for anthropic.

    If PROJECT_MODELS is empty, falls back to a single default from AI_PROVIDER + OPENAI_MODEL.
    """
    if settings.project_models.strip():
        models = []
        for entry in settings.project_models.split(","):
            entry = entry.strip()
            if ":" not in entry:
                continue
            provider, rest = entry.split(":", 1)
            provider = provider.strip()
            rest = rest.strip()
            if not provider or not rest:
                continue

            # Parse optional @base_url
            if "@" in rest:
                model_id, base_url = rest.rsplit("@", 1)
                model_id = model_id.strip()
                base_url = base_url.strip() or None
            else:
                model_id = rest
                # Default base_url: use OPENAI_BASE_URL for openai providers, None for anthropic
                base_url = (
                    (settings.openai_base_url or None)
                    if provider != "anthropic"
                    else None
                )

            slug = f"project-{provider}-{model_id}".replace("/", "-")
            name = model_id.split("/")[-1]
            models.append(
                ModelOut(
                    id=slug,
                    name=name,
                    provider=provider,
                    model_id=model_id,
                    base_url=base_url,
                    is_default=False,
                    builtin=True,
                    created_at=None,
                )
            )
        if models:
            return models

    # Fallback: single default from ai_provider + openai_model
    return [
        ModelOut(
            id="project-default",
            name="Project Default",
            provider=settings.ai_provider,
            model_id=settings.openai_model
            if settings.ai_provider in ("openai", "openai_compatible")
            else "claude-sonnet-4-20250514",
            base_url=settings.openai_base_url or None,
            is_default=False,
            builtin=True,
            created_at=None,
        )
    ]


async def _test_model_connection(config: ModelConfig) -> ModelTestResult:
    """Make a minimal API call to verify the model works."""
    import anthropic
    import openai

    try:
        if config.provider == "anthropic":
            client = anthropic.AsyncAnthropic(api_key=config.api_key)
            await client.messages.create(
                model=config.model_id,
                max_tokens=1,
                messages=[{"role": "user", "content": "Hi"}],
            )
        else:
            kwargs = {"api_key": config.api_key, "timeout": 30.0}
            if config.base_url:
                kwargs["base_url"] = config.base_url
            client = openai.AsyncOpenAI(**kwargs)
            await client.chat.completions.create(
                model=config.model_id,
                max_tokens=1,
                messages=[{"role": "user", "content": "Hi"}],
            )
        return ModelTestResult(success=True, message="Connection successful")
    except Exception as e:
        return ModelTestResult(success=False, message=str(e)[:200])


@router.get("", response_model=List[ModelOut])
async def list_models(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    models = _project_defaults(settings)
    if settings.encryption_key:
        result = await db.execute(
            select(UserModel)
            .where(UserModel.user_id == user.id)
            .order_by(UserModel.created_at)
        )
        for m in result.scalars().all():
            models.append(_model_to_out(m))
    return models


@router.post("", status_code=201, response_model=ModelOut)
async def create_model(
    body: ModelCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    enc_key = _require_encryption(settings)
    if body.provider == "openai_compatible" and not body.base_url:
        raise HTTPException(
            status_code=400,
            detail="base_url is required for openai_compatible provider",
        )

    config = ModelConfig(
        provider=body.provider,
        model_id=body.model_id,
        api_key=body.api_key,
        base_url=body.base_url,
    )
    test_result = await _test_model_connection(config)
    if not test_result.success:
        raise HTTPException(
            status_code=400, detail=f"API key validation failed: {test_result.message}"
        )

    model = UserModel(
        user_id=user.id,
        name=body.name,
        provider=body.provider,
        model_id=body.model_id,
        api_key_encrypted=encrypt_api_key(body.api_key, enc_key),
        base_url=body.base_url,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return _model_to_out(model)


@router.patch("/{model_id}", response_model=ModelOut)
async def update_model(
    model_id: str,
    body: ModelUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    enc_key = _require_encryption(settings)
    result = await db.execute(
        select(UserModel).where(
            UserModel.public_id == model_id, UserModel.user_id == user.id
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    if body.name is not None:
        model.name = body.name
    if body.model_id is not None:
        model.model_id = body.model_id
    if body.base_url is not None:
        model.base_url = body.base_url
    if body.api_key is not None:
        config = ModelConfig(
            provider=model.provider,
            model_id=body.model_id or model.model_id,
            api_key=body.api_key,
            base_url=body.base_url or model.base_url,
        )
        test_result = await _test_model_connection(config)
        if not test_result.success:
            raise HTTPException(
                status_code=400,
                detail=f"API key validation failed: {test_result.message}",
            )
        model.api_key_encrypted = encrypt_api_key(body.api_key, enc_key)

    if body.is_default is True:
        others = await db.execute(
            select(UserModel).where(
                UserModel.user_id == user.id,
                UserModel.id != model.id,
                UserModel.is_default == True,
            )
        )
        for other in others.scalars().all():
            other.is_default = False
        model.is_default = True
    elif body.is_default is False:
        model.is_default = False

    await db.commit()
    await db.refresh(model)
    return _model_to_out(model)


@router.delete("/{model_id}", status_code=204)
async def delete_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _require_encryption(settings)
    result = await db.execute(
        select(UserModel).where(
            UserModel.public_id == model_id, UserModel.user_id == user.id
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    await db.delete(model)
    await db.commit()


@router.post("/{model_id}/test", response_model=ModelTestResult)
async def test_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    enc_key = _require_encryption(settings)
    result = await db.execute(
        select(UserModel).where(
            UserModel.public_id == model_id, UserModel.user_id == user.id
        )
    )
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    api_key = decrypt_api_key(model.api_key_encrypted, enc_key)
    config = ModelConfig(
        provider=model.provider,
        model_id=model.model_id,
        api_key=api_key,
        base_url=model.base_url,
    )
    return await _test_model_connection(config)
