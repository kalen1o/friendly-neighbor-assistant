import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

BUILTIN_HOOKS_DIR = Path(__file__).parent.parent.parent / "hooks"

VALID_HOOK_POINTS = [
    "pre_message",
    "pre_skills",
    "post_skills",
    "pre_llm",
    "post_llm",
    "post_message",
]


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
                elif val.isdigit():
                    val = int(val)
                meta[key.strip()] = val
        return meta, parts[2].strip()
    except Exception:
        return {}, content


class HookDefinition:
    """A loaded hook — either built-in or user-created."""

    def __init__(
        self,
        name: str,
        description: str,
        hook_type: str,
        hook_point: str,
        priority: int = 100,
        content: str = "",
        enabled: bool = True,
        builtin: bool = False,
    ):
        self.name = name
        self.description = description
        self.hook_type = hook_type
        self.hook_point = hook_point
        self.priority = priority
        self.content = content
        self.enabled = enabled
        self.builtin = builtin


class HookContext:
    """Data passed through all hooks at a given hook point."""

    def __init__(self):
        self.user_message: str = ""
        self.chat_id: int = 0
        self.llm_messages: list = []
        self.response: str = ""
        self.skills_used: list = []
        self.sources: list = []
        self.context_parts: list = []
        self.knowledge_prompts: list = []
        self.blocked: bool = False
        self.blocked_reason: str = ""
        self.metadata: Dict[
            str, Any
        ] = {}  # shared state between hooks (e.g. start_time)
        self.modifications: Dict[str, Any] = {}  # hooks can modify these values


class HookRegistry:
    """Loads and manages all hooks. Executes hooks by point in priority order."""

    def __init__(self):
        self._hooks: Dict[str, HookDefinition] = {}
        self._executors: Dict[str, Callable] = {}

    def register_executor(self, hook_name: str, executor: Callable):
        """Register a Python function as the executor for a hook."""
        self._executors[hook_name] = executor

    def load_builtin_hooks(self):
        """Load all built-in hook markdown files."""
        if not BUILTIN_HOOKS_DIR.exists():
            logger.warning(f"Built-in hooks directory not found: {BUILTIN_HOOKS_DIR}")
            return

        for path in sorted(BUILTIN_HOOKS_DIR.glob("*.md")):
            try:
                raw = path.read_text(encoding="utf-8")
                meta, body = _parse_frontmatter(raw)

                name = meta.get("name", path.stem)
                hook_point = meta.get("hook_point", "post_message")
                if hook_point not in VALID_HOOK_POINTS:
                    logger.warning(
                        f"Invalid hook_point '{hook_point}' in {path}, skipping"
                    )
                    continue

                hook = HookDefinition(
                    name=name,
                    description=meta.get("description", ""),
                    hook_type=meta.get("type", "observability"),
                    hook_point=hook_point,
                    priority=meta.get("priority", 100),
                    content=body,
                    enabled=meta.get("enabled", True),
                    builtin=True,
                )
                self._hooks[name] = hook
                logger.info(f"Loaded built-in hook: {name} ({hook_point})")
            except Exception as e:
                logger.error(f"Failed to load hook from {path}: {e}")

    def load_user_hooks(self, db_hooks: list):
        """Load user-created hooks from DB records."""
        for record in db_hooks:
            _, body = _parse_frontmatter(record.content)
            hook = HookDefinition(
                name=record.name,
                description=record.description,
                hook_type=record.hook_type,
                hook_point=record.hook_point,
                priority=record.priority,
                content=body,
                enabled=record.enabled,
                builtin=False,
            )
            self._hooks[record.name] = hook

    def get_hooks_for_point(self, hook_point: str) -> List[HookDefinition]:
        """Get all enabled hooks for a specific hook point, sorted by priority."""
        hooks = [
            h for h in self._hooks.values() if h.hook_point == hook_point and h.enabled
        ]
        return sorted(hooks, key=lambda h: h.priority)

    async def run_hooks(self, hook_point: str, context: HookContext) -> HookContext:
        """Run all enabled hooks for a point in priority order."""
        hooks = self.get_hooks_for_point(hook_point)

        for hook in hooks:
            if context.blocked and hook.hook_type != "observability":
                continue  # Skip non-observability hooks if blocked

            executor = self._executors.get(hook.name)
            if executor:
                try:
                    await executor(context, hook)
                except Exception as e:
                    logger.warning(f"Hook {hook.name} failed: {e}")

        return context

    def all_hooks(self) -> List[HookDefinition]:
        """Get all hooks."""
        return list(self._hooks.values())

    def get_hook(self, name: str) -> Optional[HookDefinition]:
        return self._hooks.get(name)
