import httpx
from fastapi.testclient import TestClient

from firmware.host.app import MANUAL_RUN_ID, create_app
from firmware.host.settings import HostSettings


def test_spawned_pumps_are_listed_and_serve_a_gui() -> None:
    settings = HostSettings(instance_port_start=18200, max_instances=4)
    with TestClient(create_app(settings, spawn=2)) as client:
        assert client.get('/healthz').json()['instances'] == 2
        instances = client.get('/instances').json()
        assert [i['run_id'] for i in instances] == [str(MANUAL_RUN_ID)] * 2
        assert 'iframe' in client.get('/').text

        page = httpx.get(f'http://127.0.0.1:{instances[0]["port"]}/')
        assert page.status_code == 200
        assert 'PUMP' in page.text
