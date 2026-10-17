from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import Field
from pydantic_settings import BaseSettings, CliApp, SettingsConfigDict

type Effort = Literal['low', 'medium', 'high', 'xhigh', 'max']


class AgentSettings(BaseSettings):
    """Per-process config. The driver passes run-specific values as CLI flags;
    model/tuning knobs come from ``AGENT_*`` env vars."""

    model_config = SettingsConfigDict(
        env_prefix='AGENT_', env_file='.env', extra='ignore', cli_kebab_case=True
    )

    run_id: UUID
    agent_id: UUID
    persona_id: UUID
    mesh_path: Path
    firmware_endpoint: str = Field(description="host:port, or 'local' to spawn a private copy.")
    redis_url: str = 'redis://localhost:6379/0'

    data_dir: Path = Path('data')
    frame_bind_host: str = '127.0.0.1'
    frame_port: int
    frame_advertise_host: str = '127.0.0.1'

    planner_model: str = 'claude-sonnet-5-5'
    planner_effort: Effort = 'low'
    planner_max_tokens: int = 8000
    history_window: int = Field(default=8, ge=0)

    # Jev readability checks on the degraded frame; off = every seen label is readable.
    perception_jev: bool = True
    perception_model: str = 'jev-1.14.0'
    perception_read_threshold: float = Field(default=0.3, ge=0, le=1)
    perception_min_in_frame: float = Field(default=0.5, ge=0, le=1)
    perception_min_contrast: float = Field(default=0.06, ge=0)

    log_level: str = 'INFO'

    @classmethod
    def from_cli(cls) -> AgentSettings:
        return CliApp.run(cls)
