# tests/test_financial_model_programme.py
"""Spec Sec 18.2/18.4 -- mirror of frontend/src/lib/model/programme.test.ts."""
import pytest

from app.financial_model.programme import derive_phases, topological_order
from app.financial_model.types import (
    CategoryPhaseIds, Dependency, Phase, ProgrammeNetwork, SimpleSpendCurve,
    PRE_COMPLETION_CODES,
)

SL = SimpleSpendCurve(kind="straight_line")


def phase(pid, code, duration, preds=(), *, start_offset=0, slip=0):
    return Phase(
        id=pid, code=code, label=pid, duration_months=duration,
        slip_months=slip, start_offset=start_offset, curve=SL,
        predecessors=list(preds),
    )


def net(phases):
    first = phases[0].id
    return ProgrammeNetwork(
        anchor_month=None, phases=phases,
        category_phase_ids=CategoryPhaseIds(
            construction=first, professional=first, statutory=first,
        ),
    )


def dep(pid, type_="FS", lag=0):
    return Dependency(phase_id=pid, type=type_, lag_months=lag)


def test_predecessor_free_phase_starts_at_its_floor():
    d = derive_phases(net([phase("a", "planning", 4, start_offset=2)]))
    assert d.cycle is None
    assert d.by_id["a"].start_month == 2
    assert d.by_id["a"].finish_month == 6


def test_fs_with_lag():
    d = derive_phases(net([
        phase("a", "planning", 4),
        phase("b", "construction", 9, [dep("a", "FS", 1)]),
    ]))
    assert d.by_id["b"].start_month == 5
    assert d.by_id["b"].finish_month == 14


def test_ss_with_lag_references_the_predecessor_start():
    d = derive_phases(net([
        phase("a", "design", 6, start_offset=3),
        phase("b", "procurement", 2, [dep("a", "SS", 2)]),
    ]))
    assert d.by_id["b"].start_month == 5


def test_start_offset_is_a_floor_not_an_override():
    d = derive_phases(net([
        phase("a", "planning", 4),
        phase("b", "construction", 2, [dep("a")], start_offset=10),
    ]))
    assert d.by_id["b"].start_month == 10


def test_latest_of_several_predecessors_wins():
    d = derive_phases(net([
        phase("a", "planning", 4),
        phase("b", "design", 7),
        phase("c", "construction", 2, [dep("a"), dep("b")]),
    ]))
    assert d.by_id["c"].start_month == 7


def test_slip_propagates_to_successors():
    d = derive_phases(net([
        phase("a", "planning", 4, slip=3),
        phase("b", "construction", 9, [dep("a")]),
    ]))
    assert d.by_id["a"].start_month == 3
    assert d.by_id["b"].start_month == 7


def test_negative_slip_is_not_clamped():
    d = derive_phases(net([phase("a", "planning", 4, start_offset=1, slip=-3)]))
    assert d.by_id["a"].start_month == -2


def test_milestone_finishes_where_it_starts():
    d = derive_phases(net([
        phase("c", "construction", 9),
        phase("pc", "practical_completion", 0, [dep("c")]),
        phase("m", "marketing", 3, [dep("pc")]),
    ]))
    assert d.by_id["pc"].start_month == 9
    assert d.by_id["pc"].finish_month == 9
    assert d.by_id["m"].start_month == 9


def test_programme_finish_counts_a_trailing_milestone():
    d = derive_phases(net([
        phase("c", "construction", 9),
        phase("t", "maturity_tail", 0, [dep("c", "FS", 3)]),
    ]))
    assert d.by_id["t"].start_month == 12
    assert d.finish_month == 13


def test_cycle_is_detected_and_named():
    d = derive_phases(net([
        phase("a", "planning", 4, [dep("b")]),
        phase("b", "conditions", 2, [dep("a")]),
    ]))
    assert d.cycle is not None
    assert d.cycle[0] == d.cycle[-1]
    assert set(d.cycle) == {"a", "b"}


