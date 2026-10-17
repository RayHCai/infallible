"""Headless view of the pump from the persona's point of view.

``CompositeRenderer`` is the dependency-free default: it draws the annotated
device face in 2D, pastes the live firmware screen into the screen region, and
approximates camera pose with affine transforms. A full 3D renderer (ModernGL +
trimesh over the GLB, installed via the ``render`` extra) should implement the
same ``Renderer`` protocol and be returned from ``create_renderer``.
"""

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from PIL import Image, ImageDraw

from infallible_contracts import MeshAnnotations

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

OUTPUT_SIZE = (640, 480)
_BODY = (70, 76, 84)
_BUTTON = (150, 156, 164)
_BACKDROP = (28, 30, 34)

type Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in output pixels


@dataclass(slots=True)
class Camera:
    """Persona's hand pose. Starts slightly tilted and at arm's length."""

    yaw_deg: float = 0.0
    pitch_deg: float = -10.0
    roll_deg: float = 0.0
    distance: float = 1.0  # 1.0 = default arm's length; smaller = closer

    def rotate(self, axis: str, deg: float) -> None:
        match axis:
            case 'x':
                self.pitch_deg = max(-80.0, min(80.0, self.pitch_deg + deg))
            case 'y':
                self.yaw_deg = max(-80.0, min(80.0, self.yaw_deg + deg))
            case 'z':
                self.roll_deg = (self.roll_deg + deg) % 360

    def zoom(self, delta: float) -> None:
        self.distance = max(0.3, min(3.0, self.distance - delta))


class Renderer(Protocol):
    annotations: MeshAnnotations

    def render(self, screen: Image.Image, camera: Camera, *, buttons: bool = True) -> Image.Image:
        """``buttons=False`` paints them out: the baseline for button contrast."""
        ...

    def button_boxes(self, camera: Camera) -> dict[str, Box]:
        """Per button id, its bounds in the render (may run past the frame).
        Buttons facing away or occluded are omitted."""
        ...


class CompositeRenderer:
    def __init__(
        self, annotations: MeshAnnotations, face_size: tuple[int, int] = (360, 480)
    ) -> None:
        self.annotations = annotations
        self._face_size = face_size

    def _face(self, screen: Image.Image, buttons: bool) -> Image.Image:
        w, h = self._face_size
        face = Image.new('RGB', (w, h), _BACKDROP)
        draw = ImageDraw.Draw(face)
        draw.rounded_rectangle((4, 4, w - 4, h - 4), radius=36, fill=_BODY)

        s = self.annotations.screen
        box = (int(s.x * w), int(s.y * h), int((s.x + s.w) * w), int((s.y + s.h) * h))
        face.paste(screen.resize((box[2] - box[0], box[3] - box[1])), box[:2])

        for b in self.annotations.buttons if buttons else []:
            x0, y0 = int(b.x * w), int(b.y * h)
            x1, y1 = int((b.x + b.w) * w), int((b.y + b.h) * h)
            draw.ellipse((x0, y0, x1, y1), fill=_BUTTON)
            draw.text(
                ((x0 + x1) // 2 - 10, (y0 + y1) // 2 - 6),
                b.id.removeprefix('btn_'),
                fill=(20, 20, 20),
            )
        return face

    def _scaled_size(self, camera: Camera) -> tuple[int, int]:
        # Foreshortening from yaw/pitch, scale from distance.
        sx = max(0.15, math.cos(math.radians(camera.yaw_deg))) / camera.distance
        sy = max(0.15, math.cos(math.radians(camera.pitch_deg))) / camera.distance
        w, h = self._face_size
        return max(1, int(w * sx)), max(1, int(h * sy))

    def render(self, screen: Image.Image, camera: Camera, *, buttons: bool = True) -> Image.Image:
        face = self._face(screen, buttons).resize(self._scaled_size(camera))
        face = face.rotate(camera.roll_deg, expand=True, fillcolor=_BACKDROP)

        out = Image.new('RGB', OUTPUT_SIZE, _BACKDROP)
        out.paste(face, ((OUTPUT_SIZE[0] - face.width) // 2, (OUTPUT_SIZE[1] - face.height) // 2))
        return out

    def _projector(self, camera: Camera) -> Callable[[float, float], tuple[float, float]]:
        """Normalised face coords -> output pixels, mirroring render()."""
        fw, fh = self._scaled_size(camera)
        t = math.radians(camera.roll_deg)
        cos, sin = math.cos(t), math.sin(t)
        cx, cy = OUTPUT_SIZE[0] / 2, OUTPUT_SIZE[1] / 2

        def project(u: float, v: float) -> tuple[float, float]:
            # PIL rotates counter-clockwise about the centre (y points down).
            dx, dy = (u - 0.5) * fw, (v - 0.5) * fh
            return cx + dx * cos + dy * sin, cy - dx * sin + dy * cos

        return project

    def button_boxes(self, camera: Camera) -> dict[str, Box]:
        # The 2D face never turns away. Axis-aligned bounds of the rotated box.
        project = self._projector(camera)
        out: dict[str, Box] = {}
        for b in self.annotations.buttons:
            corners = [project(u, v) for u in (b.x, b.x + b.w) for v in (b.y, b.y + b.h)]
            xs, ys = [p[0] for p in corners], [p[1] for p in corners]
            out[b.id] = (min(xs), min(ys), max(xs), max(ys))
        return out


def annotations_path(mesh_path: Path) -> Path:
    return mesh_path.with_name(f'{mesh_path.stem}.annotations.json')


def create_renderer(mesh_path: Path) -> Renderer:
    annotations = MeshAnnotations.model_validate_json(annotations_path(mesh_path).read_bytes())
    return CompositeRenderer(annotations)
