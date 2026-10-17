"""Firmware host HTTP service (runs on the Raspberry Pi, or in compose)."""

import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import resources
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse

from firmware.host.pool import InstancePool, PoolExhaustedError
from firmware.host.settings import HostSettings
from infallible_contracts import AllocateRequest, AllocateResponse, ReleaseRequest

MANUAL_RUN_ID = UUID(int=0)
_GRID_HTML = resources.files('firmware.host').joinpath('grid.html').read_text('utf-8')


def get_pool(request: Request) -> InstancePool:
    pool: InstancePool = request.app.state.pool
    return pool


PoolDep = Annotated[InstancePool, Depends(get_pool)]


def create_app(settings: HostSettings | None = None, *, spawn: int = 0) -> FastAPI:
    """``spawn`` pre-starts that many pumps outside any driver run, for manual use."""
    settings = settings or HostSettings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.pool = InstancePool(settings)
        try:
            if spawn:
                await app.state.pool.allocate(MANUAL_RUN_ID, spawn)
            yield
        finally:
            await app.state.pool.shutdown()

    app = FastAPI(title='Infallible firmware host', version='0.1.0', lifespan=lifespan)

    @app.get('/', response_class=HTMLResponse)
    async def grid() -> str:
        return _GRID_HTML

    @app.get('/healthz')
    async def healthz(pool: PoolDep) -> dict[str, int | str]:
        return {
            'status': 'ok',
            'name': socket.gethostname(),
            'instances': pool.in_use,
            'capacity': settings.max_instances,
        }

    @app.get('/instances')
    async def instances(pool: PoolDep) -> list[dict[str, UUID | int]]:
        return [{'run_id': run_id, 'port': port} for run_id, port in pool.ports()]

    @app.post('/allocate')
    async def allocate(body: AllocateRequest, pool: PoolDep) -> AllocateResponse:
        try:
            endpoints = await pool.allocate(body.run_id, body.n)
        except PoolExhaustedError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
        return AllocateResponse(endpoints=endpoints)

    @app.post('/release', status_code=status.HTTP_204_NO_CONTENT)
    async def release(body: ReleaseRequest, pool: PoolDep) -> None:
        await pool.release(body.run_id)

    return app
