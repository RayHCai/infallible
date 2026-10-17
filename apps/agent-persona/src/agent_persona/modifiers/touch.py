from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import random


def neuropathy(
    button_ids: list[str], rng: random.Random, severity: float = 0.5, **_: Any
) -> list[str]:
    """Keep the buttons the persona can still find by touch. ``severity`` in [0, 1]."""
    return [b for b in button_ids if rng.random() >= severity]
