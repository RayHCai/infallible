import random
from uuid import uuid4

from PIL import Image

from agent_persona.modifiers import ModifierPipeline
from agent_persona.modifiers.motor import tremor
from agent_persona.planner import PlannedAction
from infallible_contracts import (
    BoxRegion,
    Modifier,
    ModifierId,
    Persona,
    PersonaAttributes,
    PressAction,
    WaitAction,
)

BUTTONS = [
    BoxRegion(id='up', x=0.4, y=0.6, w=0.1, h=0.1),
    BoxRegion(id='down', x=0.4, y=0.75, w=0.1, h=0.1),
    BoxRegion(id='ok', x=0.8, y=0.9, w=0.1, h=0.1),
]


def _persona(*modifiers: Modifier) -> Persona:
    return Persona(
        id=uuid4(),
        name='Test',
        description='test persona',
        attributes=PersonaAttributes(
            age=70, gender='f', guiding_prompt='', modifiers=list(modifiers)
        ),
    )


def test_vision_pipeline_changes_pixels() -> None:
    img = Image.new('RGB', (32, 32), (255, 0, 0))
    img.paste((0, 255, 0), (0, 0, 16, 32))
    pipeline = ModifierPipeline.for_persona(
        _persona(
            Modifier(id=ModifierId.BLUR, parameters={'sigma': 3}),
            Modifier(id=ModifierId.COLOR_DEFICIENCY),
        ),
        seed=1,
    )
    out = pipeline.vision(img)
    assert out.size == img.size
    assert out.tobytes() != img.tobytes()


def test_tremor_slips_to_nearest_button() -> None:
    slipped = tremor(PressAction(button_id='up'), BUTTONS, random.Random(0), amplitude=1.0)
    assert slipped == PressAction(button_id='down')


def test_tremor_ignores_non_physical_actions() -> None:
    action = WaitAction(ms=100)
    assert tremor(action, BUTTONS, random.Random(0), amplitude=1.0) is action


def test_hearing_loss_full_severity_drops_everything() -> None:
    pipeline = ModifierPipeline.for_persona(
        _persona(Modifier(id=ModifierId.HEARING_LOSS, parameters={'severity': 1.0})), seed=0
    )
    assert pipeline.audio(['alarm', 'click']) == []


def test_planned_action_maps_to_contract_action() -> None:
    planned = PlannedAction(kind='hold', target='up', amount=1500)
    assert planned.to_action().model_dump() == {'kind': 'hold', 'button_id': 'up', 'ms': 1500}
