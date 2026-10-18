import asyncio
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from PIL import Image, ImageDraw
from typesafe_sdk import NoulAnswer

from agent_persona.modifiers import ModifierPipeline
from agent_persona.modifiers.vision import blur
from agent_persona.perception import Perceiver, build_controls, contrast
from infallible_contracts import (
    BoxRegion,
    MeshAnnotations,
    Modifier,
    ModifierId,
    Persona,
    PersonaAttributes,
    PressAction,
)

ANNOTATIONS = MeshAnnotations(
    screen=BoxRegion(id='screen', x=0.1, y=0.1, w=0.8, h=0.35),
    buttons=[
        BoxRegion(id='menu', x=0.1, y=0.52, w=0.2, h=0.12, anchor=[-0.018, -0.004, 0.012]),
        BoxRegion(id='up', x=0.4, y=0.52, w=0.2, h=0.12, anchor=[0.0, -0.004, 0.012]),
        BoxRegion(id='ok', x=0.7, y=0.72, w=0.2, h=0.12, anchor=[0.018, -0.02, 0.012]),
    ],
)
CONTROLS = build_controls(ANNOTATIONS)
BOXES = {'menu': (100, 100, 200, 160), 'up': (250, 100, 350, 160), 'ok': (400, 300, 500, 360)}


def _device(button: int, surface: int = 60) -> Image.Image:
    img = Image.new('RGB', (640, 480), (surface,) * 3)
    draw = ImageDraw.Draw(img)
    for box in BOXES.values():
        draw.ellipse(box, fill=(button,) * 3)
    return img


VIEW = _device(button=150)


class FakeJev:
    def __init__(self, scores: dict[str, float]) -> None:
        self.scores = scores
        self.questions: list[str] = []

    async def system_one(self, state: Any, questions: dict[str, Any], **_: Any) -> Any:
        self.questions = list(questions)
        answers = {k: NoulAnswer(type='noul', noul=self.scores.get(k, 1.0)) for k in questions}
        return SimpleNamespace(answers=answers)


def _perceiver(client: Any = None) -> Perceiver:
    return Perceiver(
        CONTROLS, client, 'jev-1.14.0', read_threshold=0.5, min_in_frame=0.5, min_contrast=0.06
    )


def test_controls_use_neutral_handles_and_positions() -> None:
    assert [(c.handle, c.where) for c in CONTROLS] == [
        ('b1', 'top-left button below the screen'),
        ('b2', 'top-middle button below the screen'),
        ('b3', 'bottom-right button below the screen'),
    ]


def test_without_jev_seen_buttons_are_labelled() -> None:
    p = asyncio.run(_perceiver().perceive(VIEW, BOXES, felt=set()))
    assert p.prompt_lines()[0] == 'b1: button marked "menu" (top-left button below the screen)'


def test_jev_only_judges_readability() -> None:
    jev = FakeJev({'b1': 0.1})
    p = asyncio.run(_perceiver(jev).perceive(VIEW, BOXES, felt=set()))
    assert jev.questions == ['b1', 'b2', 'b3']
    assert p.prompt_lines()[:2] == [
        'b1: top-left button below the screen, marking unreadable',
        'b2: button marked "up" (top-middle button below the screen)',
    ]


def test_contrast_fades_with_blur() -> None:
    sharp = contrast(VIEW, BOXES['up'])
    assert sharp > 1
    assert 0 < contrast(blur(VIEW, sigma=30), BOXES['up']) < sharp


def test_low_contrast_buttons_are_not_seen() -> None:
    jev = FakeJev({})
    p = asyncio.run(_perceiver(jev).perceive(_device(button=61), BOXES, felt={'ok'}))
    assert jev.questions == []
    assert p.prompt_lines() == [
        "b3: you can feel the bottom-right button below the screen but can't see it"
    ]


def test_hidden_or_out_of_frame_buttons_skip_jev_and_need_touch() -> None:
    jev = FakeJev({})
    # menu mostly off-frame; ok facing away or occluded, so the snapshot omits it
    boxes = {'menu': (-90, 100, 10, 160), 'up': BOXES['up']}
    p = asyncio.run(_perceiver(jev).perceive(VIEW, boxes, felt={'menu'}))
    assert jev.questions == ['b2']
    assert p.prompt_lines() == [
        "b1: you can feel the top-left button below the screen but can't see it",
        'b2: button marked "up" (top-middle button below the screen)',
    ]


def test_resolve_maps_handles_back_to_button_ids() -> None:
    perceiver = _perceiver()
    assert perceiver.resolve(PressAction(button_id='b3')) == PressAction(button_id='ok')
    assert perceiver.handle_of('ok') == 'b3'


def _pipeline(severity: float | None) -> ModifierPipeline:
    mods = (
        []
        if severity is None
        else [Modifier(id=ModifierId.NEUROPATHY, parameters={'severity': severity})]
    )
    persona = Persona(
        id=uuid4(),
        name='Test',
        description='test persona',
        attributes=PersonaAttributes(age=70, gender='f', guiding_prompt='', modifiers=mods),
    )
    return ModifierPipeline.for_persona(persona, seed=0)


def test_touch_defaults_to_everything_and_is_seeded() -> None:
    ids = [b.id for b in ANNOTATIONS.buttons]
    assert _pipeline(None).touch(ids, seed=1) == set(ids)
    assert _pipeline(1.0).touch(ids, seed=1) == set()
    assert _pipeline(0.5).touch(ids, seed=7) == _pipeline(0.5).touch(ids, seed=7)
