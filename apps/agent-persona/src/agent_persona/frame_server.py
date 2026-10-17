"""Per-agent frame WebSocket.

The visualizer connects directly here (never through Redis or the driver) for
the *selected* agent only. Protocol:

* binary message — JPEG of the degraded frame, exactly what the model saw
* text message   — JSON ``{"type": "meta", "step", "reasoning", "audio"}``

New connections immediately receive the latest frame + meta.
"""

import asyncio
import contextlib
import io
import json
import logging
from typing import TYPE_CHECKING, Any

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

if TYPE_CHECKING:
    from PIL import Image

log = logging.getLogger(__name__)


class FrameServer:
    def __init__(self) -> None:
        self._clients: set[ServerConnection] = set()
        self._latest_jpeg: bytes | None = None
        self._latest_meta: str | None = None
        self._server: Server | None = None

    async def start(self, host: str, port: int) -> None:
        self._server = await serve(self._handler, host, port, max_size=1024)
        log.info('frame server on %s:%d', host, port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handler(self, ws: ServerConnection) -> None:
        self._clients.add(ws)
        try:
            if self._latest_jpeg is not None:
                await ws.send(self._latest_jpeg)
            if self._latest_meta is not None:
                await ws.send(self._latest_meta)
            await ws.wait_closed()
        finally:
            self._clients.discard(ws)

    async def publish(self, frame: Image.Image, meta: dict[str, Any]) -> None:
        buf = io.BytesIO()
        frame.save(buf, format='JPEG', quality=80)
        self._latest_jpeg = buf.getvalue()
        self._latest_meta = json.dumps({'type': 'meta', **meta})
        for ws in list(self._clients):
            with contextlib.suppress(ConnectionClosed):
                await ws.send(self._latest_jpeg)
                await ws.send(self._latest_meta)

    async def __aenter__(self) -> FrameServer:
        return self

    async def __aexit__(self, *_: object) -> None:
        await asyncio.shield(self.stop())
