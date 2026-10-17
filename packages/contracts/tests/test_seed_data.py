"""The committed seed data must always satisfy the contracts."""

from pathlib import Path

from infallible_contracts.loaders import load_personas, load_tasks

DATA = Path(__file__).resolve().parents[3] / 'data'


def test_seed_personas_validate() -> None:
    assert load_personas(DATA / 'personas')


def test_seed_tasks_validate() -> None:
    assert load_tasks(DATA / 'tasks')
