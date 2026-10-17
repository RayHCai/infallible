"""Redis Stream payloads.

Streams (see ``infallible_contracts.streams`` for key helpers):

* ``run:{run_id}:tasks``  — driver -> agents, one :class:`TaskDispatch` per (agent, task).
* ``run:{run_id}:events`` — agents -> driver (+ visualizer via driver WS), :data:`AgentEvent`.
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract
from infallible_contracts.actions import Action
from infallible_contracts.task import Task


def _now() -> datetime:
    return datetime.now(UTC)


class TaskDispatch(Contract):
    type: Literal['task_dispatch'] = 'task_dispatch'
    run_id: UUID
    agent_id: UUID
    task_index: int
    task: Task


class _AgentEventBase(Contract):
    run_id: UUID
    agent_id: UUID
    at: datetime = Field(default_factory=_now)


class AgentReady(_AgentEventBase):
    type: Literal['agent_ready'] = 'agent_ready'
    frame_endpoint: str


class TaskStarted(_AgentEventBase):
    type: Literal['task_started'] = 'task_started'
    task_id: UUID


class ActionEvent(_AgentEventBase):
    type: Literal['action'] = 'action'
    task_id: UUID
    step: int
    options: list[str]
    chosen: Action
    reasoning: str = ''
    state_after: dict[str, Any] = Field(default_factory=dict)
    trace_path: str


class TaskDone(_AgentEventBase):
    type: Literal['task_done'] = 'task_done'
    task_id: UUID
    steps: int
    declared_done: bool = Field(description='False when max_steps was hit.')
    final_state: dict[str, Any]


class AgentError(_AgentEventBase):
    type: Literal['agent_error'] = 'agent_error'
    task_id: UUID | None = None
    message: str


AgentEvent = Annotated[
    AgentReady | TaskStarted | ActionEvent | TaskDone | AgentError,
    Field(discriminator='type'),
]
