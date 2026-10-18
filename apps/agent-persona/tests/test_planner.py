from agent_persona.planner import MAX_PLAN_ACTIONS, PlannedAction, PlannerDecision
from infallible_contracts import PressAction, ReadScreenAction


def _decision(*actions: PlannedAction) -> PlannerDecision:
    return PlannerDecision(options=[], reasoning='', progress='', actions=list(actions))


def test_plan_expands_repeats_in_order() -> None:
    plan = _decision(
        PlannedAction(kind='press', target='b2', amount=None, repeat=20),
        PlannedAction(kind='press', target='b3', amount=None, repeat=None),
    ).plan()
    assert plan == [PressAction(button_id='b2')] * 20 + [PressAction(button_id='b3')]


def test_plan_is_capped_and_never_empty() -> None:
    runaway = PlannedAction(kind='press', target='b2', amount=None, repeat=10_000)
    assert len(_decision(runaway).plan()) == MAX_PLAN_ACTIONS
    assert _decision().plan() == [ReadScreenAction()]
