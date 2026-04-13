from cryptography.fernet import Fernet, InvalidToken


def encrypt_api_key(key: str, encryption_key: str) -> str:
    """Encrypt an API key using Fernet symmetric encryption."""
    f = Fernet(encryption_key.encode())
    return f.encrypt(key.encode()).decode()


def decrypt_api_key(encrypted: str, encryption_key: str) -> str:
    """Decrypt an API key. Raises ValueError if decryption fails."""
    try:
        f = Fernet(encryption_key.encode())
        return f.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception) as e:
        raise ValueError(f"Failed to decrypt API key: {e}")
