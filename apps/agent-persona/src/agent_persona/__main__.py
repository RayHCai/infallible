"""Entry point. Spawned by the driver, one process per agent:

    python -m agent_persona --run-id ... --agent-id ... --persona-id ... \
        --mesh-path ... --firmware-endpoint host:port|local --frame-port 8300
"""

import asyncio
import contextlib
import logging
import signal

from anthropic import AsyncAnthropic
from redis.asyncio import Redis
from typesafe_sdk import AsyncTypeSafeClient

from agent_persona.agent import PersonaAgent
from agent_persona.firmware_client import open_firmware
from agent_persona.frame_server import FrameServer
from agent_persona.modifiers import ModifierPipeline
from agent_persona.perception import Perceiver, build_controls
from agent_persona.planner import Planner
from agent_persona.renderer import Renderer, load_annotations
from agent_persona.settings import AgentSettings
from infallible_contracts.loaders import load_personas
from infallible_contracts.paths import DataLayout


async def _amain(s: AgentSettings) -> None:
    personas = load_personas(DataLayout(s.data_dir).personas_dir)
    persona = personas[s.persona_id]

    redis = Redis.from_url(s.redis_url)
    planner = Planner(AsyncAnthropic(), s.planner_model, s.planner_effort, s.planner_max_tokens)
    annotations = load_annotations(s.mesh_path)
    jev = AsyncTypeSafeClient() if s.perception_jev else None
    perceiver = Perceiver(
        build_controls(annotations), jev, s.perception_model,
        s.perception_read_threshold, s.perception_min_in_frame, s.perception_min_contrast,
    )  # fmt: skip
    frames = FrameServer()
    renderer = Renderer(annotations, frames, s.render_timeout_s)
    await frames.start(s.frame_bind_host, s.frame_port)

    async with frames, open_firmware(s.firmware_endpoint) as firmware, redis:
        agent = PersonaAgent(
            settings=s,
            persona=persona,
            redis=redis,
            firmware=firmware,
            renderer=renderer,
            planner=planner,
            perceiver=perceiver,
            modifiers=ModifierPipeline.for_persona(persona, seed=s.agent_id.int & 0xFFFFFFFF),
            frames=frames,
        )
        await agent.run()


def main() -> None:
    settings = AgentSettings.from_cli()
    logging.basicConfig(
        level=settings.log_level,
        format=f'%(asctime)s %(levelname)s agent[{str(settings.agent_id)[:8]}] %(name)s %(message)s',
    )

    async def runner() -> None:
        task = asyncio.current_task()
        loop = asyncio.get_running_loop()
        if task is not None:
            # Graceful stop on SIGTERM from the driver (no-op on Windows).
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(signal.SIGTERM, task.cancel)
        await _amain(settings)

    with contextlib.suppress(asyncio.CancelledError, KeyboardInterrupt):
        asyncio.run(runner())


if __name__ == '__main__':
    main()
