from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

type FirmwareMode = Literal['hosted', 'local']
type Effort = Literal['low', 'medium', 'high', 'xhigh', 'max']


class DriverSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='DRIVER_', env_file='.env', extra='ignore')

    host: str = '127.0.0.1'
    port: int = 8000
    # Encoded into the QR code — must be reachable from the phone (use the LAN IP).
    public_url: str = 'http://localhost:8000'
    cors_origins: list[str] = Field(
        default=['http://localhost:1420', 'tauri://localhost', 'http://tauri.localhost']
    )

    data_dir: Path = Path('data')
    db_path: Path = Path('.state/driver.sqlite3')
    redis_url: str = 'redis://localhost:6379/0'

    # Firmware: "hosted" asks the Pi/compose firmware host for N instances;
    # "local" makes every agent spawn its own private emulator copy.
    firmware_mode: FirmwareMode = 'hosted'
    firmware_host_url: str = 'http://localhost:8100'

    agent_count: int = Field(default=5, ge=1, le=32)
    agent_bind_host: str = '127.0.0.1'
    agent_advertise_host: str = '127.0.0.1'
    agent_frame_port_start: int = 8300

    build_timeout_s: float = 120.0
    # XREADGROUP block time for the events collector; 0 = non-blocking poll.
    event_block_ms: int = Field(default=2_000, ge=0)
    max_upload_frames: int = 120

    evaluator_model: str = 'claude-opus-5-5'
    evaluator_effort: Effort = 'high'
    evaluator_max_tokens: int = 16000
    summarizer_model: str = 'claude-haiku-4-5'

    log_level: str = 'INFO'


@lru_cache
def get_settings() -> DriverSettings:
    return DriverSettings()
