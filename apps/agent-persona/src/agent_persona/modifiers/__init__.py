"""Persona modifiers, implemented exactly once, here.

Vision modifiers transform the rendered frame, audio modifiers the device waveform,
motor modifiers the physical action. The visualizer receives the already
degraded frames, so "what they see" is exactly what the model saw.
"""

from agent_persona.modifiers.pipeline import ModifierPipeline

__all__ = ['ModifierPipeline']
