"""One emulator instance = one process = one WebSocket server.

Speaks the per-instance protocol defined in ``infallible_contracts.firmware``.
"""

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from pydantic import TypeAdapter, ValidationError
from websockets.asyncio.server import ServerConnection, serve

from firmware.emulator import display
from firmware.emulator.pump import Clock, PumpModel
from infallible_contracts import FirmwareRequest, FirmwareResponse

if TYPE_CHECKING:
    from firmware.emulator.config import PumpConfig

log = logging.getLogger(__name__)

_request_adapter: TypeAdapter[FirmwareRequest] = TypeAdapter(FirmwareRequest)
TICK_S = 0.1


class EmulatorServer:
    def __init__(self, config: PumpConfig, clock: Clock = time.monotonic) -> None:
        self.pump = PumpModel(config=config, clock=clock)
        self._lock = asyncio.Lock()

    async def handle_request(self, raw: str | bytes) -> FirmwareResponse:
        try:
            request = _request_adapter.validate_json(raw)
        except ValidationError as exc:
            return FirmwareResponse(ok=False, error=str(exc))

        async with self._lock:
            match request.op:
                case 'input':
                    self.pump.handle(request.input)
                case 'frame':
                    return FirmwareResponse(ok=True, frame=display.frame(self.pump))
                case 'state':
                    pass
                case 'reset':
                    self.pump.reset(request.initial_state)
                case 'configure':
                    try:
                        self.pump.reconfigure(request.patch)
                    except ValidationError as exc:
                        return FirmwareResponse(ok=False, error=str(exc))
            return FirmwareResponse(ok=True, state=self.pump.state())

    async def _connection(self, ws: ServerConnection) -> None:
        async for message in ws:
            response = await self.handle_request(message)
            await ws.send(response.model_dump_json())

    async def _ticker(self) -> None:
        while True:
            async with self._lock:
                self.pump.tick()
            await asyncio.sleep(TICK_S)

    async def serve(self, host: str, port: int) -> None:
        async with serve(self._connection, host, port) as server, asyncio.TaskGroup() as tg:
            tg.create_task(self._ticker())
            log.info('pump emulator listening on %s:%d', host, port)
            await server.serve_forever()
