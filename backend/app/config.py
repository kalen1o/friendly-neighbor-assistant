import logging

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_DEFAULT_JWT_SECRET = "change-me-in-production-use-a-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_provider: str = "anthropic"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o"
    database_url: str
    redis_url: str = "redis://redis:6379/0"
    embedding_model: str = "text-embedding-3-small"
    embedding_api_key: str = ""
    embedding_base_url: str = ""

    # RAG — hybrid search
    rag_hybrid_search_enabled: bool = True
    rag_fulltext_weight: float = 0.4

    # RAG — reranking
    rag_rerank_enabled: bool = False
    cohere_api_key: str = ""

    # RAG — retrieval
    rag_top_k: int = 5
    rag_min_score: float = 0.5
    rag_rerank_top_n: int = 20  # candidates fetched before reranking

    # RAG — chunking
    rag_chunk_size: int = 500
    rag_chunk_overlap: int = 50
    rag_chunk_strategy: str = "semantic"  # "semantic" or "fixed"

    max_tool_rounds: int = 5
    max_output_tokens: int = 16384

    # Auth — JWT
    jwt_secret: str = _DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 15

    # Auth — Refresh tokens
    jwt_refresh_expire_days: int = 7

    # Auth — Cookies
    cookie_secure: bool = False  # Set True in production (requires HTTPS)
    cookie_domain: str = ""  # Leave empty for localhost dev
    environment: str = "development"  # "development" or "production"

    # Context window
    context_max_tokens: int = 8000  # max tokens for chat history sent to LLM
    context_recent_messages: int = 10  # always keep this many recent messages verbatim

    # Vision
    vision_model: str = ""
    vision_api_key: str = ""
    vision_base_url: str = ""

    # Cost tracking (USD per 1M tokens)
    cost_per_million_input: float = 3.0
    cost_per_million_output: float = 15.0

    # File uploads
    upload_dir: str = "uploads"
    max_upload_size_mb: int = 10

    # Logging
    log_level: str = "INFO"

    # Project models — comma-separated, format: provider:model_id
    # e.g. "openai:gpt-4o,openai:gpt-4o-mini,anthropic:claude-sonnet-4-20250514"
    # If empty, a single default is derived from ai_provider + openai_model
    project_models: str = ""

    # Encryption for user API keys
    encryption_key: str = ""  # Fernet key; if empty, custom models disabled

    # Admin — emails that get admin role on registration
    admin_emails: str = ""  # comma-separated

    # OAuth providers (all optional — buttons hidden if not configured)
    google_client_id: str = ""
    google_client_secret: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""

    # Webhooks
    max_webhooks_per_user: int = 10

    # Frontend URL for OAuth redirect after login
    frontend_url: str = "http://localhost:3000"


def get_settings() -> Settings:
    settings = Settings()

    # Fail loudly if JWT secret is the default in production
    if (
        settings.environment == "production"
        and settings.jwt_secret == _DEFAULT_JWT_SECRET
    ):
        raise RuntimeError(
            "JWT_SECRET must be changed from the default value in production. "
            'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"'
        )

    return settings
