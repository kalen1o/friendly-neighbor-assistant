import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

BUILTIN_SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"

# Module-level metadata cache — survives across requests
_metadata_cache: Optional[Dict[str, "SkillDefinition"]] = None


def _parse_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    """Parse YAML frontmatter from markdown content."""
    if not content.startswith("---"):
        return {}, content

    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content

    try:
        meta = {}
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


def _parse_frontmatter_only(content: str) -> Dict[str, Any]:
    """Parse ONLY the frontmatter, skip the body."""
    meta, _ = _parse_frontmatter(content)
    return meta


class SkillDefinition:
    """A loaded skill — either built-in (from file) or user-created (from DB)."""

    def __init__(
        self,
        name: str,
        description: str,
        skill_type: str,
        content: str = "",
        enabled: bool = True,
        builtin: bool = False,
        file_path: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.name = name
        self.description = description
        self.skill_type = skill_type
        self._content = content  # may be empty for lazy loading
        self.enabled = enabled
        self.builtin = builtin
        self.file_path = file_path  # for lazy content loading
        self.model = model  # e.g. "anthropic:claude-sonnet-4-20250514"

    @property
    def content(self) -> str:
        """Lazy load full content from file if not already loaded."""
        if not self._content and self.file_path:
            try:
                raw = Path(self.file_path).read_text(encoding="utf-8")
                _, body = _parse_frontmatter(raw)
                self._content = body
            except Exception as e:
                logger.error(f"Failed to load content for {self.name}: {e}")
                self._content = ""
        return self._content

    def to_index_entry(self) -> str:
        """One-line entry for the skill index (~10 tokens)."""
        return f"- {self.name}: {self.description}"


class SkillRegistry:
    """Loads and manages all skills. Provides skill index and executor lookup."""

    def __init__(self):
        self._skills: Dict[str, SkillDefinition] = {}
        self._executors: Dict[str, Callable] = {}

    def register_executor(self, skill_name: str, executor: Callable):
        self._executors[skill_name] = executor

    def load_builtin_skills(self):
        """Load built-in skills — uses metadata cache if available."""
        global _metadata_cache

        if _metadata_cache is not None:
            # Use cache — just copy definitions (no file I/O)
            for name, skill in _metadata_cache.items():
                self._skills[name] = SkillDefinition(
                    name=skill.name,
                    description=skill.description,
                    skill_type=skill.skill_type,
                    content="",  # lazy loaded
                    enabled=skill.enabled,
                    builtin=True,
                    file_path=skill.file_path,
                    model=skill.model,
                )
            logger.debug(f"Loaded {len(_metadata_cache)} skills from cache")
            return

        # First load — read files and cache metadata
        _metadata_cache = {}

        if not BUILTIN_SKILLS_DIR.exists():
            logger.warning(f"Built-in skills directory not found: {BUILTIN_SKILLS_DIR}")
            return

        for path in sorted(BUILTIN_SKILLS_DIR.glob("*.md")):
            try:
                raw = path.read_text(encoding="utf-8")
                meta = _parse_frontmatter_only(raw)

                name = meta.get("name", path.stem)
                skill = SkillDefinition(
                    name=name,
                    description=meta.get("description", ""),
                    skill_type=meta.get("type", "tool"),
                    content="",  # NOT loaded — lazy
                    enabled=meta.get("enabled", True),
                    builtin=True,
                    file_path=str(path),
                    model=meta.get("model") or None,
                )
                self._skills[name] = skill
                _metadata_cache[name] = skill
                logger.info(f"Loaded built-in skill metadata: {name}")
            except Exception as e:
                logger.error(f"Failed to load skill from {path}: {e}")

    def load_user_skills(self, db_skills: list):
        """Load user-created skills from DB records."""
        for record in db_skills:
            meta, body = _parse_frontmatter(record.content)
            skill = SkillDefinition(
                name=record.name,
                description=record.description,
                skill_type=record.skill_type,
                content=body,
                enabled=record.enabled,
                builtin=False,
                model=meta.get("model") or None,
            )
            self._skills[record.name] = skill

    def get_enabled_skills(self) -> List[SkillDefinition]:
        return [s for s in self._skills.values() if s.enabled]

    def get_skill(self, name: str) -> Optional[SkillDefinition]:
        return self._skills.get(name)

    def get_executor(self, name: str) -> Optional[Callable]:
        return self._executors.get(name)

    def get_skill_index(self) -> str:
        """Build the lightweight skill index (names + descriptions only)."""
        enabled = self.get_enabled_skills()
        if not enabled:
            return "No skills available."
        lines = ["Available skills (call by name when needed):"]
        for skill in enabled:
            lines.append(skill.to_index_entry())
        return "\n".join(lines)

    def get_skill_model(self, skill_names: List[str]) -> Optional[str]:
        """Get the model override from the first skill that specifies one.

        When multiple skills are selected, the first skill with a `model`
        field takes priority. Returns format like "anthropic:claude-sonnet-4-20250514"
        or None if no skill specifies a model.
        """
        for name in skill_names:
            skill = self._skills.get(name)
            if skill and skill.model:
                return skill.model
        return None

    def get_skill_names(self) -> List[str]:
        return list(self._skills.keys())

    def all_skills(self) -> List[SkillDefinition]:
        return list(self._skills.values())


def invalidate_skill_cache():
    """Clear the metadata cache. Call when skills are created/updated/deleted."""
    global _metadata_cache
    _metadata_cache = None
    logger.info("Skill metadata cache invalidated")
