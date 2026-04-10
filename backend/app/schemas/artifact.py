from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ArtifactOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    message_id: str
    chat_id: str
    title: str
    artifact_type: str
    code: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @classmethod
    def from_artifact(cls, artifact) -> "ArtifactOut":
        return cls(
            id=artifact.public_id,
            message_id=str(artifact.message_id),
            chat_id=str(artifact.chat_id),
            title=artifact.title,
            artifact_type=artifact.artifact_type,
            code=artifact.code,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
        )


class ArtifactUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
