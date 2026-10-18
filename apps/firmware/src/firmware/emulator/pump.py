"""Pump state machine.

Tick-driven with an injectable clock, so timing-dependent failures (holding a
button too long, menu timeouts, alarm interrupts) happen naturally at runtime
yet stay deterministic under test.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from firmware.emulator import sound
from infallible_contracts import AudioCue, FirmwareInput, FirmwareState

if TYPE_CHECKING:
    from firmware.emulator.config import PumpConfig

type Clock = Callable[[], float]  # monotonic seconds


class Screen(StrEnum):
    HOME = 'home'
    MENU = 'menu'
    BOLUS_ENTRY = 'bolus_entry'
    BOLUS_CONFIRM = 'bolus_confirm'
    DELIVERING = 'delivering'
    BASAL_VIEW = 'basal_view'
    ALARM = 'alarm'


MENU_ITEMS: tuple[str, ...] = ('Bolus', 'Basal', 'Back')
_MENU_TARGETS: dict[str, Screen] = {
    'Bolus': Screen.BOLUS_ENTRY,
    'Basal': Screen.BASAL_VIEW,
    'Back': Screen.HOME,
}
_TIMEOUT_SCREENS = frozenset({Screen.MENU, Screen.BOLUS_ENTRY, Screen.BOLUS_CONFIRM})
DELIVERY_RATE_U_PER_S = 1.5


@dataclass(slots=True)
class _Hold:
    button: str
    since: float
    last_repeat: float


@dataclass
class PumpModel:
    config: PumpConfig
    clock: Clock
    screen: Screen = Screen.HOME
    menu_index: int = 0
    pending_bolus: float = 0.0
    bolus_units: float = 0.0
    displayed_bolus_units: float = 0.0
    delivering_remaining: float = 0.0
    basal_rate: float = 0.0
    reservoir_units: float = 0.0
    battery_pct: int = 100
    alarms: list[str] = field(default_factory=list)
    audio: list[AudioCue] = field(default_factory=list)
    last_input_at: float = 0.0
    _hold: _Hold | None = None
    _last_tick: float = 0.0
    _alarm_presses: int = 0
    _acknowledged: set[str] = field(default_factory=set)
    _false_alarm_at: float | None = None
    _reset_at: float = 0.0
    _alarm_since: float | None = None
    _next_alarm_sound: float = 0.0

    def __post_init__(self) -> None:
        self.reset({})

    def reset(self, initial_state: dict[str, Any]) -> None:
        d = self.config.defaults
        now = self.clock()
        self.screen = Screen(initial_state.get('screen', Screen.HOME))
        self.menu_index = 0
        self.pending_bolus = float(initial_state.get('pending_bolus_units', 0.0))
        self.bolus_units = float(initial_state.get('bolus_units', 0.0))
        self.displayed_bolus_units = self.bolus_units
        self.delivering_remaining = 0.0
        self.basal_rate = float(initial_state.get('basal_rate', d.basal_rate))
        self.reservoir_units = float(initial_state.get('reservoir_units', d.reservoir_units))
        self.battery_pct = int(initial_state.get('battery_pct', d.battery_pct))
        self.alarms = list(initial_state.get('alarms', []))
        self.audio.clear()
        self.last_input_at = now
        self._reset_at = now
        # Alarms present at reset sound on the first tick, like a just-raised one.
        self._alarm_since = now if self.alarms else None
        self._next_alarm_sound = now
        self._last_tick = now
        self._hold = None
        self._alarm_presses = 0
        self._acknowledged.clear()
        after = self.config.faults.false_alarm_after_s
        self._false_alarm_at = None if after is None else now + after
        self._check_alarms()

    def reconfigure(self, patch: dict[str, Any]) -> None:
        self.config = self.config.patched(patch)

    def handle(self, event: FirmwareInput) -> None:
        now = self.clock()
        self.last_input_at = now
        match event.event:
            case 'press':
                # Agents press mesh ids; firmware ids still work (dev page, tests).
                by_mesh = {mesh: fw for fw, mesh in self.config.buttons.items()}
                button = by_mesh.get(event.target, event.target)
                self._hold = _Hold(button, since=now, last_repeat=now)
                self._on_button(button)
            case 'release':
                self._hold = None
            case 'turn':
                button = 'up' if event.steps > 0 else 'down'
                for _ in range(abs(event.steps)):
                    self._on_button(button)

    def tick(self) -> None:
        """Advance timers. Called by the server loop (~10 Hz)."""
        now = self.clock()
        dt, self._last_tick = now - self._last_tick, now
        ui = self.config.ui

        if self._hold is not None:
            held_ms = (now - self._hold.since) * 1000
            since_repeat_ms = (now - self._hold.last_repeat) * 1000
            if held_ms >= ui.hold_repeat_after_ms and since_repeat_ms >= ui.hold_repeat_every_ms:
                self._hold.last_repeat = now
                self._on_button(self._hold.button)

        if self.screen == Screen.DELIVERING:
            delivered = min(self.delivering_remaining, DELIVERY_RATE_U_PER_S * dt)
            self.delivering_remaining -= delivered
            self.reservoir_units = max(0.0, self.reservoir_units - delivered)
            if self.delivering_remaining <= 1e-9:
                self.screen = Screen.HOME
                self._sound('delivery_complete')
                self._check_alarms()

        if self._false_alarm_at is not None and now >= self._false_alarm_at:
            self._false_alarm_at = None
            self._raise_alarm('occlusion')

        if self.screen in _TIMEOUT_SCREENS and now - self.last_input_at >= ui.menu_timeout_s:
            # Classic MAUDE failure mode: the half-entered bolus silently disappears.
            self.pending_bolus = 0.0
            self.screen = Screen.HOME
            self._sound('timeout')

        if self.alarms and now >= self._next_alarm_sound:
            self._sound_alarm(now)

    def state(self) -> FirmwareState:
        return FirmwareState(
            screen=self.screen.value,
            bolus_units=round(self.bolus_units, 3),
            pending_bolus_units=round(self.pending_bolus, 3),
            basal_rate=self.basal_rate,
            reservoir_units=round(self.reservoir_units, 3),
            battery_pct=self.battery_pct,
            alarms=list(self.alarms),
            extra={'menu_index': self.menu_index, 'model': self.config.model},
        )

    def drain_audio(self) -> list[AudioCue]:
        out, self.audio = self.audio, []
        return out

    def _on_button(self, button: str) -> None:
        if button not in self.config.buttons:
            return
        self._sound('keypad')
        ui = self.config.ui
        match self.screen, button:
            case Screen.ALARM, 'ok':
                self._alarm_presses += 1
                if self._alarm_presses >= self.config.faults.alarm_clear_presses:
                    self._alarm_presses = 0
                    self._acknowledged.update(self.alarms)
                    self.alarms.clear()
                    self._alarm_since = None
                    self.screen = Screen.HOME
            case Screen.HOME, 'ok' | 'menu':
                self.screen, self.menu_index = Screen.MENU, 0
            case Screen.MENU, 'up':
                self.menu_index = (self.menu_index - 1) % len(MENU_ITEMS)
            case Screen.MENU, 'down':
                self.menu_index = (self.menu_index + 1) % len(MENU_ITEMS)
            case Screen.MENU, 'ok':
                self.screen = _MENU_TARGETS[MENU_ITEMS[self.menu_index]]
                if self.screen == Screen.BOLUS_ENTRY:
                    self.pending_bolus = 0.0
            case Screen.BOLUS_ENTRY, 'up':
                self.pending_bolus = min(
                    ui.bolus_max_units, self.pending_bolus + ui.bolus_step_units
                )
            case Screen.BOLUS_ENTRY, 'down':
                self.pending_bolus = max(0.0, self.pending_bolus - ui.bolus_step_units)
            case Screen.BOLUS_ENTRY, 'ok':
                if ui.confirm_dialogs:
                    self.screen = Screen.BOLUS_CONFIRM
                else:
                    self._start_delivery()
            case Screen.BOLUS_CONFIRM, 'ok':
                self._start_delivery()
            case Screen.BOLUS_CONFIRM, 'back':
                self.screen = Screen.BOLUS_ENTRY
            case Screen.BOLUS_ENTRY | Screen.MENU | Screen.BASAL_VIEW, 'back':
                self.screen = Screen.HOME
            case (
                Screen.MENU | Screen.BOLUS_ENTRY | Screen.BOLUS_CONFIRM | Screen.BASAL_VIEW,
                'home',
            ):
                self.screen = Screen.HOME
            case _:
                pass
        self.pending_bolus = round(self.pending_bolus, 3)

    def _start_delivery(self) -> None:
        if self.pending_bolus <= 0:
            self.screen = Screen.HOME
            return
        if not self.config.faults.stale_bolus_display:
            self.displayed_bolus_units = self.pending_bolus
        elif self.bolus_units:
            self.displayed_bolus_units = self.bolus_units
        self.bolus_units = self.pending_bolus
        self.delivering_remaining = self.pending_bolus
        self.pending_bolus = 0.0
        self.screen = Screen.DELIVERING
        self._sound('delivery_start')

    def _check_alarms(self) -> None:
        low = self.reservoir_units <= self.config.defaults.low_reservoir_units
        # Like a real pump, an acknowledged low-reservoir alert stays quiet until refilled.
        if not low:
            self._acknowledged.discard('low_reservoir')
        elif 'low_reservoir' not in self.alarms and 'low_reservoir' not in self._acknowledged:
            self._raise_alarm('low_reservoir')
        if self.alarms and self.screen == Screen.HOME:
            self.screen = Screen.ALARM

    def _raise_alarm(self, name: str) -> None:
        if name not in self.alarms:
            self.alarms.append(name)
        if self.screen == Screen.HOME:
            self.screen = Screen.ALARM
        now = self.clock()
        if self._alarm_since is None:
            self._alarm_since = now
        self._sound_alarm(now)

    def _sound(self, cue: str, *, escalated: bool = False) -> None:
        at_ms = round((self.clock() - self._reset_at) * 1000)
        if emitted := sound.emit(cue, self.config.audio, at_ms, escalated=escalated):
            self.audio.append(emitted)

    def _sound_alarm(self, now: float) -> None:
        """Sound the most urgent active alarm; re-sounds until acknowledged."""
        audio = self.config.audio
        audible = [a for a in self.alarms if not self._alarm_is_silent(a)]
        if not audible:
            self._next_alarm_sound = now + audio.medium_repeat_s
            return
        urgent = min(audible, key=lambda a: sound.ALARM_PRIORITY.get(a, 'high') != 'high')
        escalate_after = audio.escalate_after_s
        since = self._alarm_since if self._alarm_since is not None else now
        escalated = escalate_after is not None and now - since >= escalate_after
        self._sound(urgent, escalated=escalated)
        high = sound.ALARM_PRIORITY.get(urgent, 'high') == 'high'
        self._next_alarm_sound = now + (audio.high_repeat_s if high else audio.medium_repeat_s)

    def _alarm_is_silent(self, name: str) -> bool:
        return name == 'low_reservoir' and self.config.faults.silent_low_reservoir
