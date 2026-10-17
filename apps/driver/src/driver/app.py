"""FastAPI application factory + service wiring (composition root)."""

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

from anthropic import AsyncAnthropic
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from driver.api import routes, ws
from driver.db.database import Database
from driver.object_builder import ObjectBuilder
from driver.pipeline.evaluator import Evaluator
from driver.pipeline.run_manager import (
    InvalidRunStateError,
    RunConflictError,
    RunManager,
    RunNotFoundError,
)
from driver.services.broadcaster import Broadcaster
from driver.services.firmware_host import FirmwareHostClient
from driver.services.launcher import AgentLauncher, SubprocessLauncher
from driver.settings import DriverSettings, get_settings
from infallible_contracts.paths import DataLayout

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Services:
    settings: DriverSettings
    db: Database
    redis: Redis
    broadcaster: Broadcaster
    firmware: FirmwareHostClient
    runs: RunManager


def create_app(
    settings: DriverSettings | None = None,
    *,
    redis: Redis | None = None,
    launcher: AgentLauncher | None = None,
    anthropic: AsyncAnthropic | None = None,
) -> FastAPI:
    """Build the app. Keyword overrides exist for tests (fakeredis, fake launcher)."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        layout = DataLayout(settings.data_dir)
        for d in (layout.tasks_dir, layout.personas_dir, layout.runs_dir):
            d.mkdir(parents=True, exist_ok=True)

        db = await Database.open(settings.db_path)
        if failed := await db.fail_unfinished_runs():
            log.warning('marked %d interrupted run(s) as failed', failed)
        r = redis or Redis.from_url(settings.redis_url)
        broadcaster = Broadcaster()
        firmware = FirmwareHostClient(settings.firmware_mode, settings.firmware_host_url)
        runs = RunManager(
            settings=settings,
            db=db,
            redis=r,
            broadcaster=broadcaster,
            builder=ObjectBuilder(layout, settings.build_timeout_s),
            firmware=firmware,
            launcher=launcher or SubprocessLauncher(),
            evaluator=Evaluator(
                anthropic or AsyncAnthropic(),
                settings.evaluator_model,
                settings.evaluator_effort,
                settings.evaluator_max_tokens,
            ),
        )
        app.state.services = Services(settings, db, r, broadcaster, firmware, runs)
        try:
            yield
        finally:
            await runs.shutdown()
            await firmware.aclose()
            await r.aclose()
            await db.close()

    app = FastAPI(title='Infallible driver', version='0.1.0', lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=['GET', 'POST'],
        allow_headers=['*'],
    )

    @app.exception_handler(RunConflictError)
    async def _conflict(_: Request, exc: RunConflictError) -> JSONResponse:
        return JSONResponse(
            {'detail': 'a run is already active', 'run_id': str(exc)}, status.HTTP_409_CONFLICT
        )

    @app.exception_handler(InvalidRunStateError)
    async def _bad_state(_: Request, exc: InvalidRunStateError) -> JSONResponse:
        return JSONResponse({'detail': str(exc)}, status.HTTP_409_CONFLICT)

    @app.exception_handler(RunNotFoundError)
    async def _not_found(_: Request, exc: RunNotFoundError) -> JSONResponse:
        return JSONResponse({'detail': f'no active run {exc}'}, status.HTTP_404_NOT_FOUND)

    @app.get('/healthz', tags=['ops'])
    async def healthz(request: Request) -> dict[str, str]:
        services: Services = request.app.state.services
        await services.redis.ping()
        return {'status': 'ok'}

    app.include_router(routes.router)
    app.include_router(ws.router)
    return app
