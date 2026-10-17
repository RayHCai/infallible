from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import random

# Rough pitch class per firmware cue id; high-pitch cues go first with hearing loss.
_HIGH_PITCH = frozenset({'alarm', 'click', 'timeout'})


def hearing_loss(cues: list[str], rng: random.Random, severity: float = 0.5, **_: Any) -> list[str]:
    """Drop cues the persona would likely miss. ``severity`` in [0, 1]."""
    kept: list[str] = []
    for cue in cues:
        p_miss = severity if cue in _HIGH_PITCH else severity / 2
        if rng.random() >= p_miss:
            kept.append(cue)
    return kept
