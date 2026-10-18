import math
from typing import TYPE_CHECKING, Any

from infallible_contracts import Action, BoxRegion, HoldAction, PressAction

if TYPE_CHECKING:
    import random


def _nearest(target: BoxRegion, others: list[BoxRegion]) -> BoxRegion | None:
    def dist(b: BoxRegion) -> float:
        return math.hypot(
            b.x + b.w / 2 - (target.x + target.w / 2), b.y + b.h / 2 - (target.y + target.h / 2)
        )

    candidates = [b for b in others if b.id != target.id]
    return min(candidates, key=dist, default=None)


def tremor(
    action: Action,
    buttons: list[BoxRegion],
    rng: random.Random,
    amplitude: float = 0.3,
    **_: Any,
) -> Action:
    """With probability ``amplitude``, a press/hold lands on the adjacent button."""
    if not isinstance(action, PressAction | HoldAction) or rng.random() >= amplitude:
        return action
    by_id = {b.id: b for b in buttons}
    target = by_id.get(action.button_id)
    slipped = _nearest(target, buttons) if target else None
    if slipped is None:
        return action
    return action.model_copy(update={'button_id': slipped.id})


def rushing(action: Action, rng: random.Random, severity: float = 0.2, **_: Any) -> Action:
    """With probability ``severity``, a press is held ~1 s: long enough to trigger
    auto-repeat on most pumps, so values overshoot and confirm screens get skipped."""
    if not isinstance(action, PressAction) or rng.random() >= severity:
        return action
    return HoldAction(button_id=action.button_id, ms=rng.randint(800, 1200))
