"""What the persona can find on the device this step: a button is seen if it
is in frame and still stands out in the degraded frame, its label is read if
Jev can read it there, and anything unseen may still be found by touch.

Jev only judges readability: calibration showed its "is the button there?"
answers drift with blur, while pixel contrast tracks what a person sees.

Controls reach the planner by neutral handle (``b1``...) so a button's label
is only known when the persona can actually read it.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from PIL import ImageChops, ImageStat
from typesafe_sdk import Image as JevImage
from typesafe_sdk import Noul, NoulAnswer

from agent_persona.renderer import OUTPUT_SIZE
from infallible_contracts import Action, HoldAction, PressAction

if TYPE_CHECKING:
    from PIL import Image
    from typesafe_sdk import AsyncTypeSafeClient

    from agent_persona.renderer import Box
    from infallible_contracts import BoxRegion, MeshAnnotations

_IMAGES_HEADER = {'TypeSafe-Danger-Zone-Images': 'true'}


@dataclass(frozen=True, slots=True)
class Control:
    handle: str
    button_id: str
    label: str
    where: str


def build_controls(annotations: MeshAnnotations) -> list[Control]:
    buttons = annotations.buttons
    return [
        Control(f'b{i}', b.id, b.id.removeprefix('btn_'), _where(b, buttons))
        for i, b in enumerate(buttons, start=1)
    ]


def _where(b: BoxRegion, buttons: list[BoxRegion]) -> str:
    """Position within the button group, e.g. 'top-left'; ids would leak labels."""

    def side(v: float, vals: list[float], names: tuple[str, str, str]) -> str:
        lo, hi = min(vals), max(vals)
        if hi - lo < 1e-6:
            return ''
        t = (v - lo) / (hi - lo)
        return names[0] if t < 1 / 3 else names[2] if t > 2 / 3 else names[1]

    row = side(b.y + b.h / 2, [o.y + o.h / 2 for o in buttons], ('top', 'middle', 'bottom'))
    col = side(b.x + b.w / 2, [o.x + o.w / 2 for o in buttons], ('left', 'middle', 'right'))
    parts = [p for p in (row, col) if p]
    pos = 'centre' if parts in ([], ['middle'], ['middle', 'middle']) else '-'.join(parts)
    return f'{pos} button below the screen'


def in_frame(box: Box) -> float:
    x0, y0, x1, y1 = box
    area = (x1 - x0) * (y1 - y0)
    iw = max(0.0, min(x1, OUTPUT_SIZE[0]) - max(x0, 0))
    ih = max(0.0, min(y1, OUTPUT_SIZE[1]) - max(y0, 0))
    return iw * ih / area if area > 0 else 0.0


def contrast(view: Image.Image, bare: Image.Image, box: Box) -> float:
    """How much the button changes its centre region vs the same degraded frame
    without it, relative to that background's luminance (Weber-style)."""
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 4, (y1 - y0) / 4
    region = (
        max(0, int(cx - rx)), max(0, int(cy - ry)),
        min(OUTPUT_SIZE[0], int(cx + rx) + 1), min(OUTPUT_SIZE[1], int(cy + ry) + 1),
    )  # fmt: skip
    if region[0] >= region[2] or region[1] >= region[3]:
        return 0.0
    diff = ImageStat.Stat(ImageChops.difference(view, bare).convert('L').crop(region)).mean[0]
    base = ImageStat.Stat(bare.convert('L').crop(region)).mean[0]
    return diff / max(base, 1.0)


@dataclass(frozen=True, slots=True)
class Perceived:
    control: Control
    in_frame: float
    contrast: float
    readable: float | None  # Jev noul; None when not asked
    visible: bool
    legible: bool
    felt: bool

    def prompt_line(self) -> str | None:
        c = self.control
        if self.visible and self.legible:
            return f'{c.handle}: button labelled "{c.label}" ({c.where})'
        if self.visible:
            return f'{c.handle}: {c.where}, label unreadable'
        if self.felt:
            return f"{c.handle}: you can feel the {c.where} but can't see it"
        return None


@dataclass(frozen=True, slots=True)
class Perception:
    controls: list[Perceived]

    def prompt_lines(self) -> list[str]:
        return [line for p in self.controls if (line := p.prompt_line())]

    def trace(self) -> list[dict[str, Any]]:
        return [
            {
                'button_id': p.control.button_id,
                'handle': p.control.handle,
                'in_frame': round(p.in_frame, 3),
                'contrast': round(p.contrast, 3),
                'readable': p.readable,
                'felt': p.felt,
                'available': p.prompt_line() is not None,
            }
            for p in self.controls
        ]


class Perceiver:
    """``client=None`` skips Jev: every seen label counts as readable."""

    def __init__(
        self,
        controls: list[Control],
        client: AsyncTypeSafeClient | None,
        model: str,
        read_threshold: float,
        min_in_frame: float,
        min_contrast: float,
    ) -> None:
        self.controls = controls
        self._client = client
        self._model = model
        self._read_threshold = read_threshold
        self._min_in_frame = min_in_frame
        self._min_contrast = min_contrast
        self._by_handle = {c.handle: c for c in controls}
        self._by_id = {c.button_id: c for c in controls}

    async def perceive(
        self, view: Image.Image, bare: Image.Image, boxes: dict[str, Box], felt: set[str]
    ) -> Perception:
        """``bare`` is ``view`` rendered without buttons, same modifiers applied."""
        framed: dict[str, float] = {}
        contrasts: dict[str, float] = {}
        for c in self.controls:
            if box := boxes.get(c.button_id):
                framed[c.handle] = in_frame(box)
                contrasts[c.handle] = contrast(view, bare, box) if framed[c.handle] else 0.0
        seen = [
            c for c in self.controls
            if framed.get(c.handle, 0.0) >= self._min_in_frame
            and contrasts[c.handle] >= self._min_contrast
        ]  # fmt: skip
        scores = await self._ask(view, seen)
        out: list[Perceived] = []
        for c in self.controls:
            readable = scores.get(c.handle)
            visible = c in seen
            legible = visible and (readable is None or readable >= self._read_threshold)
            out.append(
                Perceived(
                    c, framed.get(c.handle, 0.0), contrasts.get(c.handle, 0.0), readable,
                    visible, legible, c.button_id in felt,
                )
            )  # fmt: skip
        return Perception(out)

    async def _ask(self, view: Image.Image, seen: list[Control]) -> dict[str, float]:
        if self._client is None or not seen:
            return {}
        questions = {
            c.handle: Noul(
                instructions=f'Can you read the label printed on the {c.where} in `view`?'
            )
            for c in seen
        }
        response = await self._client.system_one(
            state={'view': JevImage.from_pil(view)},
            questions=questions,
            model=self._model,
            extra_headers=_IMAGES_HEADER,
        )

        def noul(key: str) -> float:
            answer = response.answers[key]
            if not isinstance(answer, NoulAnswer):
                raise TypeError(f'expected a noul answer for {key}, got {answer.type}')
            return answer.noul

        return {c.handle: noul(c.handle) for c in seen}

    def resolve(self, action: Action) -> Action:
        """Planner handle -> real button id. Unperceived handles still resolve:
        pressing a remembered button is plausible behaviour."""
        if isinstance(action, PressAction | HoldAction) and (
            c := self._by_handle.get(action.button_id)
        ):
            return action.model_copy(update={'button_id': c.button_id})
        return action

    def handle_of(self, button_id: str) -> str:
        c = self._by_id.get(button_id)
        return c.handle if c else button_id
