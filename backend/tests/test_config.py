import os

import pytest


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")

    from app.config import Settings

    settings = Settings()
    assert settings.ai_provider == "openai"
    assert settings.anthropic_api_key == "sk-ant-test"
    assert settings.openai_api_key == "sk-test"
    assert settings.database_url == "postgresql+asyncpg://user:pass@localhost/testdb"
    assert settings.embedding_model == "text-embedding-3-small"


def test_settings_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/testdb")
    monkeypatch.delenv("AI_PROVIDER", raising=False)

    from app.config import Settings

    settings = Settings()
    assert settings.ai_provider == "anthropic"
    assert settings.embedding_model == "text-embedding-3-small"
