from typing import Any
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract


class Task(Contract):
    id: UUID
    name: str
    description: str = Field(description='What the user is trying to do, in their words.')
    goal: str = Field(description='Instruction given to the agent.')
    initial_state: dict[str, Any] = Field(
        default_factory=dict, description='Firmware reset state for this task.'
    )
    success: str = Field(
        description="Predicate over the final firmware state, e.g. 'bolus_units == 2.5'."
    )
    max_steps: int = Field(default=25, ge=1, le=500)


class TaskFile(Contract):
    """Shape of every ``data/tasks/*.yaml`` file."""

    tasks: list[Task]
