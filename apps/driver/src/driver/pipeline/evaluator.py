"""Single Claude call at the end of a run -> ``suggestions.json``."""

import json
import logging
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, ValidationError

from infallible_contracts import (
    ChangeType,
    Evidence,
    ProposedChange,
    Suggestion,
    SuggestionCategory,
    SuggestionsFile,
)

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic

    from driver.settings import Effort
    from infallible_contracts import Interaction, MeshAnnotations, Persona, Task, TaskResult

log = logging.getLogger(__name__)

_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

SYSTEM_PROMPT = """\
You are a human-factors engineer reviewing simulated usability tests of an insulin pump.
Simulated users (personas with specific ages and perceptual/motor limitations) attempted
scenarios derived from FDA MAUDE failure reports. You receive the personas, the tasks,
every interaction step, the full traces of failed tasks, and the device's screen/button layout.

Propose concrete, minimal design changes that would have prevented the observed failures.
Each suggestion must cite evidence (agent_id, task_id, step) from the data and use one of
the allowed change types so it can be animated and re-tested. Prefer few high-impact
suggestions over many speculative ones.
"""


class _EvidenceDraft(BaseModel):
    agent_id: str
    task_id: str
    step: int


class _ChangeDraft(BaseModel):
    type: Literal[
        "move_button", "resize_button", "relabel", "resize_text",
        "confirm_dialog", "change_timeout", "add_audio_cue",
    ]  # fmt: skip
    params_json: str = Field(
        description='JSON object of change parameters, e.g. {"button_id": "ok", "dx": 0.1}'
    )


class _SuggestionDraft(BaseModel):
    category: Literal['hardware', 'firmware', 'interaction']
    title: str
    rationale: str
    evidence: list[_EvidenceDraft]
    proposed_change: _ChangeDraft


class _EvaluationDraft(BaseModel):
    suggestions: list[_SuggestionDraft]


def _to_contract(draft: _SuggestionDraft) -> Suggestion | None:
    try:
        params: Any = json.loads(draft.proposed_change.params_json or '{}')
        return Suggestion(
            id=uuid4(),
            category=SuggestionCategory(draft.category),
            title=draft.title,
            rationale=draft.rationale,
            evidence=[
                Evidence(agent_id=UUID(e.agent_id), task_id=UUID(e.task_id), step=e.step)
                for e in draft.evidence
            ],
            proposed_change=ProposedChange(
                type=ChangeType(draft.proposed_change.type),
                params=params if isinstance(params, dict) else {},
            ),
        )
    except ValueError, ValidationError:
        log.warning('dropping malformed suggestion %r', draft.title)
        return None


class Evaluator:
    def __init__(self, client: AsyncAnthropic, model: str, effort: Effort, max_tokens: int) -> None:
        self._client = client
        self._model = model
        self._effort = effort
        self._max_tokens = max_tokens

    async def evaluate(
        self,
        personas: list[Persona],
        tasks: list[Task],
        interactions: list[Interaction],
        results: list[TaskResult],
        failed_traces: dict[str, Any],
        annotations: MeshAnnotations | None,
    ) -> SuggestionsFile:
        context = {
            'personas': [p.model_dump(mode='json') for p in personas],
            'tasks': [t.model_dump(mode='json') for t in tasks],
            'results': [r.model_dump(mode='json') for r in results],
            'interactions': [i.model_dump(mode='json') for i in interactions],
            'failed_task_traces': failed_traces,
            'mesh_annotations': annotations.model_dump(mode='json') if annotations else None,
        }
        response = await self._client.messages.parse(
            model=self._model,
            max_tokens=self._max_tokens,
            system=SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': json.dumps(context)}],
            output_format=_EvaluationDraft,
            output_config={'effort': self._effort},
            extra_headers={'anthropic-beta': _FALLBACK_BETA},
            extra_body={'fallbacks': 'default'},
        )
        if response.stop_reason == 'refusal' or response.parsed_output is None:
            log.error('evaluator returned no output (stop_reason=%s)', response.stop_reason)
            return SuggestionsFile(suggestions=[])
        suggestions = [s for d in response.parsed_output.suggestions if (s := _to_contract(d))]
        return SuggestionsFile(suggestions=suggestions)
