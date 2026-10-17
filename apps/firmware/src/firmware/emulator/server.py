"""One emulator instance = one process = one WebSocket server.

Speaks the per-instance protocol defined in ``infallible_contracts.firmware``.
The same port serves a pump GUI over plain HTTP, which mirrors the instance
through the push-only ``/watch`` socket.
"""

import asyncio
import http
import logging
import time
from importlib import resources
from typing import TYPE_CHECKING

from pydantic import TypeAdapter, ValidationError
from websockets.asyncio.server import ServerConnection, broadcast, serve

from firmware.emulator import display
from firmware.emulator.pump import Clock, PumpModel
from infallible_contracts import FirmwareInput, FirmwareRequest, FirmwareResponse

if TYPE_CHECKING:
    from websockets.http11 import Request, Response

    from firmware.emulator.config import PumpConfig

log = logging.getLogger(__name__)

_request_adapter: TypeAdapter[FirmwareRequest] = TypeAdapter(FirmwareRequest)
_GUI_HTML = resources.files('firmware.emulator').joinpath('pump.html').read_text('utf-8')
TICK_S = 0.1


def _serve_gui(connection: ServerConnection, request: Request) -> Response | None:
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return None
    if request.path.partition('?')[0] != '/':
        return connection.respond(http.HTTPStatus.NOT_FOUND, 'not found\n')
    response = connection.respond(http.HTTPStatus.OK, _GUI_HTML)
    del response.headers['Content-Type']
    response.headers['Content-Type'] = 'text/html; charset=utf-8'
    return response


class EmulatorServer:
    def __init__(self, config: PumpConfig, clock: Clock = time.monotonic) -> None:
        self.pump = PumpModel(config=config, clock=clock)
        self._lock = asyncio.Lock()
        self._viewers: set[ServerConnection] = set()
        self._last_snapshot = ''

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

    def snapshot(self) -> str:
        # Viewers must not drain audio cues: those belong to the agent's `frame` calls.
        frame = display.frame(self.pump, drain_audio=False)
        return FirmwareResponse(ok=True, state=self.pump.state(), frame=frame).model_dump_json()

    async def handle_viewer_input(self, raw: str | bytes) -> None:
        try:
            event = FirmwareInput.model_validate_json(raw)
        except ValidationError:
            return
        async with self._lock:
            self.pump.handle(event)

    async def _watch(self, ws: ServerConnection) -> None:
        async with self._lock:
            self._last_snapshot = self.snapshot()
            self._viewers.add(ws)
        try:
            await ws.send(self._last_snapshot)
            async for message in ws:
                await self.handle_viewer_input(message)
        finally:
            self._viewers.discard(ws)

    async def _connection(self, ws: ServerConnection) -> None:
        if ws.request is not None and ws.request.path == '/watch':
            await self._watch(ws)
            return
        async for message in ws:
            response = await self.handle_request(message)
            await ws.send(response.model_dump_json())

    async def _ticker(self) -> None:
        while True:
            async with self._lock:
                self.pump.tick()
                if self._viewers and (snapshot := self.snapshot()) != self._last_snapshot:
                    self._last_snapshot = snapshot
                    broadcast(self._viewers, snapshot)
            await asyncio.sleep(TICK_S)

    async def serve(self, host: str, port: int) -> None:
        async with (
            serve(self._connection, host, port, process_request=_serve_gui) as server,
            asyncio.TaskGroup() as tg,
        ):
            tg.create_task(self._ticker())
            log.info(
                'pump emulator listening on %s:%d (GUI at http://%s:%d/)', host, port, host, port
            )
            await server.serve_forever()
