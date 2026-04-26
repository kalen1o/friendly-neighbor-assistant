from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ArtifactOut(BaseModel):
    id: str = Field(validation_alias="public_id")
    message_id: str
    message_public_id: Optional[str] = None
    chat_id: str
    title: str
    artifact_type: str
    code: Optional[str] = None
    template: Optional[str] = None
    files: Optional[dict] = None
    dependencies: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @classmethod
    def from_artifact(
        cls, artifact, message_public_id: Optional[str] = None
    ) -> "ArtifactOut":
        return cls(
            id=artifact.public_id,
            message_id=str(artifact.message_id),
            message_public_id=message_public_id,
            chat_id=str(artifact.chat_id),
            title=artifact.title,
            artifact_type=artifact.artifact_type,
            code=artifact.code,
            template=artifact.template,
            files=artifact.files,
            dependencies=artifact.dependencies,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
        )


class ArtifactUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    files: Optional[dict] = None


class ArtifactVersionOut(BaseModel):
    version_number: int
    title: str
    files: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ArtifactFileDiff(BaseModel):
    """Per-file entry in an artifact version comparison."""

    path: str
    status: str  # "added" | "removed" | "modified"
    # Unified diff for modified files. For added/removed we return the full
    # file body instead (renderer can flag it entirely green/red).
    diff: Optional[str] = None
    content: Optional[str] = None


class ArtifactDiffOut(BaseModel):
    from_version: int
    to_version: int
    files: list[ArtifactFileDiff]
