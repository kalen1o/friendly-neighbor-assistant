from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: int
    filename: str
    file_type: str
    file_size: int
    status: str
    error_message: Optional[str] = None
    chunk_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentStatus(BaseModel):
    status: str
    chunk_count: int
    error_message: Optional[str] = None

    model_config = {"from_attributes": True}
