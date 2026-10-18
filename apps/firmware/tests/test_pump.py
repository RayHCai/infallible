import asyncio
import base64
import contextlib
import io
import itertools
import json
import socket
import struct
import wave

import httpx
import pytest
from websockets.asyncio.client import ClientConnection, connect

from firmware.emulator import display, sound
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


def cue_ids(pump: PumpModel) -> list[str]:
    return [c.id for c in pump.drain_audio()]


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


def test_mesh_ids_map_to_firmware_buttons(pump: PumpModel) -> None:
    press(pump, 'select')  # mesh id for ok: home -> menu
    assert pump.screen == Screen.MENU
    press(pump, 'select')
    assert pump.screen == Screen.BOLUS_ENTRY
    press(pump, 'home')
    assert pump.screen == Screen.HOME


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


def test_state_records_visited_screens(pump: PumpModel) -> None:
    press(pump, 'ok')
    press(pump, 'down')
    press(pump, 'ok')  # menu[Basal] -> basal_view
    press(pump, 'back')
    assert pump.state().visited == ['home', 'menu', 'basal_view']
    pump.reset({})
    assert pump.state().visited == ['home']


def test_reconfigure_disables_confirm(pump: PumpModel) -> None:
    pump.reconfigure({'ui': {'confirm_dialogs': False}})
    press(pump, 'ok')
    press(pump, 'ok')
    press(pump, 'up')
    press(pump, 'ok')
    assert pump.screen == Screen.DELIVERING


def deliver(pump: PumpModel, clock: FakeClock, presses_up: int) -> None:
    press(pump, 'ok', times=2)  # home -> menu -> bolus entry
    press(pump, 'up', times=presses_up)
    press(pump, 'ok', times=2)  # confirm, deliver
    for _ in range(100):
        clock.advance(0.1)
        pump.tick()


def test_low_reservoir_raises_alarm(pump: PumpModel) -> None:
    pump.reset({'reservoir_units': 5})
    assert pump.screen == Screen.ALARM
    assert 'low_reservoir' in pump.alarms
    assert cue_ids(pump) == []  # silent_low_reservoir fault


def test_acknowledged_low_reservoir_does_not_realarm_after_bolus(
    pump: PumpModel, clock: FakeClock
) -> None:
    pump.reset({'reservoir_units': 18.0, 'alarms': ['low_reservoir']})
    press(pump, 'ok', times=2)
    deliver(pump, clock, presses_up=5)
    assert pump.reservoir_units == pytest.approx(17.5)
    assert (pump.screen, pump.alarms) == (Screen.HOME, [])


def test_alarm_needs_repeated_ok_to_clear(pump: PumpModel) -> None:
    pump.reset({'alarms': ['low_reservoir']})
    press(pump, 'ok')
    assert pump.screen == Screen.ALARM
    press(pump, 'ok')
    assert pump.screen == Screen.HOME
    assert pump.alarms == []


def test_false_occlusion_alarm_fires_once(pump: PumpModel, clock: FakeClock) -> None:
    assert pump.config.faults.false_alarm_after_s is not None
    clock.advance(pump.config.faults.false_alarm_after_s)
    pump.tick()
    assert pump.screen == Screen.ALARM
    assert pump.alarms == ['occlusion']
    assert cue_ids(pump) == ['occlusion']
    press(pump, 'ok', times=2)
    clock.advance(1000)
    pump.tick()
    assert pump.screen == Screen.HOME


def test_home_shows_previous_bolus(pump: PumpModel, clock: FakeClock) -> None:
    pump.reset({'bolus_units': 1.0})
    deliver(pump, clock, presses_up=5)
    assert pump.state().bolus_units == pytest.approx(0.5)
    assert pump.displayed_bolus_units == pytest.approx(1.0)


def test_faults_can_be_disabled(clock: FakeClock) -> None:
    config = load_config().patched(
        {
            'faults': {
                'stale_bolus_display': False,
                'alarm_clear_presses': 1,
                'false_alarm_after_s': None,
                'silent_low_reservoir': False,
            }
        }
    )
    pump = PumpModel(config=config, clock=clock)
    pump.reset({'reservoir_units': 5})
    assert cue_ids(pump) == ['low_reservoir']
    press(pump, 'ok')
    assert pump.screen == Screen.HOME
    clock.advance(1000)
    pump.tick()
    assert pump.alarms == []


def test_alarm_is_an_iec_high_priority_burst(pump: PumpModel, clock: FakeClock) -> None:
    clock.advance(60)
    pump.tick()
    [cue] = pump.drain_audio()
    assert (cue.priority, cue.at_ms) == ('high', 60_000)
    assert cue.wav_b64 is not None
    with wave.open(io.BytesIO(base64.b64decode(cue.wav_b64))) as w:
        samples = struct.unpack(f'<{w.getnframes()}h', w.readframes(w.getnframes()))
    win = sound.RATE // 100  # 10 ms windows
    loud = [max(map(abs, samples[i : i + win])) > 500 for i in range(0, len(samples), win)]
    assert sum(1 for a, b in itertools.pairwise([False, *loud]) if b and not a) == 10


def test_unacknowledged_alarm_repeats_then_escalates(pump: PumpModel, clock: FakeClock) -> None:
    pump.reconfigure({'audio': {'mode': 'vibrate', 'escalate_after_s': 25}})
    clock.advance(60)
    pump.tick()
    first = pump.drain_audio()
    assert [(c.vibrate, c.wav_b64) for c in first] == [(True, None)]
    for _ in range(30):
        clock.advance(1)
        pump.tick()
    repeats = pump.drain_audio()
    assert [c.at_ms for c in repeats] == [70_000, 80_000, 90_000]
    assert repeats[-1].level_db == sound.MAX_DB  # escalated: full volume despite vibrate mode
    assert repeats[0].wav_b64 is None
    press(pump, 'ok', times=2)
    pump.drain_audio()
    clock.advance(60)
    pump.tick()
    assert pump.drain_audio() == []


def test_keypad_sounds_can_be_turned_off(pump: PumpModel) -> None:
    press(pump, 'ok')
    assert cue_ids(pump) == ['keypad']
    pump.reconfigure({'audio': {'keypad_sounds': False}})
    press(pump, 'back')
    assert cue_ids(pump) == []


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
    assert [c.id for c in display.frame(server.pump).audio] == ['keypad']


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
