import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from infallible_contracts import Interaction, StartResponse, TaskOutcome, TaskResult

if TYPE_CHECKING:
    from conftest import FakeLauncher
    from fastapi.testclient import TestClient


def _wait_for_state(client: TestClient, run_id: str, state: str, timeout: float = 5) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client.get(f'/runs/{run_id}').json()['state'] == state:
            return
        time.sleep(0.05)
    raise AssertionError(f'run never reached {state}')


def test_healthz(client: TestClient) -> None:
    assert client.get('/healthz').json() == {'status': 'ok'}


def test_start_returns_qr_and_blocks_second_run(client: TestClient) -> None:
    first = client.post('/start')
    assert first.status_code == 201
    body = StartResponse.model_validate(first.json())
    assert body.state == 'prep'
    assert body.qr.run_id == body.run_id
    assert body.qr_png_b64

    second = client.post('/start')
    assert second.status_code == 409


def test_full_pipeline_until_running(client: TestClient, launcher: FakeLauncher) -> None:
    run_id = client.post('/start').json()['run_id']

    resp = client.post(
        '/build',
        data={'run_id': run_id},
        files=[('frames', ('a.jpg', b'\xff\xd8fake', 'image/jpeg'))],
    )
    assert resp.status_code == 202, resp.text
    _wait_for_state(client, run_id, 'connect')

    mesh = client.get(f'/runs/{run_id}/mesh')
    assert mesh.status_code == 200
    assert mesh.content[:4] == b'glTF'
    assert client.get(f'/runs/{run_id}/mesh/annotations').json()['buttons']

    resp = client.post('/connect', json={'device_id': None})
    assert resp.status_code == 200, resp.text
    assert resp.json()['firmware_endpoints'] == ['local', 'local']
    assert len(launcher.spawned) == 2
    assert client.get(f'/runs/{run_id}').json()['state'] == 'running'

    stopped = client.post('/stop', json={'run_id': run_id})
    assert stopped.json()['state'] == 'stopped'
    assert launcher.stopped


def test_skip_scan_uses_fallback_mesh(client: TestClient) -> None:
    run_id = client.post('/start').json()['run_id']
    assert client.post(f'/runs/{run_id}/skip-scan').status_code == 202
    _wait_for_state(client, run_id, 'connect')
    assert client.get(f'/runs/{run_id}/mesh').content[:4] == b'glTF'
    assert client.post(f'/runs/{run_id}/skip-scan').status_code == 409


def test_connect_before_build_is_rejected(client: TestClient) -> None:
    client.post('/start')
    assert client.post('/connect', json={}).status_code == 409


def test_websocket_sends_snapshot(client: TestClient) -> None:
    run_id = client.post('/start').json()['run_id']
    with client.websocket_connect('/ws') as ws:
        msg = ws.receive_json()
    assert msg['type'] == 'run_state'
    assert msg['run']['id'] == run_id


def test_replay_rebuilds_finished_run(client: TestClient) -> None:
    run_id = client.post('/start').json()['run_id']
    assert client.post(f'/runs/{run_id}/skip-scan').status_code == 202
    _wait_for_state(client, run_id, 'connect')
    client.post('/connect', json={'device_id': None})
    client.post('/stop', json={'run_id': run_id})

    runs = client.app.state.services.runs  # type: ignore[attr-defined]
    agent = client.get(f'/runs/{run_id}/agents').json()[0]
    task = client.get('/tasks').json()[0]
    result = TaskResult(
        agent_id=agent['id'],
        task_id=task['id'],
        outcome=TaskOutcome.FAILED,
        steps=1,
        final_state={},
    )
    action = '{"kind": "press", "button_id": "ok"}'
    interaction = Interaction(
        id=uuid4(), agent_id=agent['id'], task_id=task['id'], step=0, options=['a'],
        chosen=action, timestamp=datetime.now(UTC), trace_path='t.json',
    )  # fmt: skip

    async def seed() -> None:
        await runs.db.insert_interaction(interaction)
        await runs.db.upsert_task_result(result)

    async def summarize(**_: object) -> str:
        return 'recap'

    client.portal.call(seed)  # type: ignore[union-attr]
    runs.summarizer.summarize = summarize

    listing = client.get('/runs').json()
    assert listing[0]['run']['id'] == run_id
    assert (listing[0]['passed'], listing[0]['total']) == (0, 1)

    messages = client.get(f'/runs/{run_id}/replay').json()
    types = [m['type'] for m in messages]
    assert types[:2] == ['run_state', 'build_done']
    assert 'action' in [m['event']['type'] for m in messages if m['type'] == 'agent_event']
    scored = next(m for m in messages if m['type'] == 'task_scored')
    assert scored['reason']
    assert next(m for m in messages if m['type'] == 'task_summary')['summary'] == 'recap'

    runs.summarizer.summarize = None  # a saved summary must not be regenerated
    again = client.get(f'/runs/{run_id}/replay').json()
    assert 'task_summary' in [m['type'] for m in again]
    assert client.get(f'/runs/{uuid4()}/replay').status_code == 404
