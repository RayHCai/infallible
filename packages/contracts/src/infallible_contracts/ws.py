"""Driver -> visualizer WebSocket messages (``GET /ws``)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract
from infallible_contracts.events import AgentEvent
from infallible_contracts.run import BuildSource, Run, TaskOutcome


class RunStateMessage(Contract):
    type: Literal['run_state'] = 'run_state'
    run: Run


class BuildProgressMessage(Contract):
    type: Literal['build_progress'] = 'build_progress'
    run_id: UUID
    stage: str
    progress: float = Field(ge=0, le=1)


class BuildDoneMessage(Contract):
    type: Literal['build_done'] = 'build_done'
    run_id: UUID
    source: BuildSource
    mesh_url: str


class AgentEventMessage(Contract):
    type: Literal['agent_event'] = 'agent_event'
    event: AgentEvent


class TaskScoredMessage(Contract):
    type: Literal['task_scored'] = 'task_scored'
    run_id: UUID
    agent_id: UUID
    task_id: UUID
    outcome: TaskOutcome


class SuggestionsReadyMessage(Contract):
    type: Literal['suggestions_ready'] = 'suggestions_ready'
    run_id: UUID
    count: int


DriverMessage = Annotated[
    RunStateMessage
    | BuildProgressMessage
    | BuildDoneMessage
    | AgentEventMessage
    | TaskScoredMessage
    | SuggestionsReadyMessage,
    Field(discriminator='type'),
]
