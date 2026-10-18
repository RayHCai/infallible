"""Driver HTTP API request/response bodies."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract
from infallible_contracts.run import Run, RunState


class QrPayload(Contract):
    """What the visualizer's QR code encodes and the scanner decodes."""

    run_id: UUID
    driver_url: str


class StartResponse(Contract):
    run_id: UUID
    state: RunState
    qr: QrPayload
    qr_png_b64: str


class RunListing(Contract):
    """A saved run, for the visualizer's previous-runs list."""

    run: Run
    created_at: datetime
    passed: int
    total: int = Field(description='Scored (agent, task) pairs.')


class StopRequest(Contract):
    run_id: UUID


class BuildAccepted(Contract):
    run_id: UUID
    frames_received: int


class Device(Contract):
    """A pump attached to the driver's machine."""

    id: UUID
    name: str
    port: str


class ConnectRequest(Contract):
    device_id: UUID | None = Field(
        default=None, description='Physical pump id; null means emulators only.'
    )


class ConnectResponse(Contract):
    run_id: UUID
    firmware_endpoints: list[str]
