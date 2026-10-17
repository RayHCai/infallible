"""Firmware host HTTP service (runs on the Raspberry Pi, or in compose)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status

from firmware.host.pool import InstancePool, PoolExhaustedError
from firmware.host.settings import HostSettings
from infallible_contracts import AllocateRequest, AllocateResponse, ReleaseRequest


def get_pool(request: Request) -> InstancePool:
    pool: InstancePool = request.app.state.pool
    return pool


PoolDep = Annotated[InstancePool, Depends(get_pool)]


def create_app(settings: HostSettings | None = None) -> FastAPI:
    settings = settings or HostSettings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.pool = InstancePool(settings)
        try:
            yield
        finally:
            await app.state.pool.shutdown()

    app = FastAPI(title='Infallible firmware host', version='0.1.0', lifespan=lifespan)

    @app.get('/healthz')
    async def healthz(pool: PoolDep) -> dict[str, int | str]:
        return {'status': 'ok', 'instances': pool.in_use, 'capacity': settings.max_instances}

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
