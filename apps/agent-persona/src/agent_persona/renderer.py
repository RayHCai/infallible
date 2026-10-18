"""The agent's eye: its pose around the pump, moved by view actions, and the
snapshot of the visualizer's 3D device scene taken from it each step.

``apply_view`` mirrors ``apps/visualizer/src/three/eyePose.ts`` so the eye the
visualizer draws is where the snapshot was taken from.
"""

import base64
import io
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

from PIL import Image

from infallible_contracts import (
    Action,
    EyePose,
    MeshAnnotations,
    RenderRequest,
    RotateViewAction,
    ZoomAction,
)

if TYPE_CHECKING:
    from pathlib import Path

    from agent_persona.frame_server import FrameServer

OUTPUT_SIZE = (640, 480)

type Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in frame pixels


def apply_view(pose: EyePose, action: Action) -> EyePose:
    match action:
        case RotateViewAction(axis='y', deg=deg):
            return pose.model_copy(update={'yaw': pose.yaw + math.radians(deg)})
        case RotateViewAction(axis='x', deg=deg):
            pitch = min(1.2, max(-1.2, pose.pitch + math.radians(deg)))
            return pose.model_copy(update={'pitch': pitch})
        case ZoomAction(delta=delta):
            return pose.model_copy(update={'radius': min(4, max(0.6, pose.radius * (1 - delta)))})
        case _:
            return pose


@dataclass(frozen=True, slots=True)
class Snapshot:
    image: Image.Image
    boxes: dict[str, Box]  # buttons facing the eye and not occluded


class Renderer:
    def __init__(self, annotations: MeshAnnotations, frames: FrameServer, timeout_s: float) -> None:
        self.annotations = annotations
        self._frames = frames
        self._timeout_s = timeout_s

    async def snapshot(self, screen: Image.Image, pose: EyePose) -> Snapshot:
        buf = io.BytesIO()
        screen.save(buf, format='PNG')
        request = RenderRequest(
            id=0,
            pose=pose,
            screen_png_b64=base64.b64encode(buf.getvalue()).decode('ascii'),
            width=OUTPUT_SIZE[0],
            height=OUTPUT_SIZE[1],
        )
        reply = await self._frames.render(request, self._timeout_s)
        image = Image.open(io.BytesIO(base64.b64decode(reply.png_b64))).convert('RGB')
        boxes = {
            b.id: (b.box[0], b.box[1], b.box[2], b.box[3])
            for b in reply.buttons
            if b.facing and not b.occluded
        }
        return Snapshot(image, boxes)


def annotations_path(mesh_path: Path) -> Path:
    return mesh_path.with_name(f'{mesh_path.stem}.annotations.json')


def load_annotations(mesh_path: Path) -> MeshAnnotations:
    return MeshAnnotations.model_validate_json(annotations_path(mesh_path).read_bytes())
