from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from infallible_contracts import Action, AgentReady, PressAction, Run, RunState, TaskDispatch
from infallible_contracts.export_schema import build_schema
from infallible_contracts.streams import decode_dispatch, decode_event, encode, events_stream
from infallible_contracts.task import Task


def _task() -> Task:
    return Task(
        id=uuid4(),
        name='bolus',
        description='Give a 2.5 U bolus',
        goal='Deliver a 2.5 unit bolus',
        success='bolus_units == 2.5',
    )


def test_action_union_discriminates_on_kind() -> None:
    action = TypeAdapter(Action).validate_python({'kind': 'press', 'button_id': 'ok'})
    assert action == PressAction(button_id='ok')


def test_contracts_reject_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        Run.model_validate({'id': str(uuid4()), 'state': 'prep', 'bogus': 1})


def test_terminal_states() -> None:
    assert RunState.COMPLETED.is_terminal
    assert not RunState.RUNNING.is_terminal


def test_stream_roundtrip_dispatch_and_event() -> None:
    run_id, agent_id = uuid4(), uuid4()
    dispatch = TaskDispatch(run_id=run_id, agent_id=agent_id, task_index=0, task=_task())
    assert decode_dispatch(encode(dispatch)) == dispatch

    ready = AgentReady(run_id=run_id, agent_id=agent_id, frame_endpoint='localhost:8300')
    raw = {k.encode(): v.encode() for k, v in encode(ready).items()}
    assert decode_event(raw) == ready
    assert events_stream(run_id) == f'run:{run_id}:events'


def test_schema_export_contains_every_root() -> None:
    schema = build_schema()
    for name in ('DriverMessage', 'StartResponse', 'Persona', 'SuggestionsFile'):
        assert name in schema['$defs']
        assert name in schema['properties']
