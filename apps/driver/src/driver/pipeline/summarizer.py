"""Per-task Claude call -> a short recap of what the agent did, shown in the visualizer."""

import json
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic

    from infallible_contracts import ActionEvent, Persona, Task, TaskOutcome

log = logging.getLogger(__name__)

MAX_WORDS = 50

# Asks for fewer words than MAX_WORDS: the model overshoots, and the hard cap cuts mid-sentence.
SYSTEM_PROMPT = """\
You summarize one simulated usability test of an insulin pump. A persona (a simulated user
with a specific age and perceptual/motor limitations) attempted a task by emitting actions.
You receive the persona, the task, every action with the persona's reasoning, and the outcome.

In two or three short sentences (under 40 words), say what the persona did, where they
hesitated or went wrong, and how the attempt ended. Refer to the persona by name. Plain prose,
no lists or headings.
"""


class Summarizer:
    def __init__(self, client: AsyncAnthropic, model: str) -> None:
        self._client = client
        self._model = model

    async def summarize(
        self,
        persona: Persona | None,
        task: Task,
        actions: list[ActionEvent],
        outcome: TaskOutcome,
        reason: str | None,
    ) -> str | None:
        context = {
            'persona': persona.model_dump(mode='json') if persona else None,
            'task': task.model_dump(mode='json'),
            'actions': [
                {
                    'step': a.step,
                    'action': a.chosen.model_dump(mode='json'),
                    'reasoning': a.reasoning,
                }
                for a in actions
            ],
            'outcome': outcome,
            'reason': reason,
        }
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=256,
            system=SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': json.dumps(context)}],
        )
        text = ' '.join(b.text for b in response.content if b.type == 'text').strip()
        if response.stop_reason == 'refusal' or not text:
            log.warning('summarizer returned no text (stop_reason=%s)', response.stop_reason)
            return None
        words = text.split()
        # The prompt asks for the limit; this guarantees it.
        return text if len(words) <= MAX_WORDS else ' '.join(words[:MAX_WORDS]) + '…'
