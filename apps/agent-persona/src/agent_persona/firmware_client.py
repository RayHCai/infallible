"""Client for one firmware instance (hosted on the Pi, or a private local copy)."""

import asyncio
import contextlib
import json
import socket
import sys
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from websockets.asyncio.client import ClientConnection, connect

from infallible_contracts import FirmwareFrame, FirmwareInput, FirmwareResponse, FirmwareState

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

LOCAL = 'local'


class FirmwareError(RuntimeError):
    pass


class FirmwareClient:
    def __init__(self, ws: ClientConnection) -> None:
        self._ws = ws
        self._lock = asyncio.Lock()

    async def _call(self, payload: dict[str, Any]) -> FirmwareResponse:
        async with self._lock:
            await self._ws.send(json.dumps(payload))
            response = FirmwareResponse.model_validate_json(await self._ws.recv())
        if not response.ok:
            raise FirmwareError(response.error or 'firmware error')
        return response

    async def _state_call(self, payload: dict[str, Any]) -> FirmwareState:
        resp = await self._call(payload)
        if resp.state is None:
            raise FirmwareError(f'no state in response to {payload["op"]}')
        return resp.state

    async def input(self, event: FirmwareInput) -> FirmwareState:
        return await self._state_call({'op': 'input', 'input': event.model_dump(mode='json')})

    async def state(self) -> FirmwareState:
        return await self._state_call({'op': 'state'})

    async def reset(self, initial_state: dict[str, Any]) -> FirmwareState:
        return await self._state_call({'op': 'reset', 'initial_state': initial_state})

    async def frame(self) -> FirmwareFrame:
        resp = await self._call({'op': 'frame'})
        if resp.frame is None:
            raise FirmwareError('no frame in response')
        return resp.frame


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port: int = s.getsockname()[1]
        return port


@asynccontextmanager
async def _local_emulator() -> AsyncIterator[str]:
    """Local-copy mode: spawn a private emulator on spawn, kill it on exit."""
    port = _free_port()
    proc = await asyncio.create_subprocess_exec(
        sys.executable, '-m', 'firmware.emulator', '--host', '127.0.0.1', '--port', str(port)
    )
    try:
        yield f'127.0.0.1:{port}'
    finally:
        if proc.returncode is None:
            proc.terminate()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(proc.wait(), timeout=5)


async def _connect_with_retry(uri: str, attempts: int = 50) -> ClientConnection:
    for attempt in range(attempts):
        try:
            return await connect(uri, max_size=8 * 1024 * 1024)
        except OSError:
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(0.1)
    raise AssertionError('unreachable')


@asynccontextmanager
async def open_firmware(endpoint: str) -> AsyncIterator[FirmwareClient]:
    async with contextlib.AsyncExitStack() as stack:
        if endpoint == LOCAL:
            endpoint = await stack.enter_async_context(_local_emulator())
        ws = await _connect_with_retry(f'ws://{endpoint}')
        stack.push_async_callback(ws.close)
        yield FirmwareClient(ws)
