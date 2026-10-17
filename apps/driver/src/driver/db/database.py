"""SQLite (WAL) access. One connection, one writer: the driver process."""

import json
from importlib import resources
from typing import TYPE_CHECKING, Any, Self
from uuid import UUID

import aiosqlite

from infallible_contracts import Agent, Interaction, Run, RunState, TaskResult

if TYPE_CHECKING:
    from pathlib import Path

    from infallible_contracts import BuildSource

SCHEMA_VERSION = 1


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

    async def upsert_task_result(self, r: TaskResult) -> None:
        await self._conn.execute(
            'INSERT OR REPLACE INTO task_results (agent_id, task_id, outcome, steps, final_state) VALUES (?, ?, ?, ?, ?)',
            (str(r.agent_id), str(r.task_id), r.outcome.value, r.steps, json.dumps(r.final_state)),
        )
        await self._conn.commit()

    async def list_task_results(self, run_id: UUID) -> list[TaskResult]:
        cur = await self._conn.execute(
            'SELECT r.* FROM task_results r JOIN agents a ON a.id = r.agent_id WHERE a.run_id = ?',
            (str(run_id),),
        )
        return [
            TaskResult.model_validate({**dict(row), 'final_state': json.loads(row['final_state'])})
            for row in await cur.fetchall()
        ]
