import time
from typing import TYPE_CHECKING

from infallible_contracts import StartResponse

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


def test_connect_before_build_is_rejected(client: TestClient) -> None:
    client.post('/start')
    assert client.post('/connect', json={}).status_code == 409


def test_websocket_sends_snapshot(client: TestClient) -> None:
    run_id = client.post('/start').json()['run_id']
    with client.websocket_connect('/ws') as ws:
        msg = ws.receive_json()
    assert msg['type'] == 'run_state'
    assert msg['run']['id'] == run_id
