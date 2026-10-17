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
    extra: dict[str, Any] = Field(default_factory=dict)


class FirmwareFrame(Contract):
    png_b64: str
    width: int
    height: int
    audio: list[str] = Field(default_factory=list, description='Audio cue ids since last frame.')


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
