"""The fixed action vocabulary an agent-persona can emit."""

from typing import Annotated, Literal

from pydantic import Field

from infallible_contracts._base import Contract


class PressAction(Contract):
    kind: Literal['press'] = 'press'
    button_id: str


class HoldAction(Contract):
    kind: Literal['hold'] = 'hold'
    button_id: str
    ms: int = Field(ge=1, le=60_000)


class TurnAction(Contract):
    kind: Literal['turn'] = 'turn'
    dial: str
    steps: int


class RotateViewAction(Contract):
    kind: Literal['rotate_view'] = 'rotate_view'
    axis: Literal['x', 'y', 'z']
    deg: float


class ZoomAction(Contract):
    kind: Literal['zoom'] = 'zoom'
    delta: float


class WaitAction(Contract):
    kind: Literal['wait'] = 'wait'
    ms: int = Field(ge=0, le=60_000)


class ReadScreenAction(Contract):
    kind: Literal['read_screen'] = 'read_screen'


class DoneAction(Contract):
    kind: Literal['done'] = 'done'


Action = Annotated[
    PressAction
    | HoldAction
    | TurnAction
    | RotateViewAction
    | ZoomAction
    | WaitAction
    | ReadScreenAction
    | DoneAction,
    Field(discriminator='kind'),
]

PHYSICAL_ACTION_KINDS: frozenset[str] = frozenset({'press', 'hold', 'turn'})
VIEW_ACTION_KINDS: frozenset[str] = frozenset({'rotate_view', 'zoom'})
