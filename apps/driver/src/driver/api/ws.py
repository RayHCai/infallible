"""``GET /ws`` — run-level state for the visualizer (pipeline step, per-agent events)."""

from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from driver.services.broadcaster import dump
from infallible_contracts import RunStateMessage

if TYPE_CHECKING:
    from driver.app import Services

router = APIRouter()


@router.websocket('/ws')
async def run_events(ws: WebSocket) -> None:
    services = cast('Services', ws.app.state.services)
    await ws.accept()
    # Snapshot first, so a (re)connecting client can rebuild state.
    if (active := services.runs.active) is not None:
        await ws.send_text(dump(RunStateMessage(run=active.run)))
    services.broadcaster.add(ws)
    try:
        while True:
            await ws.receive_text()  # client->server messages are ignored (keepalive)
    except WebSocketDisconnect:
        pass
    finally:
        services.broadcaster.remove(ws)
