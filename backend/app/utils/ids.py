import uuid


def generate_public_id(prefix: str) -> str:
    """Generate a prefixed public ID like 'doc-a1b2c3d4'."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"
