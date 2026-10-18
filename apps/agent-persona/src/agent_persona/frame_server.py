"""Per-agent frame WebSocket.

The visualizer connects directly here (never through Redis or the driver).

``/`` — viewer, for the *selected* agent only:

* binary message — JPEG of the degraded frame, exactly what the model saw
* text message   — JSON ``{"type": "meta", "step", "reasoning", "snapshot", "audio"}``;
  ``audio`` is what the persona heard: ``[{"heard", "wav_b64"}]``, already degraded

New viewers immediately receive the latest frame + meta.

``/render`` — the visualizer's snapshot renderer: receives ``RenderRequest``,
answers ``RenderReply`` (the 3D scene from the agent's eye).
"""

import asyncio
import contextlib
import io
import json
import logging
from typing import TYPE_CHECKING, Any

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from infallible_contracts import RenderReply, RenderRequest

if TYPE_CHECKING:
    from PIL import Image

log = logging.getLogger(__name__)

RENDER_PATH = '/render'
# Replies carry a base64 PNG frame.
MAX_MESSAGE_BYTES = 16 * 1024 * 1024


class RendererUnavailableError(RuntimeError):
    pass


class _RendererGoneError(Exception):
    """The socket a request went out on closed; retry on its replacement."""


class FrameServer:
    def __init__(self) -> None:
        self._clients: set[ServerConnection] = set()
        self._latest_jpeg: bytes | None = None
        self._latest_meta: str | None = None
        self._server: Server | None = None
        self._renderer: ServerConnection | None = None
        self._renderer_ready = asyncio.Event()
        # Request id -> (socket it was sent on, reply future).
        self._pending: dict[int, tuple[ServerConnection, asyncio.Future[RenderReply]]] = {}
        self._next_id = 0

    async def start(self, host: str, port: int) -> None:
        self._server = await serve(self._handler, host, port, max_size=MAX_MESSAGE_BYTES)
        log.info('frame server on %s:%d', host, port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handler(self, ws: ServerConnection) -> None:
        if ws.request is not None and ws.request.path == RENDER_PATH:
            await self._serve_renderer(ws)
            return
        self._clients.add(ws)
        try:
            if self._latest_jpeg is not None:
                await ws.send(self._latest_jpeg)
            if self._latest_meta is not None:
                await ws.send(self._latest_meta)
            await ws.wait_closed()
        finally:
            self._clients.discard(ws)

    async def _serve_renderer(self, ws: ServerConnection) -> None:
        # Latest connection wins: a reloaded visualizer replaces the old one.
        self._renderer = ws
        self._renderer_ready.set()
        log.info('renderer connected')
        try:
            async for message in ws:
                reply = RenderReply.model_validate_json(message)
                entry = self._pending.pop(reply.id, None)
                if entry is not None and not entry[1].done():
                    entry[1].set_result(reply)
        except ConnectionClosed:
            pass
        finally:
            if self._renderer is ws:
                self._renderer = None
                self._renderer_ready.clear()
            # Also when already replaced: requests sent here will never be answered.
            for sent_on, future in self._pending.values():
                if sent_on is ws and not future.done():
                    future.set_exception(_RendererGoneError())
            log.info('renderer disconnected')

    async def render(self, request: RenderRequest, timeout_s: float) -> RenderReply:
        """Ask the connected visualizer for a snapshot; waits for it to connect, and
        retries if its socket is replaced mid-request (the visualizer reconnects
        whenever the run's agent list changes). The request's ``id`` is assigned here."""
        try:
            async with asyncio.timeout(timeout_s):
                while True:
                    await self._renderer_ready.wait()
                    ws = self._renderer
                    if ws is None:
                        continue
                    try:
                        return await self._request(ws, request)
                    except _RendererGoneError, ConnectionClosed:
                        continue
        except TimeoutError as exc:
            raise RendererUnavailableError(
                f'no snapshot from the visualizer within {timeout_s:g}s; is it open on this run?'
            ) from exc

    async def _request(self, ws: ServerConnection, request: RenderRequest) -> RenderReply:
        self._next_id += 1
        request = request.model_copy(update={'id': self._next_id})
        future: asyncio.Future[RenderReply] = asyncio.get_running_loop().create_future()
        self._pending[request.id] = (ws, future)
        try:
            await ws.send(request.model_dump_json())
            return await future
        finally:
            self._pending.pop(request.id, None)

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
