"""Build a personalization preamble from user-configured settings."""

from app.models.user import User


_TONE_DESCRIPTIONS = {
    "casual": "casual and conversational",
    "formal": "formal and professional",
    "friendly": "warm and friendly",
    "technical": "precise and technical",
    "concise": "direct and to the point",
}

_LENGTH_DESCRIPTIONS = {
    "short": "Keep responses short — a few sentences unless the task demands more.",
    "medium": "Use a moderate response length — thorough but not verbose.",
    "long": "Give detailed, thorough responses when the topic warrants it.",
}


def build_personalization_prompt(user: User) -> str:
    """Return a prompt block describing the user's preferences, or '' if none set."""
    lines: list[str] = []

    if user.personalization_nickname:
        lines.append(f"- Call the user {user.personalization_nickname}.")
    if user.personalization_role:
        lines.append(f"- User's role/occupation: {user.personalization_role}.")
    if user.personalization_language:
        lines.append(
            f"- Reply in {user.personalization_language} unless the user writes in another language."
        )

    tone = (user.personalization_tone or "").lower()
    if tone in _TONE_DESCRIPTIONS:
        lines.append(f"- Use a {_TONE_DESCRIPTIONS[tone]} tone.")

    length = (user.personalization_length or "").lower()
    if length in _LENGTH_DESCRIPTIONS:
        lines.append(f"- {_LENGTH_DESCRIPTIONS[length]}")

    if user.personalization_about:
        lines.append("")
        lines.append("What the user wants you to know about them:")
        lines.append(user.personalization_about.strip())

    if user.personalization_style:
        lines.append("")
        lines.append("How the user wants you to respond:")
        lines.append(user.personalization_style.strip())

    if not lines:
        return ""

    body = "\n".join(lines)
    return f"\n\nUser preferences for this conversation:\n{body}"
