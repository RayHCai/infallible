"""What the persona hears: the device's real waveforms through their ears.

Each cue's audio passes through the persona's audio modifiers and is then
described the way a person would report it (loudness, pitch, number of beeps),
never by its firmware id, so the planner has to interpret a beep pattern the
way a real user would.
"""

import base64
import io
import itertools
import wave
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Callable

    from infallible_contracts import AudioCue

# A quiet room masks anything softer (dBA at the ear).
AUDIBLE_DB = 35.0
WINDOW_S = 0.01
MAX_GAP_S = 0.03  # silences shorter than this don't split a beep
CLICK_S = 0.06


@dataclass(frozen=True, slots=True)
class Heard:
    cue: str
    description: str | None  # None: the persona missed it entirely
    wav_b64: str | None  # degraded audio, only when audible


def listen(cues: list[AudioCue], ears: Callable[[np.ndarray, int], np.ndarray]) -> list[Heard]:
    """Perceive cues in order; consecutive repeats (key clicks) are reported once, counted."""
    out: list[Heard] = []
    for _, group in itertools.groupby(cues, key=lambda c: (c.id, c.level_db, c.vibrate)):
        runs = list(group)
        heard = _perceive(runs[-1], ears)
        if heard.description and len(runs) > 1:
            heard = Heard(heard.cue, f'{heard.description} (x{len(runs)})', heard.wav_b64)
        out.append(heard)
    return out


def _perceive(cue: AudioCue, ears: Callable[[np.ndarray, int], np.ndarray]) -> Heard:
    sound: str | None = None
    wav_out: str | None = None
    if cue.wav_b64:
        samples, rate = _decode(cue.wav_b64)
        degraded = ears(samples, rate)
        sound = _describe(samples, degraded, rate, cue.level_db)
        if sound:
            wav_out = _encode(degraded, rate)
    felt = 'the pump vibrating' if cue.vibrate else None
    parts = [p for p in (sound, felt) if p]
    return Heard(cue.id, ' with '.join(parts) or None, wav_out)


def _describe(original: np.ndarray, degraded: np.ndarray, rate: int, level_db: float) -> str | None:
    win = max(1, int(WINDOW_S * rate))
    ref = _envelope(original, win).max()
    if ref <= 0:
        return None
    env = _envelope(degraded, win)
    levels = level_db + 20 * np.log10(np.maximum(env, 1e-9) / ref)
    audible = levels >= AUDIBLE_DB
    if not audible.any():
        return None

    pulses = _pulses(audible, int(MAX_GAP_S / WINDOW_S))
    longest_s = max(n for _, n in pulses) * WINDOW_S
    peak = float(levels.max())
    loudness = 'faint ' if peak < AUDIBLE_DB + 10 else 'loud ' if peak >= AUDIBLE_DB + 30 else ''
    spectrum = np.abs(np.fft.rfft(degraded))
    dominant = float(np.fft.rfftfreq(len(degraded), 1 / rate)[spectrum.argmax()])
    pitch = 'low-pitched ' if dominant < 700 else 'high-pitched ' if dominant >= 2000 else ''
    noun = 'click' if longest_s < CLICK_S else 'beep'
    n = len(pulses)
    return f'a {loudness}{pitch}{noun}' if n == 1 else f'{n} {loudness}{pitch}{noun}s'


def _envelope(samples: np.ndarray, win: int) -> np.ndarray:
    pad = (-len(samples)) % win
    frames = np.pad(samples, (0, pad)).reshape(-1, win)
    return np.sqrt((frames**2).mean(axis=1))


def _pulses(on: np.ndarray, max_gap: int) -> list[tuple[int, int]]:
    """(start, length) of each run of audible windows, bridging short gaps."""
    runs: list[tuple[int, int]] = []
    for value, group in itertools.groupby(enumerate(on), key=lambda x: bool(x[1])):
        if not value:
            continue
        idx = [i for i, _ in group]
        if runs and idx[0] - (runs[-1][0] + runs[-1][1]) <= max_gap:
            start = runs[-1][0]
            runs[-1] = (start, idx[-1] + 1 - start)
        else:
            runs.append((idx[0], len(idx)))
    return runs


def _decode(wav_b64: str) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(base64.b64decode(wav_b64))) as w:
        rate = w.getframerate()
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768, rate


def _encode(samples: np.ndarray, rate: int) -> str:
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return base64.b64encode(buf.getvalue()).decode('ascii')
