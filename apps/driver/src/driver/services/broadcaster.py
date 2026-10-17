"""Fan-out of run-level state to every connected visualizer WebSocket."""

import asyncio
import contextlib
import logging
from typing import TYPE_CHECKING

from pydantic import TypeAdapter

from infallible_contracts import DriverMessage

if TYPE_CHECKING:
    from fastapi import WebSocket

log = logging.getLogger(__name__)

_adapter: TypeAdapter[DriverMessage] = TypeAdapter(DriverMessage)


def dump(message: DriverMessage) -> str:
    return _adapter.dump_json(message).decode()


class Broadcaster:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    def add(self, ws: WebSocket) -> None:
        self._clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def publish(self, message: DriverMessage) -> None:
        if not self._clients:
            return
        payload = dump(message)
        clients = list(self._clients)
        results = await asyncio.gather(
            *(c.send_text(payload) for c in clients), return_exceptions=True
        )
        for client, result in zip(clients, results, strict=True):
            if isinstance(result, Exception):
                log.debug('dropping WS client: %s', result)
                self._clients.discard(client)
                with contextlib.suppress(Exception):
                    await client.close()
