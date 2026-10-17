from pydantic import BaseModel, ConfigDict


class Contract(BaseModel):
    """Base for every wire model: immutable, strict about unknown fields."""

    model_config = ConfigDict(
        frozen=True,
        extra='forbid',
        populate_by_name=True,
        # Serialised output always contains defaulted fields (e.g. `type`
        # discriminators), so the generated TS types mark them required.
        json_schema_serialization_defaults_required=True,
    )
