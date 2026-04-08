import logging
import os
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

BUILTIN_SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"


def _parse_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    """Parse YAML frontmatter from markdown content."""
    if not content.startswith("---"):
        return {}, content

    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content

    try:
        # Simple YAML-like parsing without PyYAML dependency
        meta = {}  # type: Dict[str, Any]
        for line in parts[1].strip().split("\n"):
            line = line.strip()
            if ":" in line:
                key, val = line.split(":", 1)
                val = val.strip()
                if val.lower() == "true":
                    val = True
                elif val.lower() == "false":
                    val = False
                meta[key.strip()] = val
        return meta, parts[2].strip()
    except Exception:
        return {}, content


class SkillDefinition:
    """A loaded skill -- either built-in (from file) or user-created (from DB)."""

    def __init__(
        self,
        name: str,
        description: str,
        skill_type: str,
        content: str,
        enabled: bool = True,
        builtin: bool = False,
    ):
        self.name = name
        self.description = description
        self.skill_type = skill_type
        self.content = content  # full markdown body (without frontmatter)
        self.enabled = enabled
        self.builtin = builtin

    def to_index_entry(self) -> str:
        """One-line entry for the skill index (~10 tokens)."""
        return f"- {self.name}: {self.description}"


class SkillRegistry:
    """Loads and manages all skills. Provides skill index and executor lookup."""

    def __init__(self):
        self._skills = {}  # type: Dict[str, SkillDefinition]
        self._executors = {}  # type: Dict[str, Callable]

    def register_executor(self, skill_name: str, executor: Callable):
        """Register a Python function as the executor for a skill."""
        self._executors[skill_name] = executor

    def load_builtin_skills(self):
        """Load all built-in skill markdown files from the skills/ directory."""
        if not BUILTIN_SKILLS_DIR.exists():
            logger.warning(f"Built-in skills directory not found: {BUILTIN_SKILLS_DIR}")
            return

        for path in sorted(BUILTIN_SKILLS_DIR.glob("*.md")):
            try:
                raw = path.read_text(encoding="utf-8")
                meta, body = _parse_frontmatter(raw)

                name = meta.get("name", path.stem)
                skill = SkillDefinition(
                    name=name,
                    description=meta.get("description", ""),
                    skill_type=meta.get("type", "tool"),
                    content=body,
                    enabled=meta.get("enabled", True),
                    builtin=True,
                )
                self._skills[name] = skill
                logger.info(f"Loaded built-in skill: {name}")
            except Exception as e:
                logger.error(f"Failed to load skill from {path}: {e}")

    def load_user_skills(self, db_skills: list):
        """Load user-created skills from DB records."""
        for record in db_skills:
            _, body = _parse_frontmatter(record.content)
            skill = SkillDefinition(
                name=record.name,
                description=record.description,
                skill_type=record.skill_type,
                content=body,
                enabled=record.enabled,
                builtin=False,
            )
            self._skills[record.name] = skill

    def get_enabled_skills(self) -> List[SkillDefinition]:
        """Get all enabled skills."""
        return [s for s in self._skills.values() if s.enabled]

    def get_skill(self, name: str) -> Optional[SkillDefinition]:
        """Get a skill by name."""
        return self._skills.get(name)

    def get_executor(self, name: str) -> Optional[Callable]:
        """Get the executor function for a skill."""
        return self._executors.get(name)

    def get_skill_index(self) -> str:
        """Build the lightweight skill index for the agent's system prompt."""
        enabled = self.get_enabled_skills()
        if not enabled:
            return "No skills available."

        lines = ["Available skills (call by name when needed):"]
        for skill in enabled:
            lines.append(skill.to_index_entry())
        return "\n".join(lines)

    def get_skill_names(self) -> List[str]:
        """Get names of all registered skills."""
        return list(self._skills.keys())

    def all_skills(self) -> List[SkillDefinition]:
        """Get all skills (enabled and disabled)."""
        return list(self._skills.values())
