"""Agent-persona <-> visualizer snapshot protocol on the agent's frame socket
(``ws://{frame_endpoint}/render``). The visualizer renders the 3D device scene
from the agent's eye and replies with the frame plus per-button geometry."""

from typing import Literal

from pydantic import Field

from infallible_contracts._base import Contract


class EyePose(Contract):
    """Agent's eye around the pump centre: angles in radians, radius in pump heights."""

    yaw: float = 0.0
    pitch: float = Field(default=0.12, ge=-1.2, le=1.2)
    radius: float = Field(default=1.7, ge=0.6, le=4)


class RenderRequest(Contract):
    type: Literal['render_request'] = 'render_request'
    id: int
    pose: EyePose
    screen_png_b64: str = Field(description='Live firmware screen, shown on the device.')
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ButtonView(Contract):
    id: str
    box: list[float] = Field(
        min_length=4, max_length=4, description='x0, y0, x1, y1 in frame pixels; may run off-frame.'
    )
    facing: bool = Field(description='Button face points toward the eye.')
    occluded: bool = Field(description='Device geometry blocks the line of sight to it.')


class RenderReply(Contract):
    type: Literal['render_reply'] = 'render_reply'
    id: int
    png_b64: str
    buttons: list[ButtonView]
