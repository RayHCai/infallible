"""agent-persona: one process per simulated user.

Owns perception (render + persona modifiers) and the decision loop. Owns
nothing about run state — the driver is the single writer of that.
"""
