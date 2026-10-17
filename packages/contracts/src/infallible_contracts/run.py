from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract


class RunState(StrEnum):
    PREP = 'prep'
    BUILD = 'build'
    CONNECT = 'connect'
    RUNNING = 'running'
    EVALUATING = 'evaluating'
    COMPLETED = 'completed'
    STOPPED = 'stopped'
    FAILED = 'failed'

    @property
    def is_terminal(self) -> bool:
        return self in {RunState.COMPLETED, RunState.STOPPED, RunState.FAILED}


class BuildSource(StrEnum):
    SCAN = 'scan'
    FALLBACK = 'fallback'


class Run(Contract):
    id: UUID
    state: RunState
    current_task_index: int = 0


class Agent(Contract):
    id: UUID
    run_id: UUID
    persona_id: UUID
    firmware_endpoint: str = Field(description="host:port, or 'local' for a private emulator.")
    frame_endpoint: str = Field(description="host:port of the agent's frame WebSocket.")


class Interaction(Contract):
    id: UUID
    agent_id: UUID
    task_id: UUID
    step: int = Field(ge=0)
    options: list[str]
    chosen: str
    timestamp: datetime
    trace_path: str


class TaskOutcome(StrEnum):
    PASSED = 'passed'
    FAILED = 'failed'
    ERRORED = 'errored'


class TaskResult(Contract):
    agent_id: UUID
    task_id: UUID
    outcome: TaskOutcome
    steps: int
    final_state: dict[str, Any]
