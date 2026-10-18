"""SQLite (WAL) access. One connection, one writer: the driver process."""

import json
from importlib import resources
from typing import TYPE_CHECKING, Any, Self
from uuid import UUID

import aiosqlite

from infallible_contracts import (
    Agent,
    BuildSource,
    Interaction,
    Run,
    RunListing,
    RunState,
    TaskResult,
)

if TYPE_CHECKING:
    from pathlib import Path

SCHEMA_VERSION = 2


class Database:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    @classmethod
    async def open(cls, path: Path | str) -> Self:
        if not isinstance(path, str):
            path.parent.mkdir(parents=True, exist_ok=True)
        conn = await aiosqlite.connect(path)
        conn.row_factory = aiosqlite.Row
        for pragma in (
            'journal_mode=WAL',
            'synchronous=NORMAL',
            'foreign_keys=ON',
            'busy_timeout=5000',
        ):
            await conn.execute(f'PRAGMA {pragma}')
        db = cls(conn)
        await db._migrate()
        return db

    async def close(self) -> None:
        await self._conn.close()

    async def _migrate(self) -> None:
        (version,) = await (await self._conn.execute('PRAGMA user_version')).fetchone() or (0,)
        if version == 1:
            for column in ('reason', 'summary'):
                await self._conn.execute(f'ALTER TABLE task_results ADD COLUMN {column} TEXT')
        if version < SCHEMA_VERSION:
            schema = resources.files('driver.db').joinpath('schema.sql').read_text('utf-8')
            await self._conn.executescript(schema)
            await self._conn.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
            await self._conn.commit()

    # ---- runs ------------------------------------------------------------- #
    async def insert_run(self, run: Run) -> None:
        await self._conn.execute(
            'INSERT INTO runs (id, state, current_task_index) VALUES (?, ?, ?)',
            (str(run.id), run.state.value, run.current_task_index),
        )
        await self._conn.commit()

    async def update_run(
        self,
        run_id: UUID,
        *,
        state: RunState | None = None,
        current_task_index: int | None = None,
        build_source: BuildSource | None = None,
    ) -> None:
        sets: list[str] = ["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"]
        params: list[Any] = []
        if state is not None:
            sets.append('state = ?')
            params.append(state.value)
        if current_task_index is not None:
            sets.append('current_task_index = ?')
            params.append(current_task_index)
        if build_source is not None:
            sets.append('build_source = ?')
            params.append(build_source.value)
        # Column names are fixed literals above; only values are bound parameters.
        query = f'UPDATE runs SET {", ".join(sets)} WHERE id = ?'  # noqa: S608
        await self._conn.execute(query, (*params, str(run_id)))
        await self._conn.commit()

    async def get_run(self, run_id: UUID) -> Run | None:
        cur = await self._conn.execute(
            'SELECT id, state, current_task_index FROM runs WHERE id = ?', (str(run_id),)
        )
        row = await cur.fetchone()
        if row is None:
            return None
        return Run(
            id=UUID(row['id']),
            state=RunState(row['state']),
            current_task_index=row['current_task_index'],
        )

    async def list_runs(self) -> list[RunListing]:
        cur = await self._conn.execute(
            'SELECT r.id, r.state, r.current_task_index, r.created_at,'
            " COUNT(t.outcome) AS total, COUNT(CASE WHEN t.outcome = 'passed' THEN 1 END) AS passed"
            ' FROM runs r LEFT JOIN agents a ON a.run_id = r.id'
            ' LEFT JOIN task_results t ON t.agent_id = a.id'
            ' GROUP BY r.id ORDER BY r.created_at DESC'
        )
        return [
            RunListing(
                run=Run(
                    id=UUID(row['id']),
                    state=RunState(row['state']),
                    current_task_index=row['current_task_index'],
                ),
                created_at=row['created_at'],
                passed=row['passed'],
                total=row['total'],
            )
            for row in await cur.fetchall()
        ]

    async def get_build_source(self, run_id: UUID) -> BuildSource | None:
        cur = await self._conn.execute('SELECT build_source FROM runs WHERE id = ?', (str(run_id),))
        row = await cur.fetchone()
        return BuildSource(row['build_source']) if row and row['build_source'] else None

    async def fail_unfinished_runs(self) -> int:
        """On boot: any run left mid-flight by a crashed driver is marked failed."""
        terminal = tuple(s.value for s in RunState if s.is_terminal)
        cur = await self._conn.execute(
            f'UPDATE runs SET state = ? WHERE state NOT IN ({",".join("?" * len(terminal))})',  # noqa: S608
            (RunState.FAILED.value, *terminal),
        )
        await self._conn.commit()
        return cur.rowcount

    # ---- agents ----------------------------------------------------------- #
    async def insert_agents(self, agents: list[Agent]) -> None:
        await self._conn.executemany(
            'INSERT INTO agents (id, run_id, persona_id, firmware_endpoint, frame_endpoint) VALUES (?, ?, ?, ?, ?)',
            [
                (str(a.id), str(a.run_id), str(a.persona_id), a.firmware_endpoint, a.frame_endpoint)
                for a in agents
            ],
        )
        await self._conn.commit()

    async def list_agents(self, run_id: UUID) -> list[Agent]:
        cur = await self._conn.execute('SELECT * FROM agents WHERE run_id = ?', (str(run_id),))
        return [Agent.model_validate(dict(row)) for row in await cur.fetchall()]

    # ---- interactions / results ------------------------------------------- #
    async def insert_interaction(self, i: Interaction) -> None:
        await self._conn.execute(
            "INSERT OR IGNORE INTO interactions (id, agent_id, task_id, step, options, chosen, timestamp, trace_path)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(i.id), str(i.agent_id), str(i.task_id), i.step, json.dumps(i.options),
                i.chosen, i.timestamp.isoformat(), i.trace_path,
            ),
        )  # fmt: skip
        await self._conn.commit()

    async def list_interactions(self, run_id: UUID) -> list[Interaction]:
        cur = await self._conn.execute(
            'SELECT i.* FROM interactions i JOIN agents a ON a.id = i.agent_id'
            ' WHERE a.run_id = ? ORDER BY i.agent_id, i.task_id, i.step',
            (str(run_id),),
        )
        return [
            Interaction.model_validate({**dict(row), 'options': json.loads(row['options'])})
            for row in await cur.fetchall()
        ]

    async def upsert_task_result(self, r: TaskResult, reason: str | None = None) -> None:
        await self._conn.execute(
            'INSERT OR REPLACE INTO task_results (agent_id, task_id, outcome, steps, final_state, reason)'
            ' VALUES (?, ?, ?, ?, ?, ?)',
            (
                str(r.agent_id), str(r.task_id), r.outcome.value, r.steps,
                json.dumps(r.final_state), reason,
            ),
        )  # fmt: skip
        await self._conn.commit()

    async def list_task_results(self, run_id: UUID) -> list[TaskResult]:
        cur = await self._conn.execute(
            'SELECT r.agent_id, r.task_id, r.outcome, r.steps, r.final_state FROM task_results r'
            ' JOIN agents a ON a.id = r.agent_id WHERE a.run_id = ?',
            (str(run_id),),
        )
        return [
            TaskResult.model_validate({**dict(row), 'final_state': json.loads(row['final_state'])})
            for row in await cur.fetchall()
        ]

    async def set_task_summary(self, agent_id: UUID, task_id: UUID, summary: str) -> None:
        await self._conn.execute(
            'UPDATE task_results SET summary = ? WHERE agent_id = ? AND task_id = ?',
            (summary, str(agent_id), str(task_id)),
        )
        await self._conn.commit()

    async def list_task_notes(
        self, run_id: UUID
    ) -> dict[tuple[UUID, UUID], tuple[str | None, str | None]]:
        """(agent, task) -> (reason, summary): the scoring text the WS sends but TaskResult omits."""
        cur = await self._conn.execute(
            'SELECT r.agent_id, r.task_id, r.reason, r.summary FROM task_results r'
            ' JOIN agents a ON a.id = r.agent_id WHERE a.run_id = ?',
            (str(run_id),),
        )
        return {
            (UUID(row['agent_id']), UUID(row['task_id'])): (row['reason'], row['summary'])
            for row in await cur.fetchall()
        }
