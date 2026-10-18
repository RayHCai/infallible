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
from pydantic import TypeAdapter, ValidationError
from redis.exceptions import ResponseError

from driver.pipeline.scoring import PredicateError, evaluate, explain
from driver.services.launcher import AgentSpec
from driver.services.qr import qr_png_b64
from infallible_contracts import (
    Action,
    ActionEvent,
    Agent,
    AgentError,
    AgentEvent,
    AgentEventMessage,
    AgentReady,
    BuildDoneMessage,
    BuildProgressMessage,
    BuildSource,
    ConnectResponse,
    DriverMessage,
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
    TaskStarted,
    TaskSummaryMessage,
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
    from driver.pipeline.summarizer import Summarizer
    from driver.services.broadcaster import Broadcaster
    from driver.services.firmware_host import FirmwareHostClient
    from driver.services.launcher import AgentLauncher
    from driver.settings import DriverSettings
    from infallible_contracts import Persona

log = logging.getLogger(__name__)

_ACTION: TypeAdapter[Action] = TypeAdapter(Action)


def _reasoning_by_step(trace: dict[str, Any]) -> dict[int, str]:
    # Older traces hold one entry per step; newer ones one per decision, with its steps in `actions`.
    out: dict[int, str] = {}
    for entry in trace.get('steps', []):
        reasoning = entry.get('reasoning', '')
        for step in [a['step'] for a in entry.get('actions', [])] or [entry.get('step')]:
            if step is not None:
                out[step] = reasoning
    return out


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
    errored: dict[tuple[UUID, UUID], str] = field(default_factory=dict)
    persona_of: dict[UUID, Persona] = field(default_factory=dict)
    actions: dict[tuple[UUID, UUID], list[ActionEvent]] = field(default_factory=dict)
    background: set[asyncio.Task[None]] = field(default_factory=set)
    # Kept apart from `background`: a failed summary must not fail the run.
    summaries: set[asyncio.Task[None]] = field(default_factory=set)

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
        summarizer: Summarizer,
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
        self.summarizer = summarizer
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
        if device_id not in {None, self.firmware.device_id}:
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
        by_id = {p.id: p for p in personas}
        active.persona_of = {a.id: by_id[a.persona_id] for a in active.agents}

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
                active.actions.setdefault((event.agent_id, event.task_id), []).append(event)
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
                active.errored[event.agent_id, task_id] = event.message
            case TaskDone():
                await self._score(active, event)
                await self._dispatch_next(active, event.agent_id)
            case _:
                pass

    async def _score(self, active: ActiveRun, done: TaskDone) -> None:
        task = active.task(done.task_id)
        reason: str | None = None
        if (done.agent_id, done.task_id) in active.errored:
            outcome = TaskOutcome.ERRORED
            reason = active.errored[done.agent_id, done.task_id]
        else:
            try:
                passed = evaluate(task.success, done.final_state)
            except PredicateError as exc:
                log.exception('task %s has an invalid success predicate', task.id)
                outcome = TaskOutcome.ERRORED
                reason = str(exc)
            else:
                outcome = TaskOutcome.PASSED if passed else TaskOutcome.FAILED
                if not passed:
                    reason = explain(task.success, done.final_state)
                    if not done.declared_done:
                        reason = f'Ran out of steps after {done.steps}. {reason}'
        await self.db.upsert_task_result(
            TaskResult(
                agent_id=done.agent_id, task_id=done.task_id, outcome=outcome,
                steps=done.steps, final_state=done.final_state,
            ),
            reason,
        )  # fmt: skip
        await self.broadcaster.publish(
            TaskScoredMessage(
                run_id=active.run.id,
                agent_id=done.agent_id,
                task_id=done.task_id,
                outcome=outcome,
                reason=reason,
            )
        )
        job = asyncio.create_task(self._summarize(active, done, outcome, reason))
        active.summaries.add(job)
        job.add_done_callback(active.summaries.discard)

    async def _summarize(
        self, active: ActiveRun, done: TaskDone, outcome: TaskOutcome, reason: str | None
    ) -> None:
        try:
            summary = await self.summarizer.summarize(
                persona=active.persona_of.get(done.agent_id),
                task=active.task(done.task_id),
                actions=active.actions.pop((done.agent_id, done.task_id), []),
                outcome=outcome,
                reason=reason,
            )
        except Exception:  # best-effort, like the evaluator
            log.exception('summarizer call failed for %s/%s', done.agent_id, done.task_id)
            return
        if summary:
            await self.db.set_task_summary(done.agent_id, done.task_id, summary)
            await self.broadcaster.publish(
                TaskSummaryMessage(
                    run_id=active.run.id,
                    agent_id=done.agent_id,
                    task_id=done.task_id,
                    summary=summary,
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
        await asyncio.gather(*active.summaries)
        await self._teardown(active, RunState.COMPLETED)

    async def replay(self, run_id: UUID) -> list[DriverMessage]:
        """Rebuild a saved run's WS stream so the visualizer can show its end state.

        Reasons and summaries that older runs never stored are filled in and saved.
        """
        run = await self.db.get_run(run_id)
        if run is None:
            raise RunNotFoundError(str(run_id))
        tasks = load_tasks(self.layout.tasks_dir)
        personas = load_personas(self.layout.personas_dir)
        agents = await self.db.list_agents(run_id)
        results = {(r.agent_id, r.task_id): r for r in await self.db.list_task_results(run_id)}
        notes = await self.db.list_task_notes(run_id)

        traces: dict[tuple[UUID, UUID], dict[str, Any]] = {}
        for key in results:
            path = self.layout.trace(run_id, *key)
            if path.is_file():
                traces[key] = json.loads(path.read_text('utf-8'))

        actions: dict[tuple[UUID, UUID], list[ActionEvent]] = {}
        for i in await self.db.list_interactions(run_id):
            reasoning = _reasoning_by_step(traces.get((i.agent_id, i.task_id), {}))
            actions.setdefault((i.agent_id, i.task_id), []).append(
                ActionEvent(
                    run_id=run_id, agent_id=i.agent_id, task_id=i.task_id, at=i.timestamp,
                    step=i.step, options=i.options, chosen=_ACTION.validate_json(i.chosen),
                    reasoning=reasoning.get(i.step, ''), trace_path=i.trace_path,
                )
            )  # fmt: skip

        by_id = {t.id: t for t in tasks}
        persona_of = {a.id: personas.get(a.persona_id) for a in agents}
        reasons: dict[tuple[UUID, UUID], str | None] = {}
        summaries: dict[tuple[UUID, UUID], str | None] = {}
        for key, r in results.items():
            reason, summaries[key] = notes.get(key, (None, None))
            task = by_id.get(r.task_id)
            if reason is None and r.outcome == TaskOutcome.FAILED and task:
                try:
                    reason = explain(task.success, r.final_state)
                except PredicateError:
                    pass
                else:
                    if not traces.get(key, {}).get('declared_done', True):
                        reason = f'Ran out of steps after {r.steps}. {reason}'
            reasons[key] = reason

        async def fill_summary(key: tuple[UUID, UUID], task: Task) -> None:
            try:
                summary = await self.summarizer.summarize(
                    persona=persona_of.get(key[0]),
                    task=task,
                    actions=actions.get(key, []),
                    outcome=results[key].outcome,
                    reason=reasons[key],
                )
            except Exception:
                log.exception('summarizer call failed for %s/%s', *key)
                return
            if summary:
                summaries[key] = summary
                await self.db.set_task_summary(*key, summary)

        await asyncio.gather(
            *(
                fill_summary(key, by_id[key[1]])
                for key, summary in summaries.items()
                if summary is None and key[1] in by_id
            )
        )

        messages: list[DriverMessage] = [RunStateMessage(run=run)]
        if self.layout.mesh(run_id).is_file():
            source = await self.db.get_build_source(run_id) or BuildSource.FALLBACK
            messages.append(
                BuildDoneMessage(run_id=run_id, source=source, mesh_url=f'/runs/{run_id}/mesh')
            )
        for agent in agents:
            messages.append(
                AgentEventMessage(
                    event=AgentReady(
                        run_id=run_id, agent_id=agent.id, frame_endpoint=agent.frame_endpoint
                    )
                )
            )
            for task in tasks:
                key = (agent.id, task.id)
                steps = actions.get(key, [])
                if key not in results and not steps:
                    continue
                started = TaskStarted(run_id=run_id, agent_id=agent.id, task_id=task.id)
                messages.append(AgentEventMessage(event=started))
                messages.extend(AgentEventMessage(event=a) for a in steps)
                if (result := results.get(key)) is None:
                    continue
                messages.append(
                    TaskScoredMessage(
                        run_id=run_id, agent_id=agent.id, task_id=task.id,
                        outcome=result.outcome, reason=reasons[key],
                    )
                )  # fmt: skip
                if summary := summaries.get(key):
                    messages.append(
                        TaskSummaryMessage(
                            run_id=run_id, agent_id=agent.id, task_id=task.id, summary=summary
                        )
                    )
        if (path := self.layout.suggestions(run_id)).is_file():
            count = len(SuggestionsFile.model_validate_json(path.read_bytes()).suggestions)
            messages.append(SuggestionsReadyMessage(run_id=run_id, count=count))
        return messages

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
        for task in [*active.background, *active.summaries]:
            if task is not current:
                task.cancel()
        await self.launcher.stop_all()
        if active.agents:
            try:
                await self.firmware.release(active.run.id)
            except httpx.HTTPError:
                log.exception('failed to release firmware instances')
        await self._set_state(active, state)
