"""Redis Stream naming and (de)serialisation.

Entries are stored as two flat string fields — ``type`` and ``payload`` (JSON) —
so any Redis client in any language can read them without a schema registry.
This module deliberately does not import a Redis client.
"""

from typing import TYPE_CHECKING, Any

from pydantic import TypeAdapter

from infallible_contracts.events import AgentEvent, TaskDispatch

if TYPE_CHECKING:
    from collections.abc import Iterator
    from uuid import UUID

DRIVER_CONSUMER_GROUP = 'driver'

_agent_event_adapter: TypeAdapter[AgentEvent] = TypeAdapter(AgentEvent)


def tasks_stream(run_id: UUID) -> str:
    return f'run:{run_id}:tasks'


def events_stream(run_id: UUID) -> str:
    return f'run:{run_id}:events'


def agent_consumer_group(agent_id: UUID) -> str:
    return f'agent:{agent_id}'


type StreamFields = dict[str, str]


def encode(message: TaskDispatch | AgentEvent) -> StreamFields:
    return {'type': message.type, 'payload': message.model_dump_json()}


def _field(fields: dict[str, str] | dict[bytes, bytes], key: str) -> str:
    raw = fields.get(key) if key in fields else fields.get(key.encode())  # type: ignore[call-overload]
    if raw is None:
        raise KeyError(key)
    return raw.decode() if isinstance(raw, bytes) else str(raw)


def decode_dispatch(fields: dict[str, str] | dict[bytes, bytes]) -> TaskDispatch:
    return TaskDispatch.model_validate_json(_field(fields, 'payload'))


def decode_event(fields: dict[str, str] | dict[bytes, bytes]) -> AgentEvent:
    return _agent_event_adapter.validate_json(_field(fields, 'payload'))


type StreamEntry = tuple[bytes | str, dict[bytes, bytes] | dict[str, str]]


def iter_entries(reply: Any) -> Iterator[StreamEntry]:
    """Flatten a redis-py ``XREAD``/``XREADGROUP`` reply into ``(entry_id, fields)``.

    redis-py types these replies as ``Any``; this is the one place that shape is trusted.
    """
    for _stream, entries in reply or []:
        yield from entries
