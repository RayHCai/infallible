"""Bundled fallback pump: a procedurally generated GLB + its annotation file.

Generating the placeholder box at runtime keeps binary assets out of git.
Drop a real prebuilt ``pump.glb`` next to ``pump.annotations.json`` in
``assets/fallback/`` and it will be used instead.
"""

import json
import shutil
import struct
from importlib import resources
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

# Pump-sized box, metres: 5 cm wide, 8 cm tall, 2.4 cm deep.
_HALF = (0.025, 0.04, 0.012)


def _box_glb() -> bytes:
    hx, hy, hz = _HALF
    faces = [  # (normal, 4 corners CCW from outside)
        ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
        ((1, 0, 0), [(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)]),
        ((-1, 0, 0), [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)]),
        ((0, 1, 0), [(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)]),
        ((0, -1, 0), [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)]),
    ]
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    for i, (normal, corners) in enumerate(faces):
        for c in corners:
            positions.extend(c)
            normals.extend(normal)
        b = i * 4
        indices.extend([b, b + 1, b + 2, b, b + 2, b + 3])

    pos_bytes = struct.pack(f'<{len(positions)}f', *positions)
    nrm_bytes = struct.pack(f'<{len(normals)}f', *normals)
    idx_bytes = struct.pack(f'<{len(indices)}H', *indices)
    idx_bytes += b'\x00' * (-len(idx_bytes) % 4)
    blob = pos_bytes + nrm_bytes + idx_bytes
    n_verts = len(positions) // 3

    gltf = {
        "asset": {"version": "2.0", "generator": "infallible-driver fallback"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "pump"}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.32, 0.34, 0.38, 1], "roughnessFactor": 0.6}}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes), "byteLength": len(nrm_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes) + len(nrm_bytes), "byteLength": len(indices) * 2, "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n_verts, "type": "VEC3",
             "min": [-hx, -hy, -hz], "max": [hx, hy, hz]},
            {"bufferView": 1, "componentType": 5126, "count": n_verts, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
    }  # fmt: skip
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode()
    json_bytes += b' ' * (-len(json_bytes) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    return b''.join(
        [
            struct.pack('<4sII', b'glTF', 2, total),
            struct.pack('<I4s', len(json_bytes), b'JSON'),
            json_bytes,
            struct.pack('<I4s', len(blob), b'BIN\x00'),
            blob,
        ]
    )


def install_fallback(mesh_path: Path, annotations_path: Path) -> None:
    """Write the fallback mesh + annotations to the run directory."""
    assets = resources.files('driver.object_builder').joinpath('assets/fallback')
    mesh_path.parent.mkdir(parents=True, exist_ok=True)
    prebuilt = assets.joinpath('pump.glb')
    if prebuilt.is_file():
        with resources.as_file(prebuilt) as src:
            shutil.copyfile(src, mesh_path)
    else:
        mesh_path.write_bytes(_box_glb())
    annotations_path.write_text(
        assets.joinpath('pump.annotations.json').read_text('utf-8'), 'utf-8'
    )
