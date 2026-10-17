from importlib import resources
from typing import TYPE_CHECKING, Any

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


class PumpDefaults(BaseModel):
    model_config = ConfigDict(extra='forbid')

    basal_rate: float = 0.8
    reservoir_units: float = 180.0
    battery_pct: int = 90
    low_reservoir_units: float = 20.0


class PumpConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')

    model: str = 'generic-pump-v1'
    buttons: dict[str, str]
    ui: UiConfig = UiConfig()
    defaults: PumpDefaults = PumpDefaults()

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
