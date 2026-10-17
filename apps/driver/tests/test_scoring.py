import pytest

from driver.pipeline.scoring import PredicateError, evaluate

STATE = {'bolus_units': 2.5000001, 'screen': 'home', 'alarms': ['low_reservoir'], 'basal_rate': 0.8}


@pytest.mark.parametrize(
    ('predicate', 'expected'),
    [
        ('bolus_units == 2.5', True),
        ('bolus_units != 2.5', False),
        ("bolus_units > 2 and screen == 'home'", True),
        ("'low_reservoir' in alarms", True),
        ("'occlusion' not in alarms", True),
        ('0.5 < basal_rate <= 1.0', True),
        ("not (screen == 'menu')", True),
        ('bolus_units == 1 or basal_rate == 0.8', True),
    ],
)
def test_evaluate(predicate: str, expected: bool) -> None:
    assert evaluate(predicate, STATE) is expected


@pytest.mark.parametrize(
    'predicate',
    [
        "__import__('os').system('true')",
        'bolus_units.real == 2.5',
        'unknown_key == 1',
        'bolus_units ==',
    ],
)
def test_rejects_unsafe_or_invalid(predicate: str) -> None:
    with pytest.raises(PredicateError):
        evaluate(predicate, STATE)
