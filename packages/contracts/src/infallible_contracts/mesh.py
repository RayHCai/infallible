from pydantic import Field

from infallible_contracts._base import Contract


class BoxRegion(Contract):
    """Normalised (0..1) box in a reference render + its 3D anchor on the mesh."""

    id: str
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)
    anchor: list[float] = Field(
        default_factory=lambda: [0.0, 0.0, 0.0],
        min_length=3,
        max_length=3,
        description='x, y, z on the mesh, metres.',
    )


class MeshAnnotations(Contract):
    """Sidecar for every pump mesh (``pump.annotations.json``)."""

    screen: BoxRegion
    buttons: list[BoxRegion]
    scale_m: float = Field(default=1.0, gt=0, description='Metres per mesh unit.')
