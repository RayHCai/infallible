import asyncio
import contextlib
import json
import socket

import httpx
import pytest
from websockets.asyncio.client import ClientConnection, connect

from firmware.emulator import display
from firmware.emulator.config import load_config
from firmware.emulator.display import frame
from firmware.emulator.pump import PumpModel, Screen
from firmware.emulator.server import EmulatorServer
from infallible_contracts import FirmwareInput, FirmwareResponse


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def pump(clock: FakeClock) -> PumpModel:
    return PumpModel(config=load_config(), clock=clock)


def press(pump: PumpModel, button: str, times: int = 1) -> None:
    for _ in range(times):
        pump.handle(FirmwareInput(event='press', target=button))
        pump.handle(FirmwareInput(event='release', target=button))


def test_bolus_happy_path(pump: PumpModel, clock: FakeClock) -> None:
    press(pump, 'ok')  # home -> menu
    press(pump, 'ok')  # menu[Bolus] -> entry
    press(pump, 'up', times=25)
    assert pump.pending_bolus == pytest.approx(2.5)
    press(pump, 'ok')  # -> confirm
    assert pump.screen == Screen.BOLUS_CONFIRM
    press(pump, 'ok')  # -> delivering
    for _ in range(30):
        clock.advance(0.1)
        pump.tick()
    assert pump.screen == Screen.HOME
    assert pump.state().bolus_units == pytest.approx(2.5)


def test_menu_timeout_discards_pending_bolus(pump: PumpModel, clock: FakeClock) -> None:
    press(pump, 'ok')
    press(pump, 'ok')
    press(pump, 'up', times=10)
    clock.advance(pump.config.ui.menu_timeout_s + 1)
    pump.tick()
    assert pump.screen == Screen.HOME
    assert pump.pending_bolus == 0.0


def test_holding_a_button_auto_repeats(pump: PumpModel, clock: FakeClock) -> None:
    press(pump, 'ok')
    press(pump, 'ok')
    pump.handle(FirmwareInput(event='press', target='up'))
    for _ in range(20):
        clock.advance(0.1)
        pump.tick()
    assert pump.pending_bolus > 0.5  # overshoot is exactly the failure we want to observe


def test_reconfigure_disables_confirm(pump: PumpModel) -> None:
    pump.reconfigure({'ui': {'confirm_dialogs': False}})
    press(pump, 'ok')
    press(pump, 'ok')
    press(pump, 'up')
    press(pump, 'ok')
    assert pump.screen == Screen.DELIVERING


def test_low_reservoir_raises_alarm(clock: FakeClock) -> None:
    pump = PumpModel(config=load_config(), clock=clock)
    pump.reset({'reservoir_units': 5})
    assert pump.screen == Screen.ALARM
    assert 'low_reservoir' in pump.alarms


def test_frame_renders_png(pump: PumpModel) -> None:
    f = frame(pump)
    assert f.width == pump.config.ui.screen_width
    assert f.png_b64


async def test_server_protocol_roundtrip(clock: FakeClock) -> None:
    server = EmulatorServer(load_config(), clock=clock)
    resp = await server.handle_request(json.dumps({'op': 'reset', 'initial_state': {}}))
    assert resp.ok
    assert resp.state is not None
    assert resp.state.screen == 'home'

    resp = await server.handle_request(
        json.dumps({'op': 'input', 'input': {'event': 'press', 'target': 'ok'}})
    )
    assert resp.state is not None
    assert resp.state.screen == 'menu'

    bad = await server.handle_request(json.dumps({'op': 'explode'}))
    assert not bad.ok


async def test_viewer_snapshot_keeps_audio_for_agent(clock: FakeClock) -> None:
    server = EmulatorServer(load_config(), clock=clock)
    await server.handle_viewer_input('{"event": "press", "target": "ok"}')
    await server.handle_viewer_input('not json')
    snap = FirmwareResponse.model_validate_json(server.snapshot())
    assert snap.state is not None
    assert snap.state.screen == 'menu'
    assert snap.frame is not None
    assert snap.frame.audio == []
    assert display.frame(server.pump).audio == ['click']


async def test_gui_and_watch_over_network() -> None:
    port = _free_port()
    task = asyncio.create_task(EmulatorServer(load_config()).serve('127.0.0.1', port))
    try:
        ws = await _connect(f'ws://127.0.0.1:{port}/watch')
        async with ws:
            first = FirmwareResponse.model_validate_json(await ws.recv())
            assert first.state is not None
            assert first.state.screen == 'home'
            await ws.send(json.dumps({'event': 'press', 'target': 'ok'}))
            pushed = FirmwareResponse.model_validate_json(await ws.recv())
            assert pushed.state is not None
            assert pushed.state.screen == 'menu'

        async with httpx.AsyncClient() as http:
            page = await http.get(f'http://127.0.0.1:{port}/')
        assert page.status_code == 200
        assert page.headers['content-type'].startswith('text/html')
        assert '/watch' in page.text
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port: int = s.getsockname()[1]
        return port


async def _connect(uri: str) -> ClientConnection:
    for _ in range(50):
        try:
            return await connect(uri)
        except OSError:
            await asyncio.sleep(0.05)
    raise AssertionError(f'could not connect to {uri}')
