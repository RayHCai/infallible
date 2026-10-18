"""Firmware host + per-instance emulator interface.

The per-instance protocol is the same one a future real-pump adapter would
implement: ``input`` / ``frame`` / ``state`` / ``reset`` (+ ``configure`` for
before/after re-runs). It is carried as JSON over a WebSocket.
"""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract

# --- host service (allocates N isolated instances) ------------------------- #


class AllocateRequest(Contract):
    run_id: UUID
    n: int = Field(ge=1, le=64)


class AllocateResponse(Contract):
    endpoints: list[str] = Field(description='host:port per instance, one per agent.')


class ReleaseRequest(Contract):
    run_id: UUID


# --- per-instance protocol -------------------------------------------------- #


class FirmwareInput(Contract):
    event: Literal['press', 'release', 'turn']
    target: str = Field(description='Button or dial id.')
    steps: int = 0
    at_ms: int | None = Field(default=None, description='Client timestamp, ms since epoch.')


class FirmwareState(Contract):
    screen: str
    bolus_units: float
    pending_bolus_units: float
    basal_rate: float
    reservoir_units: float
    battery_pct: int
    alarms: list[str]
    visited: list[str] = Field(
        default_factory=list, description='Screens shown since reset, in first-visit order.'
    )
    extra: dict[str, Any] = Field(default_factory=dict)


class AudioCue(Contract):
    """One sound (and/or vibration) the device emitted."""

    id: str = Field(
        description='keypad, delivery_start, occlusion, ... Traces only; never shown to the agent.'
    )
    priority: Literal['high', 'medium', 'low', 'info']
    at_ms: int = Field(description='Device time since reset.')
    level_db: float = Field(description='Peak level at the user, dBA; 0 when silent.')
    vibrate: bool = False
    wav_b64: str | None = Field(default=None, description='Mono 16-bit PCM WAV; null when silent.')


class FirmwareFrame(Contract):
    png_b64: str
    width: int
    height: int
    audio: list[AudioCue] = Field(default_factory=list, description='Cues since last frame.')


class _InputOp(Contract):
    op: Literal['input'] = 'input'
    input: FirmwareInput


class _FrameOp(Contract):
    op: Literal['frame'] = 'frame'


class _StateOp(Contract):
    op: Literal['state'] = 'state'


class _ResetOp(Contract):
    op: Literal['reset'] = 'reset'
    initial_state: dict[str, Any] = Field(default_factory=dict)


class _ConfigureOp(Contract):
    op: Literal['configure'] = 'configure'
    patch: dict[str, Any]


FirmwareRequest = Annotated[
    _InputOp | _FrameOp | _StateOp | _ResetOp | _ConfigureOp,
    Field(discriminator='op'),
]


class FirmwareResponse(Contract):
    ok: bool
    error: str | None = None
    state: FirmwareState | None = None
    frame: FirmwareFrame | None = None
