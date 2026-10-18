"""Per-agent control loop: read tasks from Redis, perceive -> plan -> act, emit events."""

import asyncio
import base64
import io
import itertools
import logging
from typing import TYPE_CHECKING, Any

from PIL import Image
from redis.exceptions import ResponseError

from agent_persona.firmware_client import FirmwareClient, FirmwareError
from agent_persona.hearing import Heard, listen
from agent_persona.planner import Planner, build_system_prompt
from agent_persona.renderer import Box, Renderer, apply_view
from agent_persona.trace import TaskTrace
from infallible_contracts import (
    Action,
    ActionEvent,
    AgentError,
    AgentEvent,
    AgentReady,
    DoneAction,
    EyePose,
    FirmwareInput,
    HoldAction,
    Persona,
    PressAction,
    Task,
    TaskDone,
    TaskStarted,
    TurnAction,
    WaitAction,
)
from infallible_contracts.paths import DataLayout
from infallible_contracts.streams import (
    agent_consumer_group,
    decode_dispatch,
    encode,
    events_stream,
    iter_entries,
    tasks_stream,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from redis.asyncio import Redis

    from agent_persona.frame_server import FrameServer
    from agent_persona.modifiers import ModifierPipeline
    from agent_persona.perception import Perceiver
    from agent_persona.settings import AgentSettings

log = logging.getLogger(__name__)

PRESS_MS = 120
MAX_WAIT_MS = 10_000
READ_BLOCK_MS = 2_000  # must stay under redis-py's 5 s default socket_timeout


class PersonaAgent:
    def __init__(
        self,
        settings: AgentSettings,
        persona: Persona,
        redis: Redis,
        firmware: FirmwareClient,
        renderer: Renderer,
        planner: Planner,
        perceiver: Perceiver,
        modifiers: ModifierPipeline,
        frames: FrameServer,
    ) -> None:
        self.s = settings
        self.persona = persona
        self.redis = redis
        self.firmware = firmware
        self.renderer = renderer
        self.planner = planner
        self.perceiver = perceiver
        self.modifiers = modifiers
        self.frames = frames
        self.layout = DataLayout(settings.data_dir)
        self.buttons = renderer.annotations.buttons
        self.system_prompt = build_system_prompt(persona)
        self._snapshots = 0

    async def run(self) -> None:
        stream, group = tasks_stream(self.s.run_id), agent_consumer_group(self.s.agent_id)
        try:
            await self.redis.xgroup_create(stream, group, id='0', mkstream=True)
        except ResponseError as exc:  # BUSYGROUP: driver already created it
            if 'BUSYGROUP' not in str(exc):
                raise

        endpoint = f'{self.s.frame_advertise_host}:{self.s.frame_port}'
        await self._emit(
            AgentReady(run_id=self.s.run_id, agent_id=self.s.agent_id, frame_endpoint=endpoint)
        )

        while True:
            batches = await self.redis.xreadgroup(
                group, str(self.s.agent_id), {stream: '>'}, count=1, block=READ_BLOCK_MS
            )
            for entry_id, fields in iter_entries(batches):
                dispatch = decode_dispatch(fields)
                if dispatch.agent_id == self.s.agent_id:
                    await self._run_task_safely(dispatch.task)
                await self.redis.xack(stream, group, entry_id)

    async def _run_task_safely(self, task: Task) -> None:
        """One failing task (API error, missing credentials, firmware hiccup) must
        not kill the agent: report it and let the driver move on to the next task."""
        try:
            await self._run_task(task)
        except Exception as exc:
            log.exception('task %s failed', task.id)
            run_id, agent_id = self.s.run_id, self.s.agent_id
            message = f'{type(exc).__name__}: {exc}'
            await self._emit(
                AgentError(run_id=run_id, agent_id=agent_id, task_id=task.id, message=message)
            )
            try:
                final_state = (await self.firmware.state()).model_dump()
            except FirmwareError:
                final_state = {}
            await self._emit(
                TaskDone(
                    run_id=run_id, agent_id=agent_id, task_id=task.id,
                    steps=0, declared_done=False, final_state=final_state,
                )
            )  # fmt: skip

    async def _run_task(self, task: Task) -> None:
        run_id, agent_id = self.s.run_id, self.s.agent_id
        state = await self.firmware.reset(task.initial_state)
        pose = EyePose()
        trace_path = self.layout.trace(self.s.run_id, self.s.agent_id, task.id)
        touch_seed = self.modifiers.rng.getrandbits(32)
        felt = self.modifiers.touch([b.id for b in self.buttons], touch_seed)
        trace = TaskTrace(
            trace_path, self.s.agent_id, self.persona.id, task.id, touch_seed=touch_seed
        )
        history: list[str] = []
        progress = ''
        declared_done = False
        step = 0  # executed actions; task.max_steps bounds decisions
        await self._emit(TaskStarted(run_id=run_id, agent_id=agent_id, task_id=task.id))

        for decision_no in range(task.max_steps):
            view, boxes, heard = await self._snapshot(pose, step)
            perception = await self.perceiver.perceive(view, boxes, felt)
            audio = [h.description for h in heard if h.description]
            decision = await self.planner.decide(
                self.system_prompt, task, view, history[-self.s.history_window :], progress, audio,
                perception.prompt_lines(),
            )  # fmt: skip
            await self.frames.publish(view, self._meta(step, decision.reasoning, heard))

            acted: list[dict[str, Any]] = []
            moves: list[str] = []
            for planned in decision.plan():
                intended = self.perceiver.resolve(planned)
                executed = self.modifiers.motor(intended, self.buttons)
                await self._act(executed)
                pose = apply_view(pose, executed)
                state = await self.firmware.state()
                acted.append(
                    {
                        'step': step,
                        'intended': intended.model_dump(),
                        'executed': executed.model_dump(),
                        'state_after': state.model_dump(),
                    }
                )
                await self._emit(
                    ActionEvent(
                        run_id=run_id,
                    agent_id=agent_id, task_id=task.id, step=step, options=decision.options, chosen=executed,
                        reasoning=decision.reasoning, state_after=state.model_dump(),
                        trace_path=self.layout.relative(trace_path),
                    )
                )  # fmt: skip
                moves.append(_describe(executed, self.perceiver.handle_of))
                step += 1
                if isinstance(executed, DoneAction):
                    declared_done = True
                    break

            trace.append(
                {
                    'decision': decision_no,
                    'options': decision.options,
                    'reasoning': decision.reasoning,
                    'progress': decision.progress,
                    'heard': [{'cue': h.cue, 'heard': h.description} for h in heard],
                    'perception': perception.trace(),
                    'actions': acted,
                }
            )
            # Keep the conclusion, not just the moves: anonymous handles alone don't say what was done.
            history.append(f'{decision.reasoning} -> {_summarise(moves)}')
            progress = decision.progress
            if declared_done:
                break

        trace.finish(state.model_dump(), declared_done)
        await self._emit(
            TaskDone(
                run_id=run_id,
                agent_id=agent_id, task_id=task.id, steps=step,
                declared_done=declared_done, final_state=state.model_dump(),
            )
        )  # fmt: skip

    async def _snapshot(
        self, pose: EyePose, step: int
    ) -> tuple[Image.Image, dict[str, Box], list[Heard]]:
        """Degraded 3D snapshot from the eye, the buttons it can see, and what was heard
        since the last one."""
        fw_frame = await self.firmware.frame()
        screen = Image.open(io.BytesIO(base64.b64decode(fw_frame.png_b64))).convert('RGB')
        snap = await self.renderer.snapshot(screen, pose)
        view = self.modifiers.vision(snap.image)
        heard = listen(fw_frame.audio, self.modifiers.audio)
        self._snapshots += 1
        await self.frames.publish(view, self._meta(step, None, heard))
        return view, snap.boxes, heard

    def _meta(self, step: int, reasoning: str | None, heard: list[Heard]) -> dict[str, Any]:
        # `snapshot` lets viewers play each snapshot's audio once across re-publishes.
        audio = [{'heard': h.description, 'wav_b64': h.wav_b64} for h in heard if h.description]
        return {'step': step, 'reasoning': reasoning, 'snapshot': self._snapshots, 'audio': audio}

    async def _act(self, action: Action) -> None:
        match action:
            case PressAction(button_id=b):
                await self.firmware.input(FirmwareInput(event='press', target=b))
                await asyncio.sleep(PRESS_MS / 1000)
                await self.firmware.input(FirmwareInput(event='release', target=b))
            case HoldAction(button_id=b, ms=ms):
                await self.firmware.input(FirmwareInput(event='press', target=b))
                await asyncio.sleep(ms / 1000)
                await self.firmware.input(FirmwareInput(event='release', target=b))
            case TurnAction(dial=d, steps=n):
                await self.firmware.input(FirmwareInput(event='turn', target=d, steps=n))
            case WaitAction(ms=ms):
                await asyncio.sleep(min(ms, MAX_WAIT_MS) / 1000)
            case _:
                pass  # view actions move the eye; read_screen / done: perception only

    async def _emit(self, event: AgentEvent) -> None:
        await self.redis.xadd(events_stream(self.s.run_id), encode(event))  # type: ignore[arg-type]


def _describe(action: Action, handle_of: Callable[[str], str]) -> str:
    # Handles, not button ids, so history doesn't leak labels the persona can't read.
    fields: dict[str, Any] = action.model_dump(exclude={'kind'})
    if 'button_id' in fields:
        fields['button_id'] = handle_of(fields['button_id'])
    return ' '.join([action.kind, *(f'{k}={v}' for k, v in fields.items())])


def _summarise(moves: list[str]) -> str:
    runs = [(m, len(list(g))) for m, g in itertools.groupby(moves)]
    return ', '.join(m if n == 1 else f'{m} x{n}' for m, n in runs)
