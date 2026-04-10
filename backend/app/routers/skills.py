from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.agent import invalidate_agent_cache
from app.auth.dependencies import get_current_user
from app.db.session import get_db
from app.models.skill import Skill
from app.models.user import User
from app.schemas.skill import SkillCreate, SkillOut, SkillUpdate
from app.skills.registry import SkillRegistry, invalidate_skill_cache
from app.skills.executors import register_all_executors

router = APIRouter(prefix="/api/skills", tags=["skills"])


def _get_builtin_skills() -> List[dict]:
    """Get built-in skills from the registry (not from DB)."""
    registry = SkillRegistry()
    registry.load_builtin_skills()
    return [
        {
            "id": f"skill-builtin-{s.name}",
            "name": s.name,
            "description": s.description,
            "skill_type": s.skill_type,
            "content": s.content,
            "enabled": s.enabled,
            "builtin": True,
            "created_at": None,
            "updated_at": None,
        }
        for s in registry.all_skills()
    ]


@router.get("", response_model=List[SkillOut])
async def list_skills(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """List all skills — built-in + user-created (shared + own)."""
    # Built-in skills from files
    builtin = _get_builtin_skills()

    # User skills from DB: shared (user_id=None) + user's own
    result = await db.execute(
        select(Skill).where(or_(Skill.user_id == None, Skill.user_id == user.id)).order_by(Skill.created_at.desc())  # noqa: E711
    )
    user_skills = result.scalars().all()

    # Merge: DB overrides built-in if same name exists
    db_names = {s.name for s in user_skills}
    merged = [b for b in builtin if b["name"] not in db_names]

    return merged + [SkillOut.model_validate(s) for s in user_skills]


@router.post("", status_code=201, response_model=SkillOut)
async def create_skill(body: SkillCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Create a user skill."""
    # Check if name already exists for this user (or as a shared/builtin skill)
    existing = await db.execute(
        select(Skill).where(
            Skill.name == body.name,
            or_(Skill.user_id == None, Skill.user_id == user.id),  # noqa: E711
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Skill '{body.name}' already exists")

    skill = Skill(
        name=body.name,
        description=body.description,
        skill_type=body.skill_type,
        content=body.content,
        enabled=True,
        builtin=False,
        user_id=user.id,
    )
    db.add(skill)
    await db.commit()
    invalidate_skill_cache()
    invalidate_agent_cache(user.id)
    await db.refresh(skill)
    return skill


@router.get("/{skill_id}", response_model=SkillOut)
async def get_skill(skill_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Skill).where(Skill.public_id == skill_id, or_(Skill.user_id == None, Skill.user_id == user.id)))  # noqa: E711
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.patch("/{skill_id}", response_model=SkillOut)
async def update_skill(skill_id: str, body: SkillUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Skill).where(Skill.public_id == skill_id, Skill.user_id == user.id))
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    if body.name is not None:
        skill.name = body.name
    if body.description is not None:
        skill.description = body.description
    if body.content is not None:
        skill.content = body.content
    if body.enabled is not None:
        skill.enabled = body.enabled

    await db.commit()
    invalidate_skill_cache()
    invalidate_agent_cache(user.id)
    await db.refresh(skill)
    return skill


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(skill_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Skill).where(Skill.public_id == skill_id, Skill.user_id == user.id))
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    if skill.builtin:
        raise HTTPException(status_code=403, detail="Cannot delete built-in skills")
    await db.delete(skill)
    await db.commit()
    invalidate_skill_cache()
    invalidate_agent_cache(user.id)

