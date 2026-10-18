from importlib import resources
from typing import TYPE_CHECKING, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from pathlib import Path


class UiConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')

    screen_width: int = 240
    screen_height: int = 160
    font_size: int = Field(default=16, ge=6, le=64)
    confirm_dialogs: bool = True
    menu_timeout_s: float = Field(default=30, gt=0)
    bolus_step_units: float = Field(default=0.1, gt=0)
    bolus_max_units: float = Field(default=25.0, gt=0)
    hold_repeat_after_ms: int = 600
    hold_repeat_every_ms: int = 120


class AudioConfig(BaseModel):
    """The pump's sound settings, as on the device's Sounds menu."""

    model_config = ConfigDict(extra='forbid')

    volume: float = Field(default=0.6, ge=0, le=1)
    mode: Literal['audio', 'vibrate', 'audio_vibrate'] = 'audio'
    keypad_sounds: bool = True
    # Unacknowledged alarms re-sound at these intervals (IEC 60601-1-8 burst intervals).
    high_repeat_s: float = Field(default=10, gt=0)
    medium_repeat_s: float = Field(default=30, gt=0)
    # Still unacknowledged after this: full volume, audible even in vibrate mode; null disables.
    escalate_after_s: float | None = Field(default=600, gt=0)


class PumpDefaults(BaseModel):
    model_config = ConfigDict(extra='forbid')

    basal_rate: float = 0.8
    reservoir_units: float = 180.0
    battery_pct: int = 90
    low_reservoir_units: float = 20.0


class FaultConfig(BaseModel):
    """Device failures modelled on common MAUDE problem codes."""

    model_config = ConfigDict(extra='forbid')

    # "Device Displays Incorrect Message": Home shows the bolus before the latest one.
    stale_bolus_display: bool = True
    # "Visual Prompts will not Clear": OK presses needed to dismiss an alarm.
    alarm_clear_presses: int = Field(default=2, ge=1)
    # "False Alarm": one spurious occlusion alarm this long after reset; null disables.
    false_alarm_after_s: float | None = Field(default=60, gt=0)
    # "No Audible Alarm": low reservoir alarm shows on screen but never beeps.
    silent_low_reservoir: bool = True


class PumpConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')

    model: str = 'generic-pump-v1'
    buttons: dict[str, str]
    ui: UiConfig = UiConfig()
    audio: AudioConfig = AudioConfig()
    defaults: PumpDefaults = PumpDefaults()
    faults: FaultConfig = FaultConfig()

    def patched(self, patch: dict[str, Any]) -> PumpConfig:
        """Deep-merge a partial config (used by proposed_change re-runs)."""
        return PumpConfig.model_validate(_deep_merge(self.model_dump(), patch))


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: Path | None = None) -> PumpConfig:
    if path is None:
        text = resources.files('firmware.configs').joinpath('default.yaml').read_text('utf-8')
    else:
        text = path.read_text(encoding='utf-8')
    return PumpConfig.model_validate(yaml.safe_load(text))
