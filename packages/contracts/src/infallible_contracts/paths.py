"""On-disk layout of the shared ``data/`` directory.

data/
  tasks/*.yaml                         TaskFile(s)    (written by scripts/)
  personas/*.json                      PersonaFile(s) (written by scripts/)
  runs/{run_id}/
    pump.glb                           reconstructed or fallback mesh
    pump.annotations.json              MeshAnnotations
    capture/                           raw scanner upload
    traces/{agent_id}/{task_id}.json   per-task agent trace
    suggestions.json                   SuggestionsFile
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path
    from uuid import UUID


@dataclass(frozen=True, slots=True)
class DataLayout:
    root: Path

    @property
    def tasks_dir(self) -> Path:
        return self.root / 'tasks'

    @property
    def personas_dir(self) -> Path:
        return self.root / 'personas'

    @property
    def runs_dir(self) -> Path:
        return self.root / 'runs'

    def run_dir(self, run_id: UUID) -> Path:
        return self.runs_dir / str(run_id)

    def mesh(self, run_id: UUID) -> Path:
        return self.run_dir(run_id) / 'pump.glb'

    def mesh_annotations(self, run_id: UUID) -> Path:
        return self.run_dir(run_id) / 'pump.annotations.json'

    def capture_dir(self, run_id: UUID) -> Path:
        return self.run_dir(run_id) / 'capture'

    def trace(self, run_id: UUID, agent_id: UUID, task_id: UUID) -> Path:
        return self.run_dir(run_id) / 'traces' / str(agent_id) / f'{task_id}.json'

    def suggestions(self, run_id: UUID) -> Path:
        return self.run_dir(run_id) / 'suggestions.json'

    def relative(self, path: Path) -> str:
        """Path relative to the data root, as stored in DB rows and events."""
        return path.relative_to(self.root).as_posix()
