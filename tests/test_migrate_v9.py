"""R12 (spec Sec 18.7) -- the inputs v8 -> v9 migration, and the persistence
boundary.

Python twin of the `migrateV8toV9` / `migrateInputsToV9 refusals` /
`migrateInputsToV9 merge-onto-defaults branch` describe blocks in
frontend/src/lib/model/migrate.test.ts.

Fixtures are declared locally in this file rather than in tests/conftest.py:
that is the pattern every other tests/test_migrate_vN.py already uses (see
test_migrate_v7.py:25, test_migrate_v8.py:36) -- conftest.py carries no v7/v8
migration fixtures to follow, so this file matches the codebase's actual
convention rather than the brief's description of one.
"""
import json

import pytest

from app.financial_model.migrate import (
    PACKAGE_TO_PHASE,
    PROGRAMME_FIELD_ALIASES,
    _v9_cost_plan,
    _v9_refinance,
    _v9_sales_phasing,
    _v9_scenarios,
    is_v9,
    migrate_inputs_to_v8,
    migrate_inputs_to_v9,
    migrate_v8_to_v9,
)
from app.financial_model.types import (
    CalculatorInputsV8,
    CalculatorInputsV9,
    CategoryPhaseIds,
    Dependency,
    Phase,
    ProgrammeNetwork,
    SimpleSpendCurve,
    parse_calculator_inputs,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _default_v8_document() -> CalculatorInputsV8:
    return migrate_inputs_to_v8({"inputs_version": 1})


def _v8_with_detailed_cost_plan() -> CalculatorInputsV8:
    """A v8 document with a real (detailed) cost plan carrying a package and a
    fee line, so the phase_id no-op below has a non-empty `packages` array to
    write onto -- an empty list would make `all(p.phase_id is None ...)` pass
    vacuously regardless of what the migration does. Headline mode already
    gives 8 fee lines via cost_plan_from_legacy_costs, so only `packages`
    needs the extra push."""
    doc = _default_v8_document().model_dump(mode="json")
    doc["cost_plan"]["mode"] = "detailed"
    doc["cost_plan"]["packages"] = [{
        "id": "p1", "code": "structure", "label": "Structure",
        "amount_pence": 1_000_000, "contingency_class": "general",
        "lender_eligible": True, "notes": "", "vat_override": None,
    }]
    return CalculatorInputsV8.model_validate(doc)


@pytest.fixture
def v8_document():
    """Factory fixture: a v8 document (detailed cost plan) with an optional
    `programme` override, matching the brief's `v8_document(programme=None)`
    call shape."""
    def _make(programme=None):
        doc = _v8_with_detailed_cost_plan().model_dump(mode="json")
        doc["programme"] = programme
        return CalculatorInputsV8.model_validate(doc)
    return _make


@pytest.fixture
def v8_document_with_programme() -> CalculatorInputsV8:
    """A v8 document with a real, explicit three-package programme. The three
    packages carry DISTINCT start_offset/duration_months/curve values on every
    axis so that a migration bug which transposes two packages -- rather than
    merely dropping a field -- changes an assertion somewhere in the suite.
    Port of migrate.test.ts's v8DocumentWithProgramme()."""
    doc = _v8_with_detailed_cost_plan().model_dump(mode="json")
    doc["programme"] = {
        "anchor_month": "2026-03",
        "packages": {
            "construction": {"start_offset": 2, "duration_months": 9,
                              "curve": {"kind": "s_curve"}},
            "professional": {"start_offset": 0, "duration_months": 5,
                              "curve": {"kind": "straight_line"}},
            "statutory": {"start_offset": 1, "duration_months": 4,
                          "curve": {"kind": "back_loaded"}},
        },
    }
    return CalculatorInputsV8.model_validate(doc)


@pytest.fixture
def v9_network_document() -> CalculatorInputsV9:
    """A hand-built v9 document carrying a POPULATED network -- a real
    predecessor, a non-zero lag and a non-zero slip -- for the
    persistence-boundary negative control (Sec 18.7): a written `None`
    surviving a round trip proves nothing about a written VALUE surviving.
    Not migration output: no migration produces predecessors or non-zero
    slip, so this stands in for a document a later task's network-editing UI
    would write."""
    base = migrate_v8_to_v9(migrate_inputs_to_v8({"inputs_version": 1}))
    phases = [
        Phase(id="procurement", code="procurement", label="Procurement",
              duration_months=2, slip_months=0, start_offset=0,
              curve=SimpleSpendCurve(kind="straight_line"), predecessors=[]),
        Phase(id="construction", code="construction", label="Construction",
              duration_months=9, slip_months=0, start_offset=2,
              curve=SimpleSpendCurve(kind="s_curve"),
              predecessors=[Dependency(phase_id="procurement", type="FS", lag_months=1)]),
        Phase(id="professional", code="design", label="Professional",
              duration_months=5, slip_months=0, start_offset=0,
              curve=SimpleSpendCurve(kind="straight_line"), predecessors=[]),
        Phase(id="statutory", code="planning", label="Statutory",
              duration_months=4, slip_months=0, start_offset=1,
              curve=SimpleSpendCurve(kind="back_loaded"), predecessors=[]),
        Phase(id="marketing", code="marketing", label="Marketing",
              duration_months=3, slip_months=2, start_offset=8,
              curve=SimpleSpendCurve(kind="straight_line"), predecessors=[]),
    ]
    network = ProgrammeNetwork(
        anchor_month="2026-01",
        phases=phases,
        category_phase_ids=CategoryPhaseIds(
            construction="construction", professional="professional", statutory="statutory",
        ),
    )
    return base.model_copy(update={"programme": network})


# ---------------------------------------------------------------------------
# migrate_v8_to_v9 -- the write itself
# ---------------------------------------------------------------------------

def test_null_programme_stays_null(v8_document):
    v9 = migrate_v8_to_v9(v8_document(programme=None))
    assert v9.programme is None
    assert v9.inputs_version == 9


def test_three_packages_become_predecessor_free_phases(v8_document_with_programme):
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    net = v9.programme
    assert [p.id for p in net.phases] == ["construction", "professional", "statutory"]
    assert [p.code for p in net.phases] == ["construction", "design", "planning"]
    assert all(p.predecessors == [] for p in net.phases)
    assert all(p.slip_months == 0 for p in net.phases)


def test_window_identity_is_table_driven_over_all_three_phases_with_distinct_values(
    v8_document_with_programme,
):
    """Table-driven over ALL THREE, matched by id rather than array position.
    The single-phase (construction-only) version of this test would pass even
    with `professional`/`statutory`'s fields transposed -- window identity is
    this task's entire safety claim, so every package needs its own check
    against ITS OWN source values, not just construction's. Port of
    migrate.test.ts's 'converts each of the three packages to a
    predecessor-free phase with an identical window'."""
    source = v8_document_with_programme.programme.packages
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    net = v9.programme

    assert net.anchor_month == "2026-03"
    for name in ("construction", "professional", "statutory"):
        phase = next(p for p in net.phases if p.id == name)
        pkg = getattr(source, name)
        assert phase.start_offset == pkg.start_offset, name
        assert phase.duration_months == pkg.duration_months, name
        assert phase.curve.model_dump() == pkg.curve.model_dump(), name


def test_category_phase_ids_derived_from_the_built_phases(v8_document_with_programme):
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    assert v9.programme.category_phase_ids.model_dump() == {
        "construction": "construction", "professional": "professional", "statutory": "statutory",
    }


def test_ids_equal_the_package_names_the_alias_map_depends_on_it(v8_document_with_programme):
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    assert {p.id for p in v9.programme.phases} == set(PACKAGE_TO_PHASE)


def test_programme_field_aliases_is_derived_and_has_exactly_three_entries():
    """PROGRAMME_FIELD_ALIASES must be DERIVED from PACKAGE_TO_PHASE, never
    restated -- Task 8's own alias-map assertion is meant to constrain both
    objects at once. Bounding it to exactly three entries here is the half of
    that constraint this task owns."""
    assert len(PROGRAMME_FIELD_ALIASES) == 3
    assert set(PROGRAMME_FIELD_ALIASES) == {f"programme.packages.{n}" for n in PACKAGE_TO_PHASE}
    for name in PACKAGE_TO_PHASE:
        assert PROGRAMME_FIELD_ALIASES[f"programme.packages.{name}"] == f"programme.phases.{name}"


def test_names_the_missing_package_rather_than_an_anonymous_error(v8_document_with_programme):
    """A hand-edited or malformed stored row is not bound by
    CalculatorInputsV8's type -- this is the runtime guard for a
    `programme.packages` dict missing one of its three keys."""
    doc = v8_document_with_programme.model_dump(mode="json")
    del doc["programme"]["packages"]["statutory"]
    with pytest.raises(ValueError, match='migrate_v8_to_v9.*"statutory"'):
        migrate_v8_to_v9(doc)


def test_adds_anchor_none_to_every_tranche_and_to_refinance():
    """`SalesPhasingTrancheV9.anchor` / `RefinanceInputsV9.anchor` already
    default to `None` (Task 5), so asserting only against a *validated*
    `CalculatorInputsV9` would pass even with `_v9_sales_phasing` /
    `_v9_refinance`'s writes deleted entirely -- Pydantic supplies the same
    default. Confirmed by temporarily deleting both writes: the
    helper-level assertions below failed as expected, the validated-model
    assertions did not (see task-7-report.md). The PRE-VALIDATION dicts these
    two helpers return are what can actually distinguish a written value from
    a field default."""
    sales_phasing = {"tranches": [{"month_offset": 10, "pct_of_gross_receipts": 100}]}
    refinance = {
        "month_offset": 11, "investment_value_pence": 1, "ltv_pct": 60,
        "arrangement_fee_pence": 0, "legal_costs_pence": 0,
    }
    # Non-vacuity: the input really does lack the key the migration must add.
    assert "anchor" not in sales_phasing["tranches"][0]
    assert "anchor" not in refinance

    rebuilt_sales_phasing = _v9_sales_phasing(sales_phasing)
    rebuilt_refinance = _v9_refinance(refinance)
    assert rebuilt_sales_phasing["tranches"][0]["anchor"] is None
    assert rebuilt_sales_phasing["tranches"][0]["month_offset"] == 10
    assert rebuilt_refinance["anchor"] is None

    # And the full migration validates and carries both through.
    doc = _default_v8_document().model_dump(mode="json")
    doc["sales_phasing"] = sales_phasing
    doc["refinance"] = refinance
    v9 = migrate_v8_to_v9(doc)
    assert v9.sales_phasing.tranches[0].anchor is None
    assert v9.sales_phasing.tranches[0].month_offset == 10
    assert v9.refinance.anchor is None


def test_adds_the_two_slip_fields_at_no_op_values_from_a_snapshot_with_neither_key():
    """Fix-round-1 shape from Task 6, mirrored: `phase_slip_phase_id` /
    `phase_slip_months` live on the SHARED, version-agnostic `ScenarioOverrides`
    model, and Task 5 already defaults both. A fixture built from a
    constructed v9 document therefore already carries them regardless of what
    `_v9_scenarios` does -- AND, unlike TS, asserting against a *validated*
    `CalculatorInputsV9` stays green even from a snapshot with both keys
    stripped, because Pydantic fills the same field default at
    `model_validate` time. Confirmed by temporarily deleting `_v9_scenarios`'s
    two writes: the helper-level assertions below failed as expected, a
    validated-model assertion did not (see task-7-report.md). Only the
    PRE-VALIDATION dict `_v9_scenarios` returns can distinguish a written
    value from a field default, so that is what this test asserts on."""
    raw = json.loads(_default_v8_document().model_dump_json())
    scenarios = raw["scenarios"]
    for key in ("base", "upside", "downside", "severe"):
        del scenarios[key]["phase_slip_phase_id"]
        del scenarios[key]["phase_slip_months"]
    # Non-vacuity: the input really does lack what the migration must add.
    for key in ("base", "upside", "downside", "severe"):
        assert "phase_slip_phase_id" not in scenarios[key]
        assert "phase_slip_months" not in scenarios[key]

    rebuilt = _v9_scenarios(scenarios)
    for key in ("base", "upside", "downside", "severe"):
        assert rebuilt[key]["phase_slip_phase_id"] is None
        assert rebuilt[key]["phase_slip_months"] == 0

    # And the full migration still validates and carries the same values.
    v9 = migrate_v8_to_v9({**raw, "scenarios": scenarios})
    for key in ("base", "upside", "downside", "severe"):
        s = getattr(v9.scenarios, key)
        assert s.phase_slip_phase_id is None
        assert s.phase_slip_months == 0


def test_writes_phase_id_none_on_every_package_and_fee_line_from_a_snapshot_with_neither_key():
    """Same fix-round-1 shape as the slip-fields test above, for `phase_id`:
    it lives on the SHARED `CostPackage`/`FeeLine` models and already
    defaults to `None` (Task 5), so a validated-model assertion is vacuous
    here for the identical reason. Confirmed by temporarily deleting
    `_v9_cost_plan`'s two writes: the helper-level assertions below failed as
    expected (see task-7-report.md). Raw dict, keys stripped, absence
    asserted first, then the PRE-VALIDATION dict `_v9_cost_plan` returns."""
    raw = json.loads(_v8_with_detailed_cost_plan().model_dump_json())
    cost_plan = raw["cost_plan"]
    for p in cost_plan["packages"]:
        del p["phase_id"]
    for f in cost_plan["fee_lines"]:
        del f["phase_id"]
    # Non-vacuity: there are real rows here, and none of them carry the key.
    assert len(cost_plan["packages"]) > 0
    assert len(cost_plan["fee_lines"]) > 0
    assert all("phase_id" not in p for p in cost_plan["packages"])
    assert all("phase_id" not in f for f in cost_plan["fee_lines"])

    rebuilt = _v9_cost_plan(cost_plan)
    assert all(p["phase_id"] is None for p in rebuilt["packages"])
    assert all(f["phase_id"] is None for f in rebuilt["fee_lines"])

    # And the full migration still validates and carries the same values.
    v9 = migrate_v8_to_v9({**raw, "cost_plan": cost_plan})
    assert len(v9.cost_plan.packages) > 0
    assert len(v9.cost_plan.fee_lines) > 0
    assert all(p.phase_id is None for p in v9.cost_plan.packages)
    assert all(f.phase_id is None for f in v9.cost_plan.fee_lines)


def test_double_migration_refused(v8_document):
    v9 = migrate_v8_to_v9(v8_document())
    with pytest.raises(ValueError, match="already a v9 document"):
        migrate_v8_to_v9(v9)
    # And via the dict path, which takes the other guard branch (mirrors
    # test_migrate_v8.py::test_v7_to_v8_refuses_to_double_migrate).
    with pytest.raises(ValueError, match="already a v9 document"):
        migrate_v8_to_v9(v9.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# migrate_inputs_to_v9 -- the two refusals (R8's carry-forward guard)
# ---------------------------------------------------------------------------

def test_unrecognised_version_refused():
    # The NEIGHBOUR, 10 -- the value that catches a predicate loosened from
    # `== 9` to `!= 8` (R10's finding, one version on).
    with pytest.raises(ValueError, match="migrate_inputs_to_v9: unrecognised inputs_version 10"):
        migrate_inputs_to_v9({"inputs_version": 10})


def test_document_tagged_v9_that_fails_the_structural_check_is_refused():
    with pytest.raises(ValueError, match="fails the v9 structural check"):
        migrate_inputs_to_v9({"inputs_version": 9, "finance": "not a dict"})


def test_is_v9_gates_on_the_container_never_on_the_programme_block():
    v9 = migrate_v8_to_v9(_default_v8_document())
    assert is_v9(v9.model_dump(mode="json")) is True
    assert is_v9(_default_v8_document().model_dump(mode="json")) is False


# ---------------------------------------------------------------------------
# The persistence boundary (Sec 18.7)
# ---------------------------------------------------------------------------

def test_every_new_field_survives_a_full_round_trip(v8_document_with_programme):
    """Sec 18.7. Pydantic's extra='ignore' DROPS an undeclared field silently,
    so a structural assertion of the form `"phase_id" not in row` can hold
    even with the migration helper bypassed entirely (R11's third vacuous
    guard, one version on). This asserts PRESENCE AND VALUE after a round
    trip, not absence before one -- the two non-vacuity tests above already
    cover the "does the migration actually write it" half."""
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    reloaded = parse_calculator_inputs(json.loads(v9.model_dump_json()))

    assert isinstance(reloaded, CalculatorInputsV9)
    assert reloaded.programme is not None
    assert [p.id for p in reloaded.programme.phases] == ["construction", "professional", "statutory"]
    assert reloaded.programme.category_phase_ids.construction == "construction"
    for key in ("base", "upside", "downside", "severe"):
        s = getattr(reloaded.scenarios, key)
        assert s.phase_slip_phase_id is None
        assert s.phase_slip_months == 0
    assert len(reloaded.cost_plan.packages) > 0
    assert len(reloaded.cost_plan.fee_lines) > 0
    for p in reloaded.cost_plan.packages:
        assert p.phase_id is None
    for f in reloaded.cost_plan.fee_lines:
        assert f.phase_id is None


def test_a_populated_network_survives_the_round_trip_with_its_dependencies(v9_network_document):
    """The negative control for the test above: a written null surviving
    proves nothing about a written VALUE surviving. A predecessor list is the
    field most likely to be dropped by a missing model declaration."""
    reloaded = parse_calculator_inputs(json.loads(v9_network_document.model_dump_json()))
    phases = {p.id: p for p in reloaded.programme.phases}
    assert phases["construction"].predecessors[0].phase_id == "procurement"
    assert phases["construction"].predecessors[0].type == "FS"
    assert phases["construction"].predecessors[0].lag_months == 1
    assert phases["marketing"].slip_months == 2


# ---------------------------------------------------------------------------
# migrate_inputs_to_v9 -- the merge-onto-defaults branch
# ---------------------------------------------------------------------------

def test_merge_branch_carries_a_saved_populated_network_not_the_default_null(
    v8_document_with_programme,
):
    """The merge-onto-defaults branch of migrate_inputs_to_v9 must carry a
    saved, populated network through with its `phases` intact, not revert it
    to the default document's `None` -- the same shape as R10's cost_plan-merge
    defect and R11's vat one, and the v9 instance of that recurring class.

    (Note: in THIS implementation, `_merge_saved_onto_defaults`'s own
    `{**defaults, **saved, ...}` spread already carries a present `programme`
    key through, so migrate_inputs_to_v9's explicit trailing
    `"programme": snapshot.get("programme")` line is not independently
    load-bearing for a snapshot shaped like this one -- confirmed by removing
    it and re-running this test. It is kept anyway as a defensive mirror of
    the TS port and the cost_plan/vat lines beside it; this test asserts the
    BEHAVIOUR the brief requires -- a saved network survives the merge
    branch -- not sensitivity to that one line.)"""
    snapshot = json.loads(migrate_v8_to_v9(v8_document_with_programme).model_dump_json())
    # Non-vacuity: the stored snapshot really does carry a live network.
    assert len(snapshot["programme"]["phases"]) == 3

    merged = migrate_inputs_to_v9(snapshot)
    assert merged.programme is not None
    assert [p.id for p in merged.programme.phases] == ["construction", "professional", "statutory"]
    assert [p.start_offset for p in merged.programme.phases] == [2, 0, 1]
    assert [p.duration_months for p in merged.programme.phases] == [9, 5, 4]