def test_three_node_cycle_is_reported_in_forward_dependency_order():
    # a depends on c, c depends on b, b depends on a.
    # Forward (dependency) order must read a -> b -> c -> a, NOT the reverse.
    # A 2-node cycle is a palindrome and cannot catch a missing reversal;
    # this one can. (Task 1 review, minor finding; mirrors programme.test.ts.)
    d = derive_phases(net([
        phase("a", "planning", 2, [dep("c")]),
        phase("b", "design", 2, [dep("a")]),
        phase("c", "procurement", 2, [dep("b")]),
    ]))
    assert d.cycle is not None
    assert d.cycle[0] == d.cycle[-1]
    assert d.cycle == ["a", "b", "c", "a"]


def test_self_reference_is_a_cycle():
    d = derive_phases(net([phase("a", "planning", 4, [dep("a")])]))
    assert d.cycle is not None


def test_absent_predecessor_is_ignored_by_the_engine():
    d = derive_phases(net([phase("a", "planning", 4, [dep("ghost")])]))
    assert d.cycle is None
    assert d.by_id["a"].start_month == 0


def test_pre_completion_codes_membership():
    assert "practical_completion" in PRE_COMPLETION_CODES
    assert "marketing" not in PRE_COMPLETION_CODES
    assert "other" not in PRE_COMPLETION_CODES


def test_topological_order_places_every_phase_once():
    order, cycle = topological_order([
        phase("c", "construction", 2, [dep("b")]),
        phase("a", "planning", 2),
        phase("b", "design", 2, [dep("a")]),
    ])
    assert cycle is None
    assert order == ["a", "b", "c"]


# --- Sec 18.4 float, mirroring the TS guard tests ---

def slack_net():
    return net([
        phase("a", "planning", 4),
        phase("b", "design", 2),
        phase("c", "construction", 9, [dep("a"), dep("b")]),
    ])


def test_float_and_critical_path():
    d = derive_phases(slack_net())
    assert d.by_id["a"].total_float_months == 0
    assert d.by_id["c"].total_float_months == 0
    assert d.by_id["b"].total_float_months == 2
    assert d.critical_path == ["a", "c"]
    assert d.finish_month == 13


# Task 16 falsifiability audit. Single-line change that kills both guards
# below: programme.py's forward pass, `floor = max(floor, _ref(...) +
# d.lag_months)` -> `min(...)`. Verified by actually making the change: 1a's
# finish_month becomes 9 (not 13), 1b's becomes 9 (not 16), and
# test_guard_1_fixture_really_contains_a_slack_phase fails too (every phase
# becomes equally critical) -- reverted after confirming both guards, and
# every other test in this file, pass again clean.
def test_guard_1a_slipping_slack_does_not_move_the_finish():
    n = slack_net()
    n.phases[1].slip_months = 2
    d = derive_phases(n)
    assert d.finish_month == 13
    assert d.by_id["b"].start_month == 2
    assert d.by_id["c"].start_month == 4
    assert d.by_id["b"].total_float_months == 0


def test_guard_1b_slipping_a_critical_phase_moves_the_finish_by_exactly_n():
    n = slack_net()
    n.phases[0].slip_months = 3
    d = derive_phases(n)
    assert d.finish_month == 16
    assert d.by_id["c"].start_month == 7


def test_guard_1_fixture_really_contains_a_slack_phase():
    d = derive_phases(slack_net())
    assert any(p.total_float_months > 0 for p in d.phases)


def test_ss_link_carries_float():
    d = derive_phases(net([
        phase("a", "construction", 10),
        phase("b", "marketing", 2, [dep("a", "SS", 6)]),
    ]))
    assert d.by_id["b"].start_month == 6
    assert d.finish_month == 10
    assert d.by_id["b"].total_float_months == 2
    assert d.by_id["a"].total_float_months == 0
    assert d.critical_path == ["a"]


def test_trailing_milestone_is_critical():
    d = derive_phases(net([
        phase("c", "construction", 9),
        phase("t", "maturity_tail", 0, [dep("c", "FS", 3)]),
    ]))
    assert d.by_id["t"].total_float_months == 0
    assert d.critical_path == ["c", "t"]
