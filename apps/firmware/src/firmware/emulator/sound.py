"""The pump's speaker and vibration motor.

Alarm and alert sounds follow IEC 60601-1-8, the standard pump alarms are
certified against: harmonic-rich tones with a 150-1000 Hz fundamental, in a
10-pulse burst for high priority, 3 pulses for medium, 1-2 for low. The
low-frequency fundamental is deliberate: it survives age-related hearing loss
that removes the upper harmonics. Keypad and delivery tones are short beeps,
as on commercial pumps.
"""

import base64
import io
import math
import struct
import wave
from dataclasses import dataclass
from functools import cache
from typing import TYPE_CHECKING, Literal

from infallible_contracts import AudioCue

if TYPE_CHECKING:
    from firmware.emulator.config import AudioConfig

type Priority = Literal['high', 'medium', 'low', 'info']

RATE = 16_000
# Device volume 0..1 maps to this peak level at arm's length (dBA).
MIN_DB, MAX_DB = 45.0, 80.0
RAMP_S = 0.015


@dataclass(frozen=True, slots=True)
class Tone:
    priority: Priority
    freq_hz: float
    pulses: tuple[tuple[float, float], ...]  # (onset_s, duration_s)
    harmonics: int = 5
    gain_db: float = 0.0  # relative to the device volume


def _pulses(onsets: tuple[float, ...], width_s: float) -> tuple[tuple[float, float], ...]:
    return tuple((t, width_s) for t in onsets)


# High priority: 3 + 2 pulses, twice (td 150 ms, spacing 100 ms, 2x+td between 3 and 4).
_HIGH = _pulses((0, 0.25, 0.5, 1.0, 1.25, 1.9, 2.15, 2.4, 2.9, 3.15), 0.15)
_MEDIUM = _pulses((0, 0.4, 0.8), 0.2)
_LOW = _pulses((0, 0.4), 0.2)

TONES: dict[str, Tone] = {
    'high': Tone('high', 600, _HIGH),
    'medium': Tone('medium', 523, _MEDIUM),
    'low': Tone('low', 440, _LOW, gain_db=-6),
    'keypad': Tone('info', 2700, _pulses((0,), 0.03), harmonics=1, gain_db=-18),
    'delivery_start': Tone('info', 1047, _pulses((0, 0.15), 0.08), harmonics=2, gain_db=-8),
    'delivery_complete': Tone('info', 1319, _pulses((0, 0.15, 0.3), 0.08), harmonics=2, gain_db=-8),
    'timeout': Tone('low', 440, _pulses((0,), 0.2), gain_db=-6),
}
ALARM_PRIORITY: dict[str, Priority] = {'occlusion': 'high', 'low_reservoir': 'medium'}


def tone_for(cue: str) -> Tone:
    return TONES.get(cue) or TONES[ALARM_PRIORITY.get(cue, 'high')]


def emit(cue: str, audio: AudioConfig, at_ms: int, *, escalated: bool = False) -> AudioCue | None:
    """What the device does for ``cue`` under its sound settings; None if nothing."""
    tone = tone_for(cue)
    keypad = cue == 'keypad'
    if keypad and not audio.keypad_sounds:
        return None
    # Escalated alarms go to full volume and sound even in vibrate mode.
    audible = audio.mode != 'vibrate' or escalated
    vibrate = audio.mode != 'audio' and not keypad
    if not audible and not vibrate:
        return None
    volume = 1.0 if escalated else audio.volume
    level = MIN_DB + volume * (MAX_DB - MIN_DB) + tone.gain_db if audible and volume > 0 else 0.0
    return AudioCue(
        id=cue,
        priority=tone.priority,
        at_ms=at_ms,
        level_db=round(level, 1),
        vibrate=vibrate,
        wav_b64=_wav_b64(tone, level) if level else None,
    )


@cache
def _wav_b64(tone: Tone, level_db: float) -> str:
    amp = 0.9 * 10 ** ((level_db - MAX_DB) / 20)
    weights = [1 / k for k in range(1, tone.harmonics + 1)]
    norm = amp / sum(weights)
    end = max(t + d for t, d in tone.pulses)
    samples = [0.0] * math.ceil((end + 0.05) * RATE)
    for onset, width in tone.pulses:
        start, n = int(onset * RATE), int(width * RATE)
        ramp = int(RAMP_S * RATE)
        for i in range(n):
            t = i / RATE
            env = min(1.0, i / ramp, (n - i) / ramp)
            s = sum(
                w * math.sin(2 * math.pi * tone.freq_hz * k * t) for k, w in enumerate(weights, 1)
            )
            samples[start + i] = norm * env * s
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack(f'<{len(samples)}h', *(round(s * 32767) for s in samples)))
    return base64.b64encode(buf.getvalue()).decode('ascii')
