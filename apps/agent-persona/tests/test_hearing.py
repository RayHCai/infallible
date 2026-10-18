import base64
import io
import wave

import numpy as np

from agent_persona.hearing import listen
from agent_persona.modifiers.audio import hearing_loss
from infallible_contracts import AudioCue

RATE = 16_000


def _cue(
    cue: str, freq: float, pulses: int, width_s: float, level_db: float, **kw: bool
) -> AudioCue:
    t = np.arange(int(width_s * RATE)) / RATE
    beep = np.concatenate([0.5 * np.sin(2 * np.pi * freq * t), np.zeros(int(0.15 * RATE))])
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.tile(beep, pulses) * 32767).astype('<i2').tobytes())
    wav = base64.b64encode(buf.getvalue()).decode('ascii')
    return AudioCue(id=cue, priority='high', at_ms=0, level_db=level_db, wav_b64=wav, **kw)


def _normal(samples: np.ndarray, _rate: int) -> np.ndarray:
    return samples


def _severe(samples: np.ndarray, rate: int) -> np.ndarray:
    return hearing_loss(samples, rate, severity=1.0)


def test_describes_sound_not_firmware_id() -> None:
    [heard] = listen([_cue('occlusion', 600, 3, 0.2, 70)], _normal)
    assert heard.description == '3 loud low-pitched beeps'
    assert heard.wav_b64 is not None


def test_key_clicks_are_counted_once() -> None:
    [heard] = listen([_cue('keypad', 2700, 1, 0.03, 50)] * 4, _normal)
    assert heard.description == 'a high-pitched click (x4)'


def test_severe_loss_misses_quiet_high_pitched_sounds() -> None:
    click, alarm = listen(
        [_cue('keypad', 2700, 1, 0.03, 50), _cue('occlusion', 600, 3, 0.2, 80)], _severe
    )
    assert (click.description, click.wav_b64) == (None, None)
    assert alarm.description == '3 faint low-pitched beeps'


def test_vibration_is_felt_regardless_of_hearing() -> None:
    silent = AudioCue(id='occlusion', priority='high', at_ms=0, level_db=0, vibrate=True)
    [heard] = listen([silent], _severe)
    assert heard.description == 'the pump vibrating'
