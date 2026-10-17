"""Export one JSON Schema covering every model the TypeScript apps consume.

    uv run python -m infallible_contracts.export_schema <out.json>

``packages/contracts-ts`` turns the output into ``src/generated.ts``. CI
regenerates both and fails on drift, so Python stays the single source of truth.
"""

import json
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter

from infallible_contracts import (
    Action,
    Agent,
    AgentEvent,
    BuildAccepted,
    ConnectRequest,
    ConnectResponse,
    Device,
    DriverMessage,
    MeshAnnotations,
    Persona,
    QrPayload,
    Run,
    StartResponse,
    StopRequest,
    SuggestionsFile,
    Task,
)

# Root-level names that become exported TS types.
_MODELS: dict[str, type[BaseModel]] = {
    'QrPayload': QrPayload,
    'StartResponse': StartResponse,
    'StopRequest': StopRequest,
    'BuildAccepted': BuildAccepted,
    'ConnectRequest': ConnectRequest,
    'ConnectResponse': ConnectResponse,
    'Device': Device,
    'Run': Run,
    'Agent': Agent,
    'Persona': Persona,
    'Task': Task,
    'MeshAnnotations': MeshAnnotations,
    'SuggestionsFile': SuggestionsFile,
}
_UNIONS: dict[str, Any] = {
    'Action': Action,
    'AgentEvent': AgentEvent,
    'DriverMessage': DriverMessage,
}


def build_schema() -> dict[str, Any]:
    defs: dict[str, Any] = {}
    properties: dict[str, Any] = {}

    def absorb(name: str, schema: dict[str, Any]) -> None:
        defs.update(schema.pop('$defs', {}))
        defs[name] = schema
        properties[name] = {'$ref': f'#/$defs/{name}'}

    ref_template = '#/$defs/{model}'
    for name, model in _MODELS.items():
        absorb(name, model.model_json_schema(ref_template=ref_template, mode='serialization'))
    for name, union in _UNIONS.items():
        schema = TypeAdapter(union).json_schema(ref_template=ref_template, mode='serialization')
        absorb(name, {'title': name, **schema})

    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'title': 'InfallibleContracts',
        'type': 'object',
        'properties': dict(sorted(properties.items())),
        'required': sorted(properties),
        'additionalProperties': False,
        '$defs': dict(sorted(defs.items())),
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('usage: python -m infallible_contracts.export_schema <out.json>')
    out = Path(sys.argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build_schema(), indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
