"""Readers/writers for the persona and task files under ``data/``.

Loaders glob every file in the directory, so data can be one combined file
(what scripts/ writes by default) or split one-file-per-entry.
"""

import json
from typing import TYPE_CHECKING

import yaml

from infallible_contracts.persona import Persona, PersonaFile
from infallible_contracts.task import Task, TaskFile

if TYPE_CHECKING:
    from pathlib import Path
    from uuid import UUID


def load_personas(directory: Path) -> dict[UUID, Persona]:
    personas: dict[UUID, Persona] = {}
    for path in sorted(directory.glob('*.json')):
        for persona in PersonaFile.model_validate_json(path.read_bytes()).personas:
            if persona.id in personas:
                raise ValueError(f'duplicate persona id {persona.id} in {path}')
            personas[persona.id] = persona
    return personas


def load_tasks(directory: Path) -> list[Task]:
    tasks: list[Task] = []
    seen: set[UUID] = set()
    for path in sorted([*directory.glob('*.yaml'), *directory.glob('*.yml')]):
        raw = yaml.safe_load(path.read_text(encoding='utf-8'))
        for task in TaskFile.model_validate(raw).tasks:
            if task.id in seen:
                raise ValueError(f'duplicate task id {task.id} in {path}')
            seen.add(task.id)
            tasks.append(task)
    return tasks


def write_personas(path: Path, personas: list[Persona]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = PersonaFile(personas=personas).model_dump(mode='json')
    path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8', newline='\n')


def write_tasks(path: Path, tasks: list[Task]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = TaskFile(tasks=tasks).model_dump(mode='json')
    path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding='utf-8',
        newline='\n',
    )
