import asyncio
import base64
import io
import math

import pytest
from PIL import Image
from websockets.asyncio.client import connect

from agent_persona.frame_server import RENDER_PATH, FrameServer, RendererUnavailableError
from agent_persona.renderer import OUTPUT_SIZE, Renderer, apply_view
from infallible_contracts import (
    BoxRegion,
    ButtonView,
    EyePose,
    MeshAnnotations,
    PressAction,
    RenderReply,
    RenderRequest,
    RotateViewAction,
    ZoomAction,
)

ANNOTATIONS = MeshAnnotations(
    screen=BoxRegion(id='screen', x=0.1, y=0.1, w=0.8, h=0.35),
    buttons=[BoxRegion(id='up', x=0.4, y=0.6, w=0.2, h=0.1)],
)


def _png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('ascii')


def test_view_actions_move_the_eye_like_the_visualizer() -> None:
    pose = apply_view(EyePose(), RotateViewAction(axis='y', deg=90))
    assert pose.yaw == pytest.approx(math.pi / 2)
    assert apply_view(pose, RotateViewAction(axis='x', deg=500)).pitch == 1.2
    assert apply_view(pose, RotateViewAction(axis='z', deg=30)) == pose
    assert apply_view(pose, ZoomAction(delta=0.5)).radius == pytest.approx(0.85)
    assert apply_view(pose, ZoomAction(delta=-10)).radius == 4
    assert apply_view(pose, PressAction(button_id='up')) is pose


class FakeFrames:
    def __init__(self, buttons: list[ButtonView]) -> None:
        self.buttons = buttons
        self.request: RenderRequest | None = None

    async def render(self, request: RenderRequest, timeout_s: float) -> RenderReply:
        self.request = request
        frame = Image.new('RGB', (request.width, request.height), 'gray')
        return RenderReply(id=request.id, png_b64=_png_b64(frame), buttons=self.buttons)


def test_snapshot_keeps_only_buttons_the_eye_can_see() -> None:
    frames = FakeFrames(
        [
            ButtonView(id='up', box=[10, 20, 30, 40], facing=True, occluded=False),
            ButtonView(id='down', box=[0, 0, 5, 5], facing=False, occluded=False),
            ButtonView(id='ok', box=[0, 0, 5, 5], facing=True, occluded=True),
        ]
    )
    renderer = Renderer(ANNOTATIONS, frames, timeout_s=1)  # type: ignore[arg-type]
    snap = asyncio.run(renderer.snapshot(Image.new('RGB', (240, 160)), EyePose(radius=2)))
    assert snap.image.size == OUTPUT_SIZE
    assert snap.boxes == {'up': (10, 20, 30, 40)}
    assert frames.request is not None
    assert frames.request.pose.radius == 2


def test_frame_server_round_trips_a_render_request() -> None:
    async def scenario() -> RenderReply:
        frames = FrameServer()
        await frames.start('127.0.0.1', 0)
        assert frames._server is not None
        port = frames._server.sockets[0].getsockname()[1]
        async with frames, connect(f'ws://127.0.0.1:{port}{RENDER_PATH}') as ws:

            async def visualizer() -> None:
                req = RenderRequest.model_validate_json(await ws.recv())
                reply = RenderReply(id=req.id, png_b64='', buttons=[])
                await ws.send(reply.model_dump_json())

            task = asyncio.create_task(visualizer())
            request = RenderRequest(id=0, pose=EyePose(), screen_png_b64='', width=64, height=48)
            reply = await frames.render(request, timeout_s=5)
            await task
            return reply

    assert asyncio.run(scenario()).id == 1


def test_render_fails_clearly_without_a_visualizer() -> None:
    async def scenario() -> None:
        request = RenderRequest(id=0, pose=EyePose(), screen_png_b64='', width=64, height=48)
        await FrameServer().render(request, timeout_s=0.05)

    with pytest.raises(RendererUnavailableError, match='visualizer'):
        asyncio.run(scenario())


def test_render_survives_the_visualizer_swapping_sockets_mid_request() -> None:
    async def scenario() -> RenderReply:
        frames = FrameServer()
        await frames.start('127.0.0.1', 0)
        assert frames._server is not None
        url = f'ws://127.0.0.1:{frames._server.sockets[0].getsockname()[1]}{RENDER_PATH}'
        async with frames:
            old = await connect(url)
            request = RenderRequest(id=0, pose=EyePose(), screen_png_b64='', width=64, height=48)
            pending = asyncio.create_task(frames.render(request, timeout_s=5))
            await old.recv()  # request lands on the old socket, which never answers
            async with connect(url) as new:
                await old.close()
                req = RenderRequest.model_validate_json(await new.recv())
                await new.send(RenderReply(id=req.id, png_b64='', buttons=[]).model_dump_json())
                return await pending

    assert asyncio.run(scenario()).id == 2
