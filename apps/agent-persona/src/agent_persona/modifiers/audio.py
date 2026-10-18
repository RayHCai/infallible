from typing import Any

import numpy as np


def hearing_loss(samples: np.ndarray, rate: int, severity: float = 0.5, **_: Any) -> np.ndarray:
    """Age-related (sloping, high-frequency) loss applied to the waveform.

    ``severity`` in [0, 1]; 1 is a severe presbycusis audiogram: 25 dB HL at
    250 Hz falling to 80 dB HL at 4 kHz and above.
    """
    freqs = np.fft.rfftfreq(len(samples), 1 / rate)
    gain = 10 ** (-loss_db(freqs, severity) / 20)
    return np.fft.irfft(np.fft.rfft(samples) * gain, n=len(samples))


def loss_db(freqs: np.ndarray, severity: float) -> np.ndarray:
    octaves_above_250: np.ndarray = np.clip(np.log2(np.maximum(freqs, 1) / 250), 0, 4)
    return severity * (25 + 55 * octaves_above_250 / 4)
