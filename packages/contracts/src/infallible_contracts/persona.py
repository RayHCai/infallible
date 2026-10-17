from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field

from infallible_contracts._base import Contract


class ModifierId(StrEnum):
    """Perception / motor degradations applied locally by agent-persona."""

    BLUR = 'blur'
    CONTRAST_LOSS = 'contrast_loss'
    COLOR_DEFICIENCY = 'color_deficiency'
    TREMOR = 'tremor'
    HEARING_LOSS = 'hearing_loss'
    NEUROPATHY = 'neuropathy'


class Modifier(Contract):
    id: ModifierId
    parameters: dict[str, Any] = Field(default_factory=dict)


class PersonaAttributes(Contract):
    age: int = Field(ge=0, le=120)
    gender: str
    guiding_prompt: str
    modifiers: list[Modifier] = Field(default_factory=list)


class Persona(Contract):
    id: UUID
    name: str
    description: str
    attributes: PersonaAttributes


class PersonaFile(Contract):
    """Shape of every ``data/personas/*.json`` file."""

    personas: list[Persona]
