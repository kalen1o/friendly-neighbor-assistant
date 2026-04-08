import os
from pathlib import Path


def extract_text(file_path: str) -> str:
    """Extract text from a file based on its extension."""
    ext = Path(file_path).suffix.lower()

    if ext == ".txt" or ext == ".md":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

    elif ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    elif ext == ".docx":
        from docx import Document
        doc = Document(file_path)
        return "\n".join(p.text for p in doc.paragraphs)

    elif ext == ".html":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        # Simple HTML tag stripping
        import re
        text = re.sub(r"<[^>]+>", " ", content)
        return re.sub(r"\s+", " ", text).strip()

    elif ext == ".csv":
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

    else:
        raise ValueError(f"Unsupported file type: {ext}")
