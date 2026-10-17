import random
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from agent_persona.modifiers import audio, motor, touch, vision
from infallible_contracts import Action, BoxRegion, Modifier, ModifierId, Persona

if TYPE_CHECKING:
    from collections.abc import Callable

    from PIL import Image

_VISION: dict[ModifierId, Callable[..., Image.Image]] = {
    ModifierId.BLUR: vision.blur,
    ModifierId.CONTRAST_LOSS: vision.contrast_loss,
    ModifierId.COLOR_DEFICIENCY: vision.color_deficiency,
}


@dataclass
class ModifierPipeline:
    modifiers: list[Modifier]
    rng: random.Random = field(default_factory=random.Random)

    @classmethod
    def for_persona(cls, persona: Persona, seed: int | None = None) -> ModifierPipeline:
        return cls(list(persona.attributes.modifiers), random.Random(seed))  # noqa: S311 — simulation, not crypto

    def vision(self, img: Image.Image) -> Image.Image:
        for m in self.modifiers:
            if fn := _VISION.get(m.id):
                img = fn(img, **m.parameters)
        return img

    def audio(self, cues: list[str]) -> list[str]:
        for m in self.modifiers:
            if m.id == ModifierId.HEARING_LOSS:
                cues = audio.hearing_loss(cues, self.rng, **m.parameters)
        return cues

    def touch(self, button_ids: list[str], seed: int) -> set[str]:
        """Buttons findable by feel. Rolled once per task (own seeded RNG) so
        touch doesn't flicker between steps and the task can be replayed."""
        rng = random.Random(seed)  # noqa: S311 — simulation, not crypto
        for m in self.modifiers:
            if m.id == ModifierId.NEUROPATHY:
                button_ids = touch.neuropathy(button_ids, rng, **m.parameters)
        return set(button_ids)

    def motor(self, action: Action, buttons: list[BoxRegion]) -> Action:
        for m in self.modifiers:
            if m.id == ModifierId.TREMOR:
                action = motor.tremor(action, buttons, self.rng, **m.parameters)
        return action
