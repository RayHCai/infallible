"""Spawns one ``agent-persona`` OS process per agent.

The ``AgentLauncher`` protocol is the seam for other placements (e.g. one
container per agent via the Docker API, or remote hosts) without touching the
pipeline.
"""

import asyncio
import logging
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pathlib import Path
    from uuid import UUID

    from infallible_contracts import Agent

log = logging.getLogger(__name__)

type ExitCallback = Callable[[UUID, int], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class AgentSpec:
    agent: Agent
    mesh_path: Path
    data_dir: Path
    redis_url: str
    frame_bind_host: str
    frame_port: int
    frame_advertise_host: str


class AgentLauncher(Protocol):
    async def spawn(self, spec: AgentSpec, on_exit: ExitCallback) -> None: ...
    async def stop_all(self) -> None: ...


class SubprocessLauncher:
    def __init__(self) -> None:
        self._procs: dict[UUID, asyncio.subprocess.Process] = {}
        self._watchers: set[asyncio.Task[None]] = set()
        self._stopping = False

    async def spawn(self, spec: AgentSpec, on_exit: ExitCallback) -> None:
        a = spec.agent
        self._stopping = False
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "agent_persona",
            "--run-id", str(a.run_id),
            "--agent-id", str(a.id),
            "--persona-id", str(a.persona_id),
            "--mesh-path", str(spec.mesh_path.resolve()),
            "--firmware-endpoint", a.firmware_endpoint,
            "--redis-url", spec.redis_url,
            "--data-dir", str(spec.data_dir.resolve()),
            "--frame-bind-host", spec.frame_bind_host,
            "--frame-port", str(spec.frame_port),
            "--frame-advertise-host", spec.frame_advertise_host,
        )  # fmt: skip
        self._procs[a.id] = proc
        watcher = asyncio.create_task(self._watch(a.id, proc, on_exit))
        self._watchers.add(watcher)
        watcher.add_done_callback(self._watchers.discard)
        log.info('spawned agent %s (pid %s)', a.id, proc.pid)

    async def _watch(
        self, agent_id: UUID, proc: asyncio.subprocess.Process, on_exit: ExitCallback
    ) -> None:
        code = await proc.wait()
        self._procs.pop(agent_id, None)
        if not self._stopping:
            log.warning('agent %s exited unexpectedly with code %s', agent_id, code)
            await on_exit(agent_id, code)

    async def stop_all(self) -> None:
        self._stopping = True
        procs = list(self._procs.values())
        for p in procs:
            if p.returncode is None:
                p.terminate()
        results = await asyncio.gather(
            *(asyncio.wait_for(p.wait(), timeout=5) for p in procs), return_exceptions=True
        )
        for p, result in zip(procs, results, strict=True):
            if isinstance(result, TimeoutError) and p.returncode is None:
                p.kill()
        self._procs.clear()
