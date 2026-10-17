import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from fakeredis import FakeAsyncRedis
from fastapi.testclient import TestClient

from driver.app import create_app
from driver.settings import DriverSettings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from driver.services.launcher import AgentSpec, ExitCallback

REPO_DATA = Path(__file__).resolve().parents[3] / 'data'


class FakeLauncher:
    def __init__(self) -> None:
        self.spawned: list[AgentSpec] = []
        self.stopped = False

    async def spawn(self, spec: AgentSpec, on_exit: ExitCallback) -> None:
        self.spawned.append(spec)

    async def stop_all(self) -> None:
        self.stopped = True


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    data = tmp_path / 'data'
    for sub in ('tasks', 'personas'):
        shutil.copytree(REPO_DATA / sub, data / sub)
    return data


@pytest.fixture
def settings(tmp_path: Path, data_dir: Path) -> DriverSettings:
    return DriverSettings(
        data_dir=data_dir,
        db_path=tmp_path / 'driver.sqlite3',
        firmware_mode='local',
        agent_count=2,
        build_timeout_s=5,
        event_block_ms=0,  # fakeredis blocks the event loop on XREAD BLOCK
    )


@pytest.fixture
def launcher() -> FakeLauncher:
    return FakeLauncher()


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    r = FakeAsyncRedis()
    yield r
    await r.aclose()


@pytest.fixture
def client(
    settings: DriverSettings, launcher: FakeLauncher, redis: FakeAsyncRedis
) -> Iterator[TestClient]:
    app = create_app(settings, redis=redis, launcher=launcher)
    with TestClient(app) as c:
        yield c
