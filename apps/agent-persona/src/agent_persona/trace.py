import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path
    from uuid import UUID


@dataclass
class TaskTrace:
    """Per-task trace at ``runs/{run_id}/traces/{agent_id}/{task_id}.json``.

    Rewritten after every step so a crash still leaves a usable trace.
    """

    path: Path
    agent_id: UUID
    persona_id: UUID
    task_id: UUID
    touch_seed: int | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def append(self, step: dict[str, Any]) -> None:
        self.steps.append(step)
        self._flush()

    def finish(self, final_state: dict[str, Any], declared_done: bool) -> None:
        self._flush(final_state=final_state, declared_done=declared_done)

    def _flush(self, **extra: Any) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        body = {
            'agent_id': str(self.agent_id),
            'persona_id': str(self.persona_id),
            'task_id': str(self.task_id),
            'started_at': self.started_at,
            'touch_seed': self.touch_seed,
            'steps': self.steps,
            **extra,
        }
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps(body, indent=2, default=str), encoding='utf-8')
        tmp.replace(self.path)
