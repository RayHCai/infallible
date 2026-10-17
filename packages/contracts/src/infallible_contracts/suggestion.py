from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract


class SuggestionCategory(StrEnum):
    HARDWARE = 'hardware'
    FIRMWARE = 'firmware'
    INTERACTION = 'interaction'


class ChangeType(StrEnum):
    """Small, closed set so the visualizer can animate every proposal."""

    MOVE_BUTTON = 'move_button'
    RESIZE_BUTTON = 'resize_button'
    RELABEL = 'relabel'
    RESIZE_TEXT = 'resize_text'
    CONFIRM_DIALOG = 'confirm_dialog'
    CHANGE_TIMEOUT = 'change_timeout'
    ADD_AUDIO_CUE = 'add_audio_cue'


class Evidence(Contract):
    agent_id: UUID
    task_id: UUID
    step: int


class ProposedChange(Contract):
    type: ChangeType
    params: dict[str, Any] = Field(default_factory=dict)


class Suggestion(Contract):
    id: UUID
    category: SuggestionCategory
    title: str
    rationale: str
    evidence: list[Evidence]
    proposed_change: ProposedChange


class SuggestionsFile(Contract):
    """Shape of ``data/runs/{run_id}/suggestions.json``."""

    suggestions: list[Suggestion]
