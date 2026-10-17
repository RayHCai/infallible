from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class HostSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='FIRMWARE_', env_file='.env', extra='ignore')

    host: str = '127.0.0.1'
    port: int = 8100
    # Emulator instances bind here; agents dial `advertise_host:<port>`.
    instance_bind_host: str = '127.0.0.1'
    advertise_host: str = '127.0.0.1'
    instance_port_start: int = 8200
    max_instances: int = 32
    config_path: Path | None = None
    startup_timeout_s: float = 10.0
    log_level: str = 'INFO'
