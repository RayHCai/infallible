"""Process pool: one emulator *process* per agent, so no state can leak between them."""

import asyncio
import logging
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from uuid import UUID

    from firmware.host.settings import HostSettings

log = logging.getLogger(__name__)


class PoolExhaustedError(RuntimeError):
    pass


@dataclass(slots=True)
class Instance:
    port: int
    process: asyncio.subprocess.Process


class InstancePool:
    def __init__(self, settings: HostSettings) -> None:
        self._s = settings
        self._by_run: dict[UUID, list[Instance]] = {}
        self._lock = asyncio.Lock()

    @property
    def in_use(self) -> int:
        return sum(len(v) for v in self._by_run.values())

    def ports(self) -> list[tuple[UUID, int]]:
        return [(run_id, i.port) for run_id, insts in self._by_run.items() for i in insts]

    def _free_ports(self) -> list[int]:
        used = {i.port for insts in self._by_run.values() for i in insts}
        first = self._s.instance_port_start
        return [p for p in range(first, first + self._s.max_instances) if p not in used]

    async def allocate(self, run_id: UUID, n: int) -> list[str]:
        async with self._lock:
            if run_id in self._by_run:
                return [self._endpoint(i.port) for i in self._by_run[run_id]]
            free = self._free_ports()
            if len(free) < n:
                raise PoolExhaustedError(f'requested {n}, only {len(free)} free')
            instances = [await self._spawn(port) for port in free[:n]]
            self._by_run[run_id] = instances
        await asyncio.gather(*(self._wait_ready(i.port) for i in instances))
        log.info('allocated %d emulator instances for run %s', n, run_id)
        return [self._endpoint(i.port) for i in instances]

    async def release(self, run_id: UUID) -> int:
        async with self._lock:
            instances = self._by_run.pop(run_id, [])
        await asyncio.gather(*(self._terminate(i) for i in instances))
        return len(instances)

    async def shutdown(self) -> None:
        for run_id in list(self._by_run):
            await self.release(run_id)

    def _endpoint(self, port: int) -> str:
        return f'{self._s.advertise_host}:{port}'

    async def _spawn(self, port: int) -> Instance:
        args = [
            "-m", "firmware.emulator",
            "--host", self._s.instance_bind_host,
            "--port", str(port),
        ]  # fmt: skip
        if self._s.config_path is not None:
            args += ['--config', str(self._s.config_path)]
        process = await asyncio.create_subprocess_exec(sys.executable, *args)
        return Instance(port=port, process=process)

    async def _wait_ready(self, port: int) -> None:
        deadline = asyncio.get_running_loop().time() + self._s.startup_timeout_s
        while True:
            try:
                _, writer = await asyncio.open_connection('127.0.0.1', port)
            except OSError:
                if asyncio.get_running_loop().time() > deadline:
                    raise TimeoutError(f'emulator on port {port} did not start') from None
                await asyncio.sleep(0.1)
            else:
                writer.close()
                await writer.wait_closed()
                return

    @staticmethod
    async def _terminate(instance: Instance) -> None:
        if instance.process.returncode is not None:
            return
        instance.process.terminate()
        try:
            await asyncio.wait_for(instance.process.wait(), timeout=5)
        except TimeoutError:
            instance.process.kill()
            await instance.process.wait()
