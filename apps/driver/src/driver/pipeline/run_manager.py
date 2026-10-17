"""Run lifecycle: prep -> build -> connect -> running -> evaluating -> completed.

One run per driver instance. The driver is the only writer of run state; agents
only *report* via the Redis events stream.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

import httpx
from pydantic import ValidationError
from redis.exceptions import ResponseError

from driver.pipeline.scoring import PredicateError, evaluate
from driver.services.launcher import AgentSpec
from driver.services.qr import qr_png_b64
from infallible_contracts import (
    ActionEvent,
    Agent,
    AgentError,
    AgentEvent,
    AgentEventMessage,
    BuildDoneMessage,
    BuildProgressMessage,
    ConnectResponse,
    Interaction,
    MeshAnnotations,
    QrPayload,
    Run,
    RunState,
    RunStateMessage,
    StartResponse,
    SuggestionsFile,
    SuggestionsReadyMessage,
    Task,
    TaskDispatch,
    TaskDone,
    TaskOutcome,
    TaskResult,
    TaskScoredMessage,
)
from infallible_contracts.loaders import load_personas, load_tasks
from infallible_contracts.paths import DataLayout
from infallible_contracts.streams import (
    DRIVER_CONSUMER_GROUP,
    agent_consumer_group,
    decode_event,
    encode,
    events_stream,
    iter_entries,
    tasks_stream,
)

if TYPE_CHECKING:
    from collections.abc import Coroutine

    from redis.asyncio import Redis

    from driver.db.database import Database
    from driver.object_builder import Capture, ObjectBuilder
    from driver.pipeline.evaluator import Evaluator
    from driver.services.broadcaster import Broadcaster
    from driver.services.firmware_host import FirmwareHostClient
    from driver.services.launcher import AgentLauncher
    from driver.settings import DriverSettings

log = logging.getLogger(__name__)

IDLE_POLL_S = 0.05


class RunConflictError(Exception):
    """Another run is active (HTTP 409)."""


class RunNotFoundError(Exception):
    """Unknown or inactive run id (HTTP 404)."""


class InvalidRunStateError(Exception):
    """Operation not allowed in the current state (HTTP 409)."""


@dataclass
class ActiveRun:
    run: Run
    tasks: list[Task]
    agents: list[Agent] = field(default_factory=list)
    next_task: dict[UUID, int] = field(default_factory=dict)
    finished: set[UUID] = field(default_factory=set)
    errored: set[tuple[UUID, UUID]] = field(default_factory=set)
    background: set[asyncio.Task[None]] = field(default_factory=set)

    @property
    def all_done(self) -> bool:
        return bool(self.agents) and self.finished >= {a.id for a in self.agents}

    def task(self, task_id: UUID) -> Task:
        return next(t for t in self.tasks if t.id == task_id)


class RunManager:
    def __init__(
        self,
        settings: DriverSettings,
        db: Database,
        redis: Redis,
        broadcaster: Broadcaster,
        builder: ObjectBuilder,
        firmware: FirmwareHostClient,
        launcher: AgentLauncher,
        evaluator: Evaluator,
    ) -> None:
        self.s = settings
        self.layout = DataLayout(settings.data_dir)
        self.db = db
        self.redis = redis
        self.broadcaster = broadcaster
        self.builder = builder
        self.firmware = firmware
        self.launcher = launcher
        self.evaluator = evaluator
        self._active: ActiveRun | None = None
        self._lock = asyncio.Lock()

    @property
    def active(self) -> ActiveRun | None:
        return self._active

    # ------------------------------------------------------------------ #
    # Public operations (called from the HTTP layer)                      #
    # ------------------------------------------------------------------ #
    async def start(self) -> StartResponse:
        async with self._lock:
            if self._active and not self._active.run.state.is_terminal:
                raise RunConflictError(str(self._active.run.id))
            run = Run(id=uuid4(), state=RunState.PREP)
            await self.db.insert_run(run)
            self._active = ActiveRun(run=run, tasks=load_tasks(self.layout.tasks_dir))
            self.layout.run_dir(run.id).mkdir(parents=True, exist_ok=True)
        await self.broadcaster.publish(RunStateMessage(run=run))
        qr = QrPayload(run_id=run.id, driver_url=self.s.public_url)
        return StartResponse(run_id=run.id, state=run.state, qr=qr, qr_png_b64=qr_png_b64(qr))

    async def accept_build(self, run_id: UUID, capture: Capture) -> None:
        active = self._require(run_id, {RunState.PREP})
        await self._set_state(active, RunState.BUILD)
        self._spawn(active, self._build(active, capture))

    async def connect(self, device_id: UUID | None) -> ConnectResponse:
        active = self._require(None, {RunState.CONNECT})
        if device_id is not None:
            log.warning(
                'physical pump %s requested; adapters not implemented, using emulators', device_id
            )
        personas = list(load_personas(self.layout.personas_dir).values())
        if not personas or not active.tasks:
            raise InvalidRunStateError('data/personas and data/tasks must not be empty')

        run_id = active.run.id
        endpoints = await self.firmware.allocate(run_id, self.s.agent_count)
        active.agents = [
            Agent(
                id=uuid4(),
                run_id=run_id,
                persona_id=personas[i % len(personas)].id,
                firmware_endpoint=endpoint,
                frame_endpoint=f'{self.s.agent_advertise_host}:{self.s.agent_frame_port_start + i}',
            )
            for i, endpoint in enumerate(endpoints)
        ]
        await self.db.insert_agents(active.agents)

        # Consumer groups must exist before dispatch so no task is missed.
        await self._ensure_group(events_stream(run_id), DRIVER_CONSUMER_GROUP)
        for agent in active.agents:
            await self._ensure_group(tasks_stream(run_id), agent_consumer_group(agent.id))

        await self._set_state(active, RunState.RUNNING)
        self._spawn(active, self._collect(active))
        for i, agent in enumerate(active.agents):
            await self.launcher.spawn(
                AgentSpec(
                    agent=agent,
                    mesh_path=self.layout.mesh(run_id),
                    data_dir=self.s.data_dir,
                    redis_url=self.s.redis_url,
                    frame_bind_host=self.s.agent_bind_host,
                    frame_port=self.s.agent_frame_port_start + i,
                    frame_advertise_host=self.s.agent_advertise_host,
                ),
                on_exit=self._on_agent_exit,
            )
        for agent in active.agents:
            await self._dispatch_next(active, agent.id)
        return ConnectResponse(run_id=run_id, firmware_endpoints=endpoints)

    async def stop(self, run_id: UUID) -> Run:
        active = self._require(run_id, None)
        if not active.run.state.is_terminal:
            await self._teardown(active, RunState.STOPPED)
        return active.run

    async def shutdown(self) -> None:
        if self._active and not self._active.run.state.is_terminal:
            await self._teardown(self._active, RunState.STOPPED)

    # ------------------------------------------------------------------ #
    # Pipeline steps                                                     #
    # ------------------------------------------------------------------ #
    async def _build(self, active: ActiveRun, capture: Capture) -> None:
        run_id = active.run.id

        async def progress(stage: str, fraction: float) -> None:
            await self.broadcaster.publish(
                BuildProgressMessage(run_id=run_id, stage=stage, progress=fraction)
            )

        source = await self.builder.build(run_id, capture, progress)
        await self.db.update_run(run_id, build_source=source)
        await self.broadcaster.publish(
            BuildDoneMessage(run_id=run_id, source=source, mesh_url=f'/runs/{run_id}/mesh')
        )
        await self._set_state(active, RunState.CONNECT)

    async def _collect(self, active: ActiveRun) -> None:
        stream = events_stream(active.run.id)
        while not active.all_done:
            batches = await self.redis.xreadgroup(
                DRIVER_CONSUMER_GROUP,
                'driver',
                {stream: '>'},
                count=100,
                block=self.s.event_block_ms or None,
            )
            if not batches and not self.s.event_block_ms:
                await asyncio.sleep(IDLE_POLL_S)
            for entry_id, fields in iter_entries(batches):
                try:
                    event = decode_event(fields)
                except ValidationError:
                    log.exception('malformed event %s', entry_id)
                else:
                    await self._handle_event(active, event)
                await self.redis.xack(stream, DRIVER_CONSUMER_GROUP, entry_id)
        await self._evaluate(active)

    async def _handle_event(self, active: ActiveRun, event: AgentEvent) -> None:
        await self.broadcaster.publish(AgentEventMessage(event=event))
        match event:
            case ActionEvent():
                await self.db.insert_interaction(
                    Interaction(
                        id=uuid4(),
                        agent_id=event.agent_id,
                        task_id=event.task_id,
                        step=event.step,
                        options=event.options,
                        chosen=event.chosen.model_dump_json(),
                        timestamp=event.at,
                        trace_path=event.trace_path,
                    )
                )
            case AgentError(task_id=UUID() as task_id):
                active.errored.add((event.agent_id, task_id))
            case TaskDone():
                await self._score(active, event)
                await self._dispatch_next(active, event.agent_id)
            case _:
                pass

    async def _score(self, active: ActiveRun, done: TaskDone) -> None:
        task = active.task(done.task_id)
        if (done.agent_id, done.task_id) in active.errored:
            outcome = TaskOutcome.ERRORED
        else:
            try:
                passed = evaluate(task.success, done.final_state)
            except PredicateError:
                log.exception('task %s has an invalid success predicate', task.id)
                outcome = TaskOutcome.ERRORED
            else:
                outcome = TaskOutcome.PASSED if passed else TaskOutcome.FAILED
        await self.db.upsert_task_result(
            TaskResult(
                agent_id=done.agent_id, task_id=done.task_id, outcome=outcome,
                steps=done.steps, final_state=done.final_state,
            )
        )  # fmt: skip
        await self.broadcaster.publish(
            TaskScoredMessage(
                run_id=active.run.id, agent_id=done.agent_id, task_id=done.task_id, outcome=outcome
            )
        )

    async def _dispatch_next(self, active: ActiveRun, agent_id: UUID) -> None:
        """Tasks go out one at a time per agent; agents are not in lockstep."""
        index = active.next_task.get(agent_id, 0)
        if index >= len(active.tasks):
            active.finished.add(agent_id)
            return
        dispatch = TaskDispatch(
            run_id=active.run.id, agent_id=agent_id, task_index=index, task=active.tasks[index]
        )
        await self.redis.xadd(tasks_stream(active.run.id), encode(dispatch))  # type: ignore[arg-type]
        active.next_task[agent_id] = index + 1

        slowest = min(active.next_task.get(a.id, 1) for a in active.agents) - 1
        if slowest != active.run.current_task_index:
            active.run = active.run.model_copy(update={'current_task_index': slowest})
            await self.db.update_run(active.run.id, current_task_index=slowest)
            await self.broadcaster.publish(RunStateMessage(run=active.run))

    async def _on_agent_exit(self, agent_id: UUID, code: int) -> None:
        active = self._active
        if active is None or active.run.state.is_terminal:
            return
        message = f'agent process exited with code {code}'
        await self.broadcaster.publish(
            AgentEventMessage(
                event=AgentError(run_id=active.run.id, agent_id=agent_id, message=message)
            )
        )
        active.finished.add(agent_id)  # collector notices on its next poll

    async def _evaluate(self, active: ActiveRun) -> None:
        await self._set_state(active, RunState.EVALUATING)
        run_id = active.run.id
        results = await self.db.list_task_results(run_id)
        personas_by_id = load_personas(self.layout.personas_dir)
        used = {a.persona_id for a in active.agents}

        failed_traces: dict[str, Any] = {}
        for r in results:
            path = self.layout.trace(run_id, r.agent_id, r.task_id)
            if r.outcome != TaskOutcome.PASSED and path.is_file():
                failed_traces[f'{r.agent_id}/{r.task_id}'] = json.loads(path.read_text('utf-8'))

        annotations_path = self.layout.mesh_annotations(run_id)
        annotations = (
            MeshAnnotations.model_validate_json(annotations_path.read_bytes())
            if annotations_path.is_file()
            else None
        )
        try:
            suggestions = await self.evaluator.evaluate(
                personas=[p for pid, p in personas_by_id.items() if pid in used],
                tasks=active.tasks,
                interactions=await self.db.list_interactions(run_id),
                results=results,
                failed_traces=failed_traces,
                annotations=annotations,
            )
        except Exception:  # evaluation is best-effort; results are already persisted
            log.exception('evaluator call failed; writing empty suggestions')
            suggestions = SuggestionsFile(suggestions=[])

        self.layout.suggestions(run_id).write_text(suggestions.model_dump_json(indent=2), 'utf-8')
        await self.broadcaster.publish(
            SuggestionsReadyMessage(run_id=run_id, count=len(suggestions.suggestions))
        )
        await self._teardown(active, RunState.COMPLETED)

    # ------------------------------------------------------------------ #
    # Helpers                                                            #
    # ------------------------------------------------------------------ #
    def _require(self, run_id: UUID | None, states: set[RunState] | None) -> ActiveRun:
        active = self._active
        if active is None or (run_id is not None and active.run.id != run_id):
            raise RunNotFoundError(str(run_id))
        if states is not None and active.run.state not in states:
            allowed = ', '.join(sorted(states))
            raise InvalidRunStateError(f'run is {active.run.state}; expected one of: {allowed}')
        return active

    async def _set_state(self, active: ActiveRun, state: RunState) -> None:
        active.run = active.run.model_copy(update={'state': state})
        await self.db.update_run(active.run.id, state=state)
        await self.broadcaster.publish(RunStateMessage(run=active.run))
        log.info('run %s -> %s', active.run.id, state)

    async def _ensure_group(self, stream: str, group: str) -> None:
        try:
            await self.redis.xgroup_create(stream, group, id='0', mkstream=True)
        except ResponseError as exc:
            if 'BUSYGROUP' not in str(exc):
                raise

    def _spawn(self, active: ActiveRun, coro: Coroutine[Any, Any, None]) -> None:
        async def guarded() -> None:
            try:
                await coro
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception('run %s pipeline step crashed', active.run.id)
                await self._teardown(active, RunState.FAILED)

        task = asyncio.create_task(guarded())
        active.background.add(task)
        task.add_done_callback(active.background.discard)

    async def _teardown(self, active: ActiveRun, state: RunState) -> None:
        current = asyncio.current_task()
        for task in list(active.background):
            if task is not current:
                task.cancel()
        await self.launcher.stop_all()
        if active.agents:
            try:
                await self.firmware.release(active.run.id)
            except httpx.HTTPError:
                log.exception('failed to release firmware instances')
        await self._set_state(active, state)
