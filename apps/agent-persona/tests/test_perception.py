import asyncio
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from PIL import Image
from typesafe_sdk import NoulAnswer

from agent_persona.modifiers import ModifierPipeline
from agent_persona.perception import Perceiver, build_controls
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
        BoxRegion(id='menu', x=0.1, y=0.52, w=0.2, h=0.12),
        BoxRegion(id='up', x=0.4, y=0.52, w=0.2, h=0.12),
        BoxRegion(id='ok', x=0.7, y=0.72, w=0.2, h=0.12),
    ],
)
CONTROLS = build_controls(ANNOTATIONS)
VIEW = Image.new('RGB', (640, 480), 'white')
BARE = Image.new('RGB', (640, 480), 'black')  # buttons stand out fully against it
BOXES = {'menu': (100, 100, 200, 160), 'up': (250, 100, 350, 160), 'ok': (400, 300, 500, 360)}


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
        CONTROLS, client, 'jev-1.14.0', read_threshold=0.3, min_in_frame=0.5, min_contrast=0.06
    )


def test_controls_use_neutral_handles_and_positions() -> None:
    assert [(c.handle, c.where) for c in CONTROLS] == [
        ('b1', 'top-left button below the screen'),
        ('b2', 'top-middle button below the screen'),
        ('b3', 'bottom-right button below the screen'),
    ]


def test_without_jev_seen_buttons_are_labelled() -> None:
    p = asyncio.run(_perceiver().perceive(VIEW, BARE, BOXES, felt=set()))
    assert p.prompt_lines()[0] == 'b1: button labelled "menu" (top-left button below the screen)'


def test_jev_only_judges_readability() -> None:
    jev = FakeJev({'b1': 0.1})
    p = asyncio.run(_perceiver(jev).perceive(VIEW, BARE, BOXES, felt=set()))
    assert jev.questions == ['b1', 'b2', 'b3']
    assert p.prompt_lines()[:2] == [
        'b1: top-left button below the screen, label unreadable',
        'b2: button labelled "up" (top-middle button below the screen)',
    ]


def test_low_contrast_buttons_are_not_seen() -> None:
    faint = Image.new('RGB', (640, 480), (250, 250, 250))
    jev = FakeJev({})
    p = asyncio.run(_perceiver(jev).perceive(VIEW, faint, BOXES, felt={'ok'}))
    assert jev.questions == []
    assert p.prompt_lines() == [
        "b3: you can feel the bottom-right button below the screen but can't see it"
    ]


def test_out_of_frame_buttons_skip_jev_and_need_touch() -> None:
    jev = FakeJev({})
    boxes = {**BOXES, 'menu': (-90, 100, 10, 160), 'ok': (700, 300, 800, 360)}
    p = asyncio.run(_perceiver(jev).perceive(VIEW, BARE, boxes, felt={'menu'}))
    assert jev.questions == ['b2']
    assert p.prompt_lines() == [
        "b1: you can feel the top-left button below the screen but can't see it",
        'b2: button labelled "up" (top-middle button below the screen)',
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
