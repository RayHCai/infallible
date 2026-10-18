"""Bundled fallback pump: a prebuilt GLB plus its annotation file."""

import shutil
from importlib import resources
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def install_fallback(mesh_path: Path, annotations_path: Path) -> None:
    """Write the fallback mesh + annotations to the run directory."""
    assets = resources.files('driver.object_builder').joinpath('assets/fallback')
    mesh_path.parent.mkdir(parents=True, exist_ok=True)
    with resources.as_file(assets.joinpath('pump.glb')) as src:
        shutil.copyfile(src, mesh_path)
    annotations_path.write_text(
        assets.joinpath('pump.annotations.json').read_text('utf-8'), 'utf-8'
    )
