"""Scanner capture -> annotated GLB.

Pipeline (see prd.md § object-builder):
  1. segmentation per frame (SAM 2 / rembg)
  2. reconstruction — fast tier (InstantMesh) or quality tier (COLMAP + OpenMVS);
     skipped if the phone already produced a mesh (iOS PhotogrammetrySession)
  3. post-process (decimate / recenter / scale) -> GLB
  4. annotation of screen + button regions (Claude vision on reference renders)

Each stage is a pluggable ``ReconstructionStage``. Until real stages are
registered the builder falls back to the bundled mesh — the run must never
block on a bad scan.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from driver.object_builder.fallback import install_fallback
from infallible_contracts import BuildSource

if TYPE_CHECKING:
    from pathlib import Path
    from uuid import UUID

    from infallible_contracts.paths import DataLayout

log = logging.getLogger(__name__)

type ProgressFn = Callable[[str, float], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class Capture:
    """Scanner upload, already persisted under ``runs/{id}/capture/``."""

    frames: list[Path]
    poses: list[dict[str, Any]] | None = None
    scale_m: float | None = None
    mesh: Path | None = None  # on-device USDZ/OBJ (iOS ObjectCapture path)


@dataclass(slots=True)
class BuildContext:
    run_id: UUID
    capture: Capture
    mesh_out: Path
    annotations_out: Path
    scratch: dict[str, Any] = field(default_factory=dict)


class ReconstructionStage(Protocol):
    name: str

    async def run(self, ctx: BuildContext) -> None: ...


class ObjectBuilder:
    def __init__(
        self, layout: DataLayout, timeout_s: float, stages: list[ReconstructionStage] | None = None
    ) -> None:
        self._layout = layout
        self._timeout_s = timeout_s
        self._stages = stages or []

    async def build(self, run_id: UUID, capture: Capture, progress: ProgressFn) -> BuildSource:
        ctx = BuildContext(
            run_id=run_id,
            capture=capture,
            mesh_out=self._layout.mesh(run_id),
            annotations_out=self._layout.mesh_annotations(run_id),
        )
        if self._stages:
            try:
                await asyncio.wait_for(self._run_stages(ctx, progress), timeout=self._timeout_s)
            except TimeoutError:
                log.warning('object build timed out after %.0fs; using fallback', self._timeout_s)
            except Exception:
                log.exception('object build failed; using fallback')
            else:
                if ctx.mesh_out.is_file() and ctx.annotations_out.is_file():
                    return BuildSource.SCAN

        await progress('fallback', 1.0)
        await asyncio.to_thread(install_fallback, ctx.mesh_out, ctx.annotations_out)
        return BuildSource.FALLBACK

    async def _run_stages(self, ctx: BuildContext, progress: ProgressFn) -> None:
        for i, stage in enumerate(self._stages):
            await progress(stage.name, i / len(self._stages))
            await stage.run(ctx)
        await progress('done', 1.0)
