from dataclasses import dataclass
from typing import Optional

from app.llm.encryption import decrypt_api_key


@dataclass
class ModelConfig:
    """Everything needed to make an LLM call to a specific model."""
    provider: str
    model_id: str
    api_key: str
    base_url: Optional[str] = None


def resolve_model_config(
    user_model=None,
    settings=None,
    encryption_key: str = "",
) -> Optional[ModelConfig]:
    """Build a ModelConfig from a UserModel (decrypting the key).
    Returns None if no user_model is provided.
    """
    if user_model is None:
        return None

    api_key = decrypt_api_key(user_model.api_key_encrypted, encryption_key)

    return ModelConfig(
        provider=user_model.provider,
        model_id=user_model.model_id,
        api_key=api_key,
        base_url=user_model.base_url,
    )
