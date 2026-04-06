from unittest.mock import AsyncMock, patch

import pytest

from app.config import Settings


def _make_settings(provider: str = "anthropic") -> Settings:
    return Settings(
        ai_provider=provider,
        anthropic_api_key="sk-ant-test",
        openai_api_key="sk-test",
        database_url="postgresql+asyncpg://x:x@localhost/x",
    )


@pytest.mark.anyio
async def test_get_llm_response_anthropic():
    settings = _make_settings("anthropic")
    messages = [{"role": "user", "content": "Hello"}]

    mock_response = AsyncMock()
    mock_response.content = [AsyncMock(text="Hi there!")]

    with patch("app.llm.provider.anthropic.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.create = AsyncMock(return_value=mock_response)

        from app.llm.provider import get_llm_response

        result = await get_llm_response(messages, settings)
        assert result == "Hi there!"
        instance.messages.create.assert_called_once()


@pytest.mark.anyio
async def test_get_llm_response_openai():
    settings = _make_settings("openai")
    messages = [{"role": "user", "content": "Hello"}]

    mock_choice = AsyncMock()
    mock_choice.message.content = "Hi from GPT!"
    mock_response = AsyncMock()
    mock_response.choices = [mock_choice]

    with patch("app.llm.provider.openai.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        from app.llm.provider import get_llm_response

        result = await get_llm_response(messages, settings)
        assert result == "Hi from GPT!"
        instance.chat.completions.create.assert_called_once()


@pytest.mark.anyio
async def test_get_llm_response_invalid_provider():
    settings = _make_settings("gemini")
    messages = [{"role": "user", "content": "Hello"}]

    from app.llm.provider import get_llm_response

    with pytest.raises(ValueError, match="Unsupported AI provider: gemini"):
        await get_llm_response(messages, settings)
