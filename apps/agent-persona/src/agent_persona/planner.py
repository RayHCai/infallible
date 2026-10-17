"""Claude decision step: given persona, task and the current (degraded) frame,
pick the action *this person* would most likely take — not the correct one."""

import base64
import io
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

from infallible_contracts import (
    Action,
    DoneAction,
    HoldAction,
    Persona,
    PressAction,
    ReadScreenAction,
    RotateViewAction,
    Task,
    TurnAction,
    WaitAction,
    ZoomAction,
)

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic
    from PIL import Image

    from agent_persona.settings import Effort

# Server-side refusal fallback (opt-in beta); see the claude-api skill notes.
_FALLBACK_BETA = 'server-side-fallback-2026-07-01'


class PlannedAction(BaseModel):
    """Flat on purpose: simple schemas are the most reliable structured outputs."""

    kind: Literal['press', 'hold', 'turn', 'rotate_view', 'zoom', 'wait', 'read_screen', 'done']
    target: str | None = Field(
        description='control handle (b1, b2, ...), dial id, or axis (x|y|z); null if unused'
    )
    amount: float | None = Field(
        description='ms for hold/wait, steps for turn, degrees for rotate_view, delta for zoom; null if unused'
    )

    def to_action(self) -> Action:
        target, amount = self.target or '', self.amount or 0.0
        match self.kind:
            case 'press':
                return PressAction(button_id=target)
            case 'hold':
                return HoldAction(button_id=target, ms=max(1, int(amount)))
            case 'turn':
                return TurnAction(dial=target, steps=int(amount))
            case 'rotate_view':
                axis = target if target in {'x', 'y', 'z'} else 'y'
                return RotateViewAction(axis=axis, deg=amount)  # type: ignore[arg-type]
            case 'zoom':
                return ZoomAction(delta=amount)
            case 'wait':
                return WaitAction(ms=max(0, int(amount)))
            case 'read_screen':
                return ReadScreenAction()
            case 'done':
                return DoneAction()


class PlannerDecision(BaseModel):
    options: list[str] = Field(description='Actions this person is considering, in their words.')
    reasoning: str = Field(description='One short line, first person, in character.')
    action: PlannedAction


class PlannerRefusalError(RuntimeError):
    pass


def build_system_prompt(persona: Persona) -> str:
    a = persona.attributes
    return (
        f'You are role-playing {persona.name}: {persona.description}\n'
        f'Age {a.age}, {a.gender}. {a.guiding_prompt}\n\n'
        'You are holding an insulin pump and trying to accomplish a goal with it. '
        'Each turn you see exactly what this person sees (vision limitations are already '
        'applied to the image). Choose the single next action this person would most '
        'plausibly take given their abilities, habits and confusion — not the correct or '
        'optimal action. Mistakes are expected and valuable.\n\n'
        'Each turn also lists the controls you can currently see or feel, by handle (b1, b2, ...). '
        'Only what is listed is known to you; moving the device may reveal more.\n'
        'Actions: press(handle), hold(handle, ms), turn(dial, steps), rotate_view(axis, deg), '
        'zoom(delta), wait(ms), read_screen, done (when you believe the goal is achieved).'
    )


def _png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return base64.standard_b64encode(buf.getvalue()).decode('ascii')


class Planner:
    def __init__(self, client: AsyncAnthropic, model: str, effort: Effort, max_tokens: int) -> None:
        self._client = client
        self._model = model
        self._effort = effort
        self._max_tokens = max_tokens

    async def decide(
        self,
        system_prompt: str,
        task: Task,
        frame: Image.Image,
        history: list[str],
        audio: list[str],
        controls: list[str],
    ) -> PlannerDecision:
        recent = '\n'.join(f'- {h}' for h in history) or '- (none yet)'
        heard = ', '.join(audio) or 'nothing'
        found = '\n'.join(f'- {c}' for c in controls) or '- (none)'
        response = await self._client.messages.parse(
            model=self._model,
            max_tokens=self._max_tokens,
            # Persona prompt is fixed for the process lifetime -> cache it.
            system=[
                {'type': 'text', 'text': system_prompt, 'cache_control': {'type': 'ephemeral'}}
            ],
            messages=[
                {
                    'role': 'user',
                    'content': [
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': 'image/png',
                                'data': _png_b64(frame),
                            },
                        },
                        {
                            'type': 'text',
                            'text': (
                                f'Goal: {task.goal}\nControls you can find:\n{found}\n'
                                f'You just heard: {heard}\nYour last actions:\n{recent}'
                            ),
                        },
                    ],
                }
            ],
            output_format=PlannerDecision,
            output_config={'effort': self._effort},
            extra_headers={'anthropic-beta': _FALLBACK_BETA},
            extra_body={'fallbacks': 'default'},
        )
        if response.stop_reason == 'refusal' or response.parsed_output is None:
            raise PlannerRefusalError(
                f'planner returned no decision (stop_reason={response.stop_reason})'
            )
        return response.parsed_output
