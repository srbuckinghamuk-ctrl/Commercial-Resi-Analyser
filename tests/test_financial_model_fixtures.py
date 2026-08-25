import copy
import json
import re
from dataclasses import asdict, replace
from pathlib import Path
from typing import NamedTuple

import pytest

from app.financial_model import AppraisalRun, run_appraisal
from app.financial_model.engine import exit_fee_amount, money_round
from app.financial_model.metrics import pct
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.migrate import (
    PACKAGE_TO_PHASE,
    PROGRAMME_FIELD_ALIASES,
    migrate_inputs,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
    migrate_inputs_to_v7,
    migrate_inputs_to_v8,
    migrate_inputs_to_v9,
    migrate_inputs_to_v10,
    migrate_inputs_to_v11,
    migrate_inputs_to_v12,
)
from app.financial_model.schedule import build_schedule
from app.financial_model.validation import ValidationIssue, validate_inputs
from app.financial_model.sensitivity import (
    DEFAULT_SENSITIVITY_CONFIG,
    SensitivityAxis,
    SensitivityConfig,
    TornadoRange,
    run_sensitivity,
)
from app.financial_model.types import (
    AnyCalculatorInputs,
    CalculatorInputsV5,
    CalculatorInputsV7,
    CalculatorInputsV9,
    CategoryPhaseIds,
    cost_plan_from_legacy_costs,
    Phase,
    ProgrammeInputs,
    ProgrammeNetwork,
    ProgrammePackage,
    ProgrammePackages,
    SalesPhasingInputs,
    ScenarioOverrides,
    SalesPhasingTranche,
    SimpleSpendCurve,
    parse_calculator_inputs,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))

# The corpus is loaded by directory scan, so a fixture file that is deleted, renamed or
# never committed would silently reduce coverage instead of failing. This explicit roster
# is the "fixture list" and mirrors golden-fixtures.test.ts's EXPECTED_FIXTURE_STEMS:
# adding a golden fixture means adding its stem here (and there) too.
EXPECTED_FIXTURE_STEMS = [
    "a-all-cash",
    "f-dev-finance-12mo",
    "g-lender-valuation",
    "h-programme-scurve",
    "i-phased-sales",
    "j-blended-refinance",
    "k-sensitivity",
    "l-retain-all",
    "m-wales-jurisdiction",
    "n-area-bridge",
    "o-ancillary-value",
    "p-scotland-levered",
    "q-detailed-cost-plan",
    "r-vat-quarterly",
    "s-dated-programme",
    "t-investment-case",
    "u-investment-case-ltv-binds",
    "v-exhausted-reserve",
    "w-monitoring-on-site",
    "x-unit-sales-ledger",
]

# Every fixture that carries its own `inputs` document, i.e. everything the run_appraisal
# parametrisations below can run. Fixture K (kind "sensitivity", spec Sec 12) names a
# `base_fixture` instead of carrying inputs -- see model-governance.md Sec 2.1 -- so it is
# asserted by TestFixtureKSensitivity at the end of this module instead. Mirrors
# golden-fixtures.test.ts's `appraisalFixtures`.
APPRAISAL_FIXTURES = [
    p for p in FIXTURES
    if json.loads(p.read_text(encoding="utf-8")).get("kind") != "sensitivity"
]

# Minimal flat-key -> run-structure mapping for the fixture keys that are not direct
# AppraisalResultV2 attributes. Every other expected_metrics key is a real, direct
# AppraisalResultV2 attribute, asserted via getattr below without this indirection.
#
# The mapper takes the whole AppraisalRun (widened in Release 3a from the previous
# cost_to_complete-only signature, mirroring golden-fixtures.test.ts's FLAT_KEYS) so a
# pinnable quantity living outside `metrics` -- like the ledger's funding gap -- can be
# pinned without restructuring the harness.
_FLAT_KEYS = {
    # spec Sec 5.10, Release 2b Task 6
    "cost_to_complete_first_shortfall_month": (
        lambda r: r.metrics.cost_to_complete.first_shortfall_month
        if r.metrics.cost_to_complete else None
    ),
    "cost_to_complete_max_shortfall_pence": (
        lambda r: r.metrics.cost_to_complete.max_shortfall_pence
        if r.metrics.cost_to_complete else None
    ),
    # spec Sec 4.2 step 3 ("cost overruns never create facility"), Release 3a: the
    # accumulated unfunded cost. It is the headline behaviour of fixture H, so it must be
    # pinned, but it is a ledger total rather than a summary metric.
    "funding_gap_pence": lambda r: r.model.totals.funding_gap_pence,
    # spec Sec 4.4.1 (calc 2.3.0), Release 3b: the phased-disposal redemption fields.
    # Like funding_gap_pence above, these are `model` properties rather than summary
    # metrics, so they reach the harness through the same AppraisalRun-wide mapper. The
    # declining schedule is pinned as two parallel flat arrays (months / balances)
    # rather than an array of objects, mirroring golden-fixtures.test.ts's FLAT_KEYS.
    "redemption_balance_at_disposal_pence": lambda r: r.model.redemption_balance_at_disposal_pence,
    "redemption_schedule_months": lambda r: [e.month for e in r.model.redemption_schedule],
    "redemption_schedule_balances_pence": (
        lambda r: [e.balance_pence for e in r.model.redemption_schedule]
    ),
    # R9 spec Sec 15.5, fixture O: gross sale receipts. GDV counts every unit's
    # ancillary, receipts count only the SOLD units' -- under a blended exit the two
    # figures must differ by exactly the retained units' ancillary, and neither number
    # alone can prove that. A schedule total rather than a summary metric, hence the
    # mapper. Mirrors golden-fixtures.test.ts's FLAT_KEYS.
    "gross_sales_pence": lambda r: r.schedule.totals.gross_sales_pence,
    # R10 spec Sec 16, fixture Q: cost_plan.contingency and cost_plan.fees are LISTS
    # of dataclasses, so a dotted expected_metrics path (which works fine for the
    # scalar cost_plan fields above it) cannot reach one -- _resolve_path does
    # getattr(root, part), and a list has no attribute named "0" or "general".
    # Mirrors golden-fixtures.test.ts's six contingency mappers.
    "cost_plan_contingency_general_base_pence": (
        lambda r: next((c.base_pence for c in r.metrics.cost_plan.contingency if c.name == "general"), None)
    ),
    "cost_plan_contingency_general_amount_pence": (
        lambda r: next((c.amount_pence for c in r.metrics.cost_plan.contingency if c.name == "general"), None)
    ),
    "cost_plan_contingency_existing_building_base_pence": (
        lambda r: next(
            (c.base_pence for c in r.metrics.cost_plan.contingency if c.name == "existing_building"), None
        )
    ),
    "cost_plan_contingency_existing_building_amount_pence": (
        lambda r: next(
            (c.amount_pence for c in r.metrics.cost_plan.contingency if c.name == "existing_building"), None
        )
    ),
    "cost_plan_contingency_abnormal_base_pence": (
        lambda r: next((c.base_pence for c in r.metrics.cost_plan.contingency if c.name == "abnormal"), None)
    ),
    "cost_plan_contingency_abnormal_amount_pence": (
        lambda r: next((c.amount_pence for c in r.metrics.cost_plan.contingency if c.name == "abnormal"), None)
    ),
    # Same reasoning for the two percentage fee lines (spec Sec 8 "fee base
    # isolation"): found by basis rather than code, since the fixture's whole point
    # is that the two bases resolve to different figures.
    "cost_plan_fee_pct_construction_total_base_pence": (
        lambda r: next(
            (f.base_pence for f in r.metrics.cost_plan.fees if f.basis == "pct_of_construction_total"), None
        )
    ),
    "cost_plan_fee_pct_construction_total_amount_pence": (
        lambda r: next(
            (f.amount_pence for f in r.metrics.cost_plan.fees if f.basis == "pct_of_construction_total"), None
        )
    ),
    "cost_plan_fee_pct_base_build_base_pence": (
        lambda r: next(
            (f.base_pence for f in r.metrics.cost_plan.fees if f.basis == "pct_of_base_build"), None
        )
    ),
    "cost_plan_fee_pct_base_build_amount_pence": (
        lambda r: next(
            (f.amount_pence for f in r.metrics.cost_plan.fees if f.basis == "pct_of_base_build"), None
        )
    ),
    # R11 spec Sec 17.4, fixture R: the schedule's own construction spend curve,
    # pinned as a flat array so an explicit `programme` block (Ruling R16) that
    # spread over the wrong number of months is caught directly, before trusting
    # any VAT figure built on top of it. Mirrors golden-fixtures.test.ts.
    "uses_construction_pence": lambda r: [u.construction_pence for u in r.schedule.uses],
    # R11 spec Sec 17.4's worked cycle, as three flat month-indexed arrays rather
    # than reaching into metrics.vat.months (a list of dataclasses) with a dotted
    # path -- the same reasoning as the six contingency/fee mappers above.
    "vat_months_incurred_pence": lambda r: [m.incurred_pence for m in r.metrics.vat.months],
    "vat_months_reclaimed_pence": lambda r: [m.reclaimed_pence for m in r.metrics.vat.months],
    "vat_months_carry_pence": lambda r: [m.carry_pence for m in r.metrics.vat.months],
    # R12 spec Sec 18.10, fixture S: the derived ProgrammeResult. It hangs off the
    # SCHEDULE (schedule.programme), not off metrics, so a dotted expected_metrics
    # path cannot reach it at all -- the same reasoning as funding_gap_pence and the
    # redemption arrays above. The per-phase figures are pinned as four parallel flat
    # arrays in programme.phases[] order (which is the INPUT phases[] order) rather
    # than as a list of objects, keeping the fixture JSON language-neutral: this
    # engine holds DerivedPhase dataclasses here and the TS engine holds objects.
    #
    # programme_phase_ids is not decoration. Without it the other three arrays are
    # positional against a shape nothing pins, so a reordering of phases[] would
    # silently re-key every start, finish and float.
    "programme_finish_month": (
        lambda r: r.schedule.programme.finish_month if r.schedule.programme else None
    ),
    "programme_critical_path": (
        lambda r: list(r.schedule.programme.critical_path) if r.schedule.programme else None
    ),
    "programme_phase_ids": (
        lambda r: [p.id for p in r.schedule.programme.phases] if r.schedule.programme else None
    ),
    "programme_phase_start_months": (
        lambda r: [p.start_month for p in r.schedule.programme.phases]
        if r.schedule.programme else None
    ),
    "programme_phase_finish_months": (
        lambda r: [p.finish_month for p in r.schedule.programme.phases]
        if r.schedule.programme else None
    ),
    "programme_phase_total_float_months": (
        lambda r: [p.total_float_months for p in r.schedule.programme.phases]
        if r.schedule.programme else None
    ),
    # R14 spec Sec 20.4, fixture W: the four monitoring-statement pins held back at
    # Task 8 (see the fixture's own note) because the golden harness resolves an
    # unmapped key as a direct `metrics` attribute, and `monitoring_statement` was
    # not wired into `metrics` until this task. `lender_eligible_ratio` is a flat
    # convenience name for the same figure fixture W already pins through the
    # dotted `cost_plan.lender_eligible_ratio` path (which needs no mapper).
    # Mirrors golden-fixtures.test.ts's four monitoring mappers.
    "monitoring_shortfall_pence": (
        lambda r: r.metrics.monitoring_statement.shortfall_pence
        if r.metrics.monitoring_statement else None
    ),
    "monitoring_estimated_final_cost_pence": (
        lambda r: r.metrics.monitoring_statement.totals.estimated_final_cost_pence
        if r.metrics.monitoring_statement else None
    ),
    "monitoring_surplus_pence": (
        lambda r: r.metrics.monitoring_statement.surplus_pence
        if r.metrics.monitoring_statement else None
    ),
    "lender_eligible_ratio": lambda r: r.metrics.cost_plan.lender_eligible_ratio,
    # R13b spec Sec 22.6, fixture X: unit_sales.units/months are LISTS, so a
    # dotted path cannot reach them (the cost_plan.contingency reasoning above).
    "unit_sales_unit_ids": lambda r: [u["unit_id"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_gross_pence": lambda r: [u["gross_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_deposit_pence": lambda r: [u["deposit_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_deposit_released_pence": (
        lambda r: [u["deposit_released_pence"] for u in r.metrics.unit_sales["units"]]
    ),
    "unit_sales_unit_agent_fee_pence": lambda r: [u["agent_fee_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_legal_fee_pence": lambda r: [u["legal_fee_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_net_pence": lambda r: [u["net_pence"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_exchange_months": lambda r: [u["exchange_month"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_unit_completion_months": lambda r: [u["completion_month"] for u in r.metrics.unit_sales["units"]],
    "unit_sales_deposits_received_pence": (
        lambda r: [m["deposits_received_pence"] for m in r.metrics.unit_sales["months"]]
    ),
    "receipts_gross_sale_pence": lambda r: [x.gross_sale_pence for x in r.schedule.receipts],
}


def _resolve_path(root, path: str):
    """Resolves a dotted expected_metrics key (R9: ``area_bridge.<field>``) against the
    metrics object. A plain key is just a one-segment path. Mirrors
    golden-fixtures.test.ts's ``resolvePath``: AreaBridgeResult has 23 fields, and
    pinning them individually keeps the fixture JSON language-neutral -- pinning the
    whole object would compare this dataclass against a JSON dict and never pass.

    R13 fix-wave BLOCKING 2. `metrics.investment_case` (spec Sec 19.6) is a plain
    dict at runtime -- `InvestmentCaseResult` and its nested `stabilised`/
    `valuation`/`takeout` are all TypedDicts, not dataclasses -- so a segment
    that lands on one needs `[part]`, not `getattr`. `resolvePath` in
    golden-fixtures.test.ts never had this problem: JS bracket access works
    identically on a class instance or a plain object, so only this engine's
    getattr-only walk needed widening."""
    for part in path.split("."):
        root = root[part] if isinstance(root, dict) else getattr(root, part)
    return root


def _version_of(doc: dict) -> int:
    return doc["inputs"].get("inputs_version", 2)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _assert_pins(run: AppraisalRun, pins: dict, label: str) -> None:
    for key, expected in pins.items():
        mapper = _FLAT_KEYS.get(key)
        actual = mapper(run) if mapper else _resolve_path(run.metrics, key)
        assert actual == expected, f"{label}.{key}: {actual} != {expected}"


def _assert_expected_metrics(run: AppraisalRun, doc: dict, label: str) -> None:
    _assert_pins(run, doc["expected_metrics"], label)


def test_every_expected_fixture_file_is_present_in_the_shared_corpus() -> None:
    assert [p.name for p in FIXTURES] == [f"{s}.json" for s in EXPECTED_FIXTURE_STEMS]


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    _assert_expected_metrics(run, doc, path.stem)


# R9: the corpus now mixes v5 and v6 documents. migrate_inputs_to_v5 refuses a v6 one by
# design -- producing a v5 document would mean dropping ``areas`` and every unit's
# ``ancillary`` block -- so the migration-to-v5 identity is asserted over the v5 fixtures
# and the (stronger, corpus-wide) migration-to-v6 identity below covers everything.
_V5_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 5]
_V6_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 6]
# R10: symmetrically, migrate_inputs_to_v6 refuses a v7 document by design (it would
# have to drop `cost_plan` to produce one) -- see _RECOGNISED_VERSIONS_V6, which stops
# at 6 -- so a v7 fixture asserts the v7 property below instead of the v6 one.
_V7_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 7]
# R11: symmetrically again, migrate_inputs_to_v7 refuses a v8 document by design (it
# would have to drop `vat` to produce one) -- see _RECOGNISED_VERSIONS_V7, which stops
# at 7 -- so a v8 fixture asserts its own v8-specific properties instead of the v7 one.
_V8_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 8]
# R12: fixture S is BORN at v9 -- it has no v8 antecedent, so every migrate-to-vN
# parametrisation below excludes it by the same design that excluded fixture R from
# the v7 ones (migrate_inputs_to_v8 refuses a v9 document: _RECOGNISED_VERSIONS_V8
# stops at 8). Its own properties are asserted by its pinned expected_metrics and by
# the v9-specific tests further down.
_V9_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 9]
# R13 Task 5b: the two v10-native investment-case fixtures (spec §19). R14
# Task 2 adds a third, v-exhausted-reserve, also stored at v10 (spec §4; v11
# does not exist yet).
_V10_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 10]
# R14 Task 8: fixture W is BORN at v11 -- it is the corpus's first v11-native
# document (spec Sec 20.2), so every migrate-to-vN parametrisation below excludes it
# by the same design that excluded T/U/V from the v9 ones.
_V11_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 11]
# R13b Task 2: fixture X is BORN at v12 -- the corpus's first v12-native
# document (spec Sec 22), so every migrate-to-vN parametrisation below excludes
# it by the same design that excluded T/U/V/W from the v9 ones.
_V12_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 12]


def test_every_fixture_is_v5_to_v12_and_each_group_is_non_empty() -> None:
    """Mirrors golden-fixtures.test.ts. Without this, a fixture whose inputs_version
    was mistyped would drop out of every parametrisation rather than fail."""
    assert (
        len(_V5_FIXTURES) + len(_V6_FIXTURES) + len(_V7_FIXTURES) + len(_V8_FIXTURES)
        + len(_V9_FIXTURES) + len(_V10_FIXTURES) + len(_V11_FIXTURES) + len(_V12_FIXTURES)
        == len(APPRAISAL_FIXTURES)
    )
    assert len(_V5_FIXTURES) > 0
    assert [p.stem for p in _V6_FIXTURES] == [
        "n-area-bridge", "o-ancillary-value", "p-scotland-levered",
    ]
    assert [p.stem for p in _V7_FIXTURES] == ["q-detailed-cost-plan"]
    assert [p.stem for p in _V8_FIXTURES] == ["r-vat-quarterly"]
    assert [p.stem for p in _V9_FIXTURES] == ["s-dated-programme"]
    assert [p.stem for p in _V10_FIXTURES] == [
        "t-investment-case", "u-investment-case-ltv-binds", "v-exhausted-reserve",
    ]
    assert [p.stem for p in _V11_FIXTURES] == ["w-monitoring-on-site"]
    assert [p.stem for p in _V12_FIXTURES] == ["x-unit-sales-ledger"]


def test_the_v9_corpus_contains_a_float_bearing_phase_and_a_critical_phase() -> None:
    """R12 spec Sec 13 guard 1's FIXTURE REQUIREMENT, asserted rather than assumed.

    A network in which every phase is critical makes the float column untestable and
    the slip-asymmetry guard vacuous: "slipping a float-bearing phase leaves the
    finish unchanged" has no witness to run on. The pinned
    programme_phase_total_float_months array states the floats, but a pin can be
    edited to match a regression; this derives the claim from the run.

    Both arms matter. Without the second, a network with NO critical phase at all --
    an impossibility that would nonetheless mean the backward pass had stopped
    working -- would satisfy the first. Mirrors golden-fixtures.test.ts."""
    assert len(_V9_FIXTURES) > 0
    for path in _V9_FIXTURES:
        doc = _load_fixture(path)
        programme = run_appraisal(parse_calculator_inputs(doc["inputs"])).schedule.programme
        assert programme is not None, f"{path.stem} must produce a derived programme block"
        floats = [p.total_float_months for p in programme.phases]
        assert max(floats) >= 1, f"{path.stem}: no phase carries float"
        assert len(programme.critical_path) > 0, f"{path.stem}: no phase is critical"
        # And the critical path is exactly the zero-float set, in phases[] order --
        # the two are separately derived in programme.py (a filter over the
        # topological order versus a per-phase subtraction) and must agree.
        assert programme.critical_path == [
            p.id for p in programme.phases if p.total_float_months == 0
        ]


def test_fixture_s_tranches_are_anchored_and_their_month_offsets_are_not_the_resolved_months() -> None:
    """R12 spec Sec 18.6. Fixture S's two tranches carry a ``month_offset`` that
    deliberately DISAGREES with their anchors (20/21 stored, 16/19 resolved), so a
    dead anchor cannot hide behind an agreeing fallback. This states that asymmetry
    as a property of the document rather than leaving it to the fixture note.
    Mirrors golden-fixtures.test.ts."""
    doc = _load_fixture(FIXTURE_DIR / "s-dated-programme.json")
    inputs = parse_calculator_inputs(doc["inputs"])
    programme = run_appraisal(inputs).schedule.programme
    assert programme is not None
    by_id = {p.id: p for p in programme.phases}
    tranches = inputs.sales_phasing.tranches
    assert len(tranches) == 2
    for tr in tranches:
        assert tr.anchor is not None, "every tranche must be anchored"
        resolved = by_id[tr.anchor.phase_id].start_month + tr.anchor.offset_months
        assert resolved != tr.month_offset


@pytest.mark.parametrize("path", _V5_FIXTURES, ids=lambda p: p.stem)
def test_fixtures_reproduce_their_metrics_after_migration_to_v5(path: Path) -> None:
    """Release 3a identity guarantee (spec Sec 6.1 / design Sec 2.4), carried to v5
    by R8: the migration chain is purely additive, so running a fixture's inputs
    through the full normalisation chain (exactly what app.py does on every request)
    must reproduce that fixture's pinned expected_metrics unchanged -- not merely
    "close", byte-for-byte. These fixtures are already v5, so migrating one is a merge
    onto v5 defaults, which is itself worth asserting (the merge must not drop the
    programme block, nor the R8 acquisition block)."""
    doc = _load_fixture(path)
    # migrate_inputs_to_v5 returns a validated CalculatorInputsV5 directly
    # (unlike migrate_inputs_to_v4, which returns a plain dict).
    v5 = migrate_inputs_to_v5(doc["inputs"])
    assert v5.inputs_version == 5
    _assert_expected_metrics(run_appraisal(v5), doc, f"{path.stem}[migrated-to-v5]")


# R10: restricted to the pre-v7 fixtures (v5 + v6) -- migrate_inputs_to_v6 refuses a
# v7 document by design, mirroring the v5-fixtures restriction above. The stronger,
# corpus-wide statement is test_fixtures_reproduce_their_metrics_after_migration_to_v7
# below. R11 widens the exclusion to v7 or v8 -- migrate_inputs_to_v6 refuses v8 the
# same way (_RECOGNISED_VERSIONS_V6 stops at 6). R13 Task 5b widens it once
# more to v10 -- migrate_inputs_to_v6 refuses a v10 document identically (it
# would have to drop `vat`, `programme`'s v9 shape, `refinance`'s v10
# narrowing AND `investment_case` to produce a v6 one). R14 Task 8 widens it
# once more to v11 -- fixture W is v11-native and migrate_inputs_to_v6 refuses
# it for the same reason, one version further on (`monitoring` too).
_PRE_V7_FIXTURES = [
    p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) not in (7, 8, 9, 10, 11, 12)
]


@pytest.mark.parametrize("path", _PRE_V7_FIXTURES, ids=lambda p: p.stem)
def test_fixtures_reproduce_their_metrics_after_migration_to_v6(path: Path) -> None:
    """R9: the same identity guarantee at the head of the chain -- migrate_inputs_to_v6
    accepts a v5 document (upgrade path) and a v6 one (merge branch) alike. The merge
    branch is the one that matters for the new fixtures: it must carry ``areas`` and
    every unit's ``ancillary`` through untouched, and a merge that silently reset
    either to the zeroed default would move fixture N's construction cost by
    16,170,000p and fixture O's GDV by 4,500,000p rather than pass."""
    doc = _load_fixture(path)
    v6 = migrate_inputs_to_v6(doc["inputs"])
    assert v6.inputs_version == 6
    _assert_expected_metrics(run_appraisal(v6), doc, f"{path.stem}[migrated-to-v6]")


# R11: restricted to the pre-v8 fixtures -- migrate_inputs_to_v7 refuses a v8
# document by design (_RECOGNISED_VERSIONS_V7 stops at 7). Fixture R (v8) asserts
# its own identity guarantee in test_fixture_r_reproduces_its_metrics_after_
# migration_to_v8 below instead. R13 Task 5b widens it once more to v10 --
# migrate_inputs_to_v7 refuses a v10 document identically (it would have to
# drop `refinance`'s v10 narrowing and `investment_case` to produce a v7 one).
# R14 Task 8 widens it once more to v11, for the identical reason (`monitoring`).
_PRE_V8_FIXTURES = [
    p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) not in (8, 9, 10, 11, 12)
]


@pytest.mark.parametrize("path", _PRE_V8_FIXTURES, ids=lambda p: p.stem)
def test_fixtures_reproduce_their_metrics_after_migration_to_v7(path: Path) -> None:
    """R10 Task 11: the same identity guarantee one version further on, and the one
    that now covers v5 through v7 -- migrate_inputs_to_v7 accepts v5, v6 and v7
    documents alike (upgrade, upgrade, merge). The merge branch matters for
    fixture Q: it must carry ``cost_plan`` through untouched, and a merge that
    silently reset it to the default headline plan would move Q's construction cost
    by 6,040,000p (the whole contingency total) rather than pass. A fixture being
    UPGRADED (v5/v6) must instead get exactly the plan cost_plan_from_legacy_costs
    derives from its own conversion_costs -- the same function the engine's pre-v7
    fallback uses, per types.py's own docstring on why a second, divergent copy
    would be unsafe."""
    doc = _load_fixture(path)
    v7 = migrate_inputs_to_v7(doc["inputs"])
    assert v7.inputs_version == 7
    if _version_of(doc) == 7:
        assert v7.cost_plan == parse_calculator_inputs(doc["inputs"]).cost_plan
    else:
        assert v7.cost_plan == cost_plan_from_legacy_costs(
            parse_calculator_inputs(doc["inputs"]).conversion_costs
        )
    _assert_expected_metrics(run_appraisal(v7), doc, f"{path.stem}[migrated-to-v7]")


@pytest.mark.parametrize("path", _V8_FIXTURES, ids=lambda p: p.stem)
def test_fixture_r_reproduces_its_metrics_after_migration_to_v8(path: Path) -> None:
    """R11: fixture R's own identity guarantee. It is already v8, so
    migrate_inputs_to_v8 merges it onto v8 defaults (_RECOGNISED_VERSIONS_V8 =
    1..8) rather than writing the inert block, and that merge must carry its LIVE
    vat block through untouched -- exactly the claim the v6/v7 tests above assert
    for ``areas`` and ``cost_plan`` on a fixture that is already at the target
    version. Mirrors golden-fixtures.test.ts's identically-named describe block."""
    doc = _load_fixture(path)
    migrated = migrate_inputs_to_v8(doc["inputs"])
    assert migrated.inputs_version == 8
    assert migrated.vat == parse_calculator_inputs(doc["inputs"]).vat
    _assert_expected_metrics(run_appraisal(migrated), doc, f"{path.stem}[migrated-to-v8]")


# ---------------------------------------------------------------------------
# R12 Task 8 (spec Sec 18.7, guard 6 of Sec 13) -- the v8 -> v9 migration
# identity gates. Mirrors golden-fixtures.test.ts's identically-named describe
# blocks. This is the release's main protection for real stored appraisal
# data: gate 1 proves no computed figure moves, gate 2 proves validate_inputs
# returns the SAME issue set either side of migration. Gate 2 exists because
# of a real defect (R11): a migration that moved no number gave every
# short-term document a hard validation error from a block the engine
# otherwise ignored, silently downgrading its report to DRAFT while gate 1
# stayed green throughout. Gate 1 cannot see that axis; gate 2 is written for
# exactly it.
#
# R12 Task 12b -- what gate 1 proves NOW. Task 8's exclusion of the two
# programme-bearing fixtures is gone (the network arms it existed for are
# wired: Tasks 9-12a), so the gate runs over every fixture with a v8
# antecedent and covers BOTH of the migration's arms:
#
#   (a) the five additive no-ops -- `phase_id: None` on every cost package
#       and fee line, `anchor: None` on every sales-phasing tranche and on
#       refinance, `phase_slip_phase_id: None` / `phase_slip_months: 0` on
#       all four scenarios -- move no computed figure. Every fixture in
#       scope exercises this arm.
#
#   (b) the three-package -> precedence-network conversion moves no computed
#       figure either. Exercised by `h-programme-scurve` and
#       `r-vat-quarterly`, the only two in-scope fixtures whose stored
#       `programme` is non-null (asserted below, so this claim cannot go
#       vacuous if a fixture is edited). This holds because migration writes
#       no per-line `phase_id`: every cost line resolves to its category
#       default, the (phase, category) bucket total IS the category total,
#       and the derived-window spread is bit-identical to the legacy arm's
#       single spread.
#
# What gate 1 still does NOT compare is `schedule.programme` itself -- None
# on the v8 side, the derived network on the v9 side. That block is a v9
# addition with no v8 counterpart, so there is nothing to be identical to;
# it is pinned by the programme fixtures' own expectations and by Task
# 9-12a's derivation tests, not here.
# ---------------------------------------------------------------------------

# Rule 2 (Task 8's TEMPORARY exclusion of `h-programme-scurve` and
# `r-vat-quarterly`) is DELETED here, Task 12b. It existed because both
# engines were deliberately made to fail loudly on a populated v9 programme
# network before the network arms were wired; Tasks 9-12a wired them, so the
# exclusion has served its purpose and the two programme-bearing fixtures are
# now the most valuable documents in this gate's scope -- they are the only
# ones that make the migration's network conversion execute. Rule 3 (the
# exclusion is self-policing) goes with it; an empty exclusion needs no
# policing, and the test below now polices the opposite property.

# Rule 1 (RETAINED): only fixtures whose STORED inputs_version is 8 or below
# have a v8 antecedent to migrate from -- migrate_inputs_to_v8 called on an
# already-v9 document would raise, and there would be nothing to compare. No
# v9-tagged fixture exists yet; a later release adds one, so the filter stays.
_MIGRATION_V9_GATE_FIXTURES = [
    p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) <= 8
]

# The two fixtures whose stored `programme` is non-null, and therefore the
# only ones for which migration builds a precedence network at all. Named here
# so the gate can assert they are IN scope rather than merely hoping.
_PROGRAMME_BEARING_STEMS = ("h-programme-scurve", "r-vat-quarterly")


def test_migration_v9_gate_fixture_set_is_non_empty_and_excludes_only_v9_born_fixtures() -> None:
    """The only legitimate reason to be out of scope is having no v8
    antecedent; today that set is empty, and when a v9-born fixture is added
    this still passes while any OTHER exclusion fails.

    Fix round 1, Finding 3: a PINNED FLOOR, not `> 0`. The equality below
    compares `not (version <= 8)` against `version > 8` -- both derived from
    the same expression -- so it catches an ADDED second filter clause (its
    purpose) but not a NARROWED one (`<= 7`), which moves both sides together.
    The floor is what catches a silently shrinking corpus: 13 is today's count
    and the corpus only ever grows."""
    assert len(_MIGRATION_V9_GATE_FIXTURES) >= 13
    excluded = [p.stem for p in APPRAISAL_FIXTURES if p not in _MIGRATION_V9_GATE_FIXTURES]
    assert excluded == [p.stem for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) > 8]


def test_both_programme_bearing_fixtures_are_in_gate_scope_and_really_carry_a_legacy_programme() -> None:
    """The point of Task 12b. If either of these ever drops out of scope -- by
    exclusion, by being re-stamped v9, or by losing its `programme` block --
    the migration's network conversion silently stops being covered by gate 1,
    which is the state Task 8 shipped and this task exists to end. Mirrors
    golden-fixtures.test.ts's identically-named test."""
    stems = [p.stem for p in _MIGRATION_V9_GATE_FIXTURES]
    for stem in _PROGRAMME_BEARING_STEMS:
        assert stem in stems
        inputs = _load_fixture(FIXTURE_DIR / f"{stem}.json")["inputs"]
        assert inputs.get("programme") is not None
        # And migration really does build a network from it.
        migrated = migrate_inputs_to_v9(inputs)
        assert migrated.programme is not None
        assert len(migrated.programme.phases) == 3
    # And no OTHER in-scope fixture carries one -- so the two named above are
    # exhaustive, not merely examples.
    bearing = [
        p.stem for p in _MIGRATION_V9_GATE_FIXTURES
        if _load_fixture(p)["inputs"].get("programme") is not None
    ]
    assert sorted(bearing) == sorted(_PROGRAMME_BEARING_STEMS)


class _CanonicalIssue(NamedTuple):
    """An issue with its field canonicalised under PROGRAMME_FIELD_ALIASES.
    A NamedTuple so it compares and sorts exactly as the plain triple it
    replaces, while still answering ``.severity`` / ``.field`` / ``.message``
    -- which lets the v9-only-rule predicate run on the CANONICAL form, the
    same form the comparison itself sees. Mirrors golden-fixtures.test.ts's
    ``canonicalIssue``."""

    severity: str
    field: str
    message: str


def _canonical_issue(i) -> _CanonicalIssue:
    return _CanonicalIssue(i.severity, PROGRAMME_FIELD_ALIASES.get(i.field, i.field), i.message)


def _issue_triples(issues) -> list[tuple[str, str, str]]:
    """Canonicalises under PROGRAMME_FIELD_ALIASES and nothing else -- every
    other issue matches on field AND message with no aliasing at all.
    Fix round 1, Finding 4 (already correct on this side of the port, kept
    as-is): sorts the FULL (severity, field, message) triple, not field+message
    alone -- two issues sharing a field and message but differing in severity
    must not be treated as interchangeable."""
    return sorted(tuple(_canonical_issue(i)) for i in issues)


def _strip_version_fields(run: AppraisalRun) -> dict:
    """Gate 1 compares the WHOLE computed result, not a hand-picked list of
    metrics -- a chosen list is a guard that only watches what its author
    remembered.

    Fix round 1, Finding 2: `AppraisalRun` has six fields. Four are compared
    here -- `metrics`, `model`, `schedule`, `reconciliation` -- and two are
    deliberately left out, named rather than silently dropped: `inputs`
    differs by construction (it IS the migrated document, v8 shape vs v9
    shape), and `validation` is covered by gate 2 below, which already
    asserts on it directly with the alias canonicalisation this comparison
    would otherwise have to duplicate. `reconciliation.issues` gets that same
    canonicalisation here, because `reconciliation` carries `report_safe` --
    the DRAFT flag this whole task exists to protect -- and a programme-field
    alias could in principle appear inside it too.

    `calc_version` (2.10.0 vs 2.11.0) and the new `schedule.programme` block
    legitimately differ and are the only two fields stripped out of the four
    compared members. Since Task 12b removed the exclusion,
    `schedule.programme` really does differ for the two programme-bearing
    fixtures -- None on the v8 side, the derived network on the v9 side --
    because it is a v9 addition with no v8 counterpart. Everything the network
    FEEDS (the monthly spend, the facility, every metric) is inside the
    comparison and must be identical."""
    metrics = asdict(run.metrics)
    del metrics["calc_version"]
    schedule = asdict(run.schedule)
    del schedule["programme"]
    reconciliation = asdict(run.reconciliation)
    reconciliation["issues"] = _issue_triples(run.reconciliation.issues)
    return {
        "metrics": metrics, "model": asdict(run.model), "schedule": schedule,
        "reconciliation": reconciliation,
    }


def _with_term_months(inputs: dict, term_months: int) -> dict:
    doc = copy.deepcopy(inputs)
    doc["finance"] = {**doc["finance"], "term_months": term_months}
    return doc


# Task 12b. Gate 2 used to assert exact issue-set equality. With the two
# programme-bearing fixtures in scope that assertion is WRONG, not merely
# strict: the legacy three-package validation arm has NO OVERRUN RULE AT ALL,
# so a migrated document legitimately reports errors its v8 antecedent could
# never have produced. (Both fixtures breach the sale-tail rule at all three
# synthetic terms on BOTH sides -- that part still matches exactly; it is only
# the overrun errors that are new.)
#
# The exemption is a NAMED LIST of v9-only RULES, asserted below to hold
# exactly one entry -- the same self-policing discipline
# PROGRAMME_FIELD_ALIASES already carries. It is deliberately NOT the same
# kind of thing as that alias map: an alias is a field RENAME across the
# boundary, where the rule fires identically on both sides; this list is for
# rules that exist on one side only. Mirrors golden-fixtures.test.ts's
# V9_ONLY_VALIDATION_RULES.
#
# The overrun rule's MESSAGE shape is kept separate from the predicate: the
# "overrun really fires" control keys on this alone and then asserts severity
# and field independently. A control that reused the whole predicate could not
# tell a rule that stopped firing from a predicate narrowed past it.
_OVERRUN_MESSAGE_RE = re.compile(
    r"^Programme finishes month -?\d+; facility term is -?\d+\. "
    r"Phase '.+' ends -?\d+ months after maturity\.$"
)

_V9_ONLY_VALIDATION_RULES = {
    # spec Sec 18.8. A phase whose derived finish runs past facility maturity.
    # It is a property of the DERIVED network, and the legacy arm derives
    # nothing, so there is no v8 counterpart to compare against.
    #
    # Fix round 1, Finding 2: keyed on ALL THREE of the keys a ValidationIssue
    # actually has, not on the message alone. There is no stable rule id in
    # either engine, so message text is unavoidable -- but an unrelated field
    # emitting this shape, or this rule downgraded to a warning, must NOT be
    # exempted. Both would be a real change across the migration boundary and
    # gate 2 exists to see them.
    "overrun": lambda i: (
        i.severity == "error"
        and i.field.startswith("programme.phases.")
        and bool(_OVERRUN_MESSAGE_RE.match(i.message))
    ),
}


def _is_v9_only_rule_issue(issue) -> bool:
    return any(matches(issue) for matches in _V9_ONLY_VALIDATION_RULES.values())


def _compare_ex_v9_only(before_issues, after_issues) -> tuple[list, list]:
    """Property 3's comparison, extracted (fix round 1, Finding 1) so that its
    ONE-SIDEDNESS can be tested directly rather than asserted in prose.

    The v9-only exemption is applied to the ``after`` side ONLY. A v9-only-rule
    issue appearing on the ``before`` side would mean a LEGACY rule had started
    emitting a shape it has no business emitting -- that must fail the
    comparison, not be quietly dropped alongside its v9 twin.

    This matters more than it reads: the pre-migration side carries no such
    issue on any case today, so a "tidy-up" to a symmetric filter would be a
    SILENT no-op. R11 was defined by a guard that died from being widened, so
    the one-sidedness is pinned by its own synthetic test below.

    Returns the ``(before, after)`` pair rather than a bool so a gate failure
    still prints a readable diff. Mirrors golden-fixtures.test.ts's
    ``compareExV9Only``."""
    before = _issue_triples(before_issues)
    after = sorted(
        tuple(c) for c in map(_canonical_issue, after_issues) if not _is_v9_only_rule_issue(c)
    )
    return before, after


def _hard_issues(issues) -> list:
    return [i for i in issues if i.severity == "error"]


# Every gate-2 case: each in-scope fixture at its STORED term, plus the same
# fixture at synthetic terms 1, 2 and 3. The three properties below each run
# over the whole list, so a defect that only shows at a short term is caught
# by the same assertion as one that shows at the stored term.
_V9_GATE_CASES = [
    (f"{p.stem} @ {label}", doc)
    for p in _MIGRATION_V9_GATE_FIXTURES
    for label, doc in (
        [("stored term", copy.deepcopy(_load_fixture(p)["inputs"]))]
        + [(f"term {t}", _with_term_months(_load_fixture(p)["inputs"], t)) for t in (1, 2, 3)]
    )
]


_V9_GATE_CASE_IDS = [label for label, _doc in _V9_GATE_CASES]


@pytest.mark.parametrize("path", _MIGRATION_V9_GATE_FIXTURES, ids=lambda p: p.stem)
def test_v9_migration_gate_1_every_computed_figure_is_penny_identical(path: Path) -> None:
    """Task 12b: this gate now proves BOTH arms of the migration move no
    computed figure -- the five additive no-ops on every fixture, and the
    three-package -> precedence-network conversion on the two
    programme-bearing ones. See the module-level comment above for the full
    statement.

    Task 16 falsifiability audit. Single-line change that kills this guard:
    schedule.py's `resolved_phase_id`, `return getattr(network
    .category_phase_ids, category)` -> `return network.category_phase_ids
    .construction`. Verified: 2 of the 13 cases fail -- the two
    programme-bearing fixtures (h-programme-scurve, r-vat-quarterly), whose
    migrated networks resolve professional/statutory to their own category
    default and so shift window when that default is silently overridden --
    the other 11 (no `programme` block) are correctly unaffected. Reverted
    after confirming the guard, and the rest of this file, pass again clean.
    (Task 12b's own review additionally perturbed
    `construction.duration_months + 1` post-migration and found it moves
    profit on both programme-bearing fixtures -- a second, independent
    confirmation this gate is live, not vacuous.)"""
    doc = _load_fixture(path)
    before = run_appraisal(migrate_inputs_to_v8(doc["inputs"]))
    after = run_appraisal(migrate_inputs_to_v9(doc["inputs"]))
    assert _strip_version_fields(after) == _strip_version_fields(before)


# Task 16 falsifiability audit (gate 2). Single-line change that kills
# property 3 below: `_compare_ex_v9_only`'s `after = sorted(tuple(c) for c in
# map(_canonical_issue, after_issues) if not _is_v9_only_rule_issue(c))` ->
# dropping the `if not _is_v9_only_rule_issue(c)` filter entirely (no
# exemption applied at all). Task 12b's fix round 1 (Finding 1) made and ran
# exactly this class of mutation -- widening the filter to strip the v9-only
# issue from BOTH sides instead of just `after` -- and it failed exactly one
# test, `test_v9_migration_gate_2_property_3_comparison_is_one_sided`, and
# nothing else; dropping the filter outright is a strict superset of that
# same widening and fails property 3 itself on every case where the overrun
# rule fires (both programme-bearing fixtures at their short synthetic
# terms). This task's own mutation of the `overrun` predicate (see
# `test_v9_migration_gate_2_the_overrun_rule_really_fires`, below) is the
# same falsifiability discipline applied to the OTHER moving part of this
# gate -- the rule-membership predicate rather than the one-sidedness of its
# application.
def test_programme_field_aliases_has_exactly_three_entries_and_each_maps_name_to_same_name() -> None:
    """The bound. R11's lesson was that an exemption must be narrow BY
    CONSTRUCTION, not by intention -- this test is the construction, and
    because the map is derived from PACKAGE_TO_PHASE it constrains the
    migration's phase ids at the same time. Mirrors
    tests/test_migrate_v9.py::test_programme_field_aliases_is_derived_and_has_exactly_three_entries
    (Task 6/7) and golden-fixtures.test.ts's identically-named test.

    Fix round 1, Finding 5: the three names are pinned as LITERALS, not
    re-derived from PACKAGE_TO_PHASE and compared to themselves -- that
    would be tautological (a renamed package would pass this test while
    failing golden-fixtures.test.ts's literal-pinned twin, a mirror weaker
    than the original it mirrors)."""
    assert len(PROGRAMME_FIELD_ALIASES) == 3
    assert sorted(PROGRAMME_FIELD_ALIASES) == [
        "programme.packages.construction", "programme.packages.professional", "programme.packages.statutory",
    ]
    # PACKAGE_TO_PHASE is still exercised here, but as the SOURCE of a second,
    # independent check (its keys must be exactly these three names too), not
    # as the thing the alias map's own keys are compared against.
    assert sorted(PACKAGE_TO_PHASE) == [
        "construction", "professional", "statutory",
    ]
    for from_, to in PROGRAMME_FIELD_ALIASES.items():
        # The alias is legitimate ONLY because migration writes id = package name.
        assert to == from_.replace(".packages.", ".phases.")


def test_v9_only_validation_rule_list_has_exactly_one_entry_named() -> None:
    """Same discipline as the alias map above, for a different kind of
    exemption. An unpoliced list of "rules we do not compare" is a gate that
    stops gating one rule at a time. Mirrors golden-fixtures.test.ts."""
    assert list(_V9_ONLY_VALIDATION_RULES) == ["overrun"]


# The three properties. R11's actual failure: the v8 migration gave every
# document a block whose default made every term<=2 appraisal a hard error, so
# the migration silently downgraded them to DRAFT while the numeric gate
# stayed green. Terms 1-3 are run alongside each fixture's stored term because
# that is where the interesting behaviour lives; term 3 goes one step further
# than R11's own boundary, so a rule re-narrowed to a fixed "<= 2" cutoff
# would still be caught.
@pytest.mark.parametrize("label,doc", _V9_GATE_CASES, ids=_V9_GATE_CASE_IDS)
def test_v9_migration_gate_2_property_1_a_valid_document_never_becomes_invalid(label: str, doc: dict) -> None:
    before = _hard_issues(validate_inputs(migrate_inputs_to_v8(doc)))
    if before:
        return  # premise false; property 2 covers this case
    # UNCONDITIONAL -- no v9-only-rule exemption applies here. This is the
    # historical defect: a document that validated clean before migration and
    # reports DRAFT after it.
    assert _hard_issues(validate_inputs(migrate_inputs_to_v9(doc))) == [], label


@pytest.mark.parametrize("label,doc", _V9_GATE_CASES, ids=_V9_GATE_CASE_IDS)
def test_v9_migration_gate_2_property_2_an_invalid_document_never_becomes_valid(label: str, doc: dict) -> None:
    before = _hard_issues(validate_inputs(migrate_inputs_to_v8(doc)))
    if not before:
        return  # premise false; property 1 covers this case
    # Also UNCONDITIONAL, and it catches a real sibling of the R11 defect: v9
    # treats a zero-duration phase as a legal milestone where the legacy arm
    # rejected `duration < 1`, so a migration could silently UPGRADE a broken
    # document to report-safe.
    assert len(_hard_issues(validate_inputs(migrate_inputs_to_v9(doc)))) > 0, label


@pytest.mark.parametrize("label,doc", _V9_GATE_CASES, ids=_V9_GATE_CASE_IDS)
def test_v9_migration_gate_2_property_3_issue_sets_equal_except_v9_only_rules(label: str, doc: dict) -> None:
    before, after = _compare_ex_v9_only(
        validate_inputs(migrate_inputs_to_v8(doc)), validate_inputs(migrate_inputs_to_v9(doc)),
    )
    assert after == before, label


def test_v9_migration_gate_2_property_3_comparison_is_one_sided() -> None:
    """Fix round 1, Finding 1a. Synthetic, because no real case can produce
    this shape on the before side -- which is precisely why a symmetric filter
    would be a silent no-op over the corpus and needs a test that dies on the
    refactor rather than a comment asking nobody to do it. Mirrors
    golden-fixtures.test.ts's identically-named test."""
    overrun_shaped = ValidationIssue(
        severity="error",
        field="programme.phases.construction",
        message=(
            "Programme finishes month 7; facility term is 3. "
            "Phase 'Construction' ends 4 months after maturity."
        ),
    )
    shared = ValidationIssue(severity="warning", field="vat.registered", message="shared")
    assert _is_v9_only_rule_issue(overrun_shaped)  # the predicate really recognises it

    # AFTER side carries it -> exempted, comparison AGREES. The exemption doing
    # its job; without this half, deleting the filter outright would still pass
    # the half below.
    before, after = _compare_ex_v9_only([shared], [shared, overrun_shaped])
    assert after == before

    # BEFORE side carries it -> NOT exempted, comparison DISAGREES. A symmetric
    # filter strips it here too and makes these equal, so this assertion fails
    # on exactly the refactor that would weaken the gate.
    before, after = _compare_ex_v9_only([shared, overrun_shaped], [shared])
    assert after != before


def test_v9_migration_gate_2_no_pre_migration_document_carries_a_v9_only_rule_issue() -> None:
    """Fix round 1, Finding 1b: the invariant that makes the one-sidedness
    above safe today, asserted directly instead of assumed. The day a legacy
    rule starts emitting the overrun shape, this fails loudly. Checked on the
    CANONICALISED before side, because that is what the comparison actually
    sees (a legacy `programme.packages.*` field is aliased to
    `programme.phases.*` before any predicate runs)."""
    offenders = [
        label for label, doc in _V9_GATE_CASES
        if any(
            _is_v9_only_rule_issue(c)
            for c in map(_canonical_issue, validate_inputs(migrate_inputs_to_v8(doc)))
        )
    ]
    assert offenders == []


def test_v9_migration_gate_2_the_three_properties_are_not_vacuous_over_the_corpus() -> None:
    """Property 1's premise, property 2's premise, and property 3's exemption
    must each be satisfied by at least one case -- otherwise a property can
    pass by never applying to anything."""
    clean_before = dirty_before = exempted = 0
    for _label, doc in _V9_GATE_CASES:
        if _hard_issues(validate_inputs(migrate_inputs_to_v8(doc))):
            dirty_before += 1
        else:
            clean_before += 1
        exempted += sum(1 for i in validate_inputs(migrate_inputs_to_v9(doc)) if _is_v9_only_rule_issue(i))
    assert clean_before > 0
    assert dirty_before > 0
    assert exempted > 0


def test_v9_migration_gate_2_the_overrun_rule_really_fires() -> None:
    """Excluding a rule from gate 2 cannot be allowed to hide a dead rule.
    Without this, property 3's exemption would keep passing if the overrun
    rule were deleted, broken, or reworded out of its own predicate. Fixture
    H's migrated network finishes month 7; at a 3-month term all three phases
    run past maturity. Mirrors golden-fixtures.test.ts."""
    inputs = _load_fixture(FIXTURE_DIR / "h-programme-scurve.json")["inputs"]
    issues = validate_inputs(migrate_inputs_to_v9(_with_term_months(inputs, 3)))
    # Fix round 1, Finding 2: selected by MESSAGE SHAPE alone, then severity
    # and field asserted independently. Selecting with the full predicate would
    # make those two assertions tautological, and a predicate narrowed past the
    # real rule would then look like a rule that still fires.
    overruns = [i for i in issues if _OVERRUN_MESSAGE_RE.match(i.message)]
    assert len(overruns) == 3
    assert all(i.severity == "error" for i in overruns)
    assert sorted(i.field for i in overruns) == [
        "programme.phases.construction", "programme.phases.professional",
        "programme.phases.statutory",
    ]
    # ... and the predicate really does cover every one of them, so property
    # 3's exemption and the rule that fires are the same set, not two sets that
    # merely overlap.
    assert all(_is_v9_only_rule_issue(i) for i in overruns)
    # Task 12b's deferred gap (Task 16): the assertion above only proves the
    # predicate is a SUPERSET of the message-shaped set over THESE three
    # fields -- it would not notice a `field.startswith("programme.phases.")`
    # check replaced by an enumeration of exactly these three ids, which would
    # pass every assertion above by coincidence (this fixture's phases happen
    # to BE that trio). Two synthetic checks close that: the predicate must
    # accept a phase id this fixture does not have (proving it matches by
    # PREFIX, not by enumerating known ids)...
    arbitrary_phase_overrun = ValidationIssue(
        severity="error",
        field="programme.phases.some-other-phase-id-not-in-this-fixture",
        message=(
            "Programme finishes month 7; facility term is 3. "
            "Phase 'Other' ends 4 months after maturity."
        ),
    )
    assert _is_v9_only_rule_issue(arbitrary_phase_overrun)
    # ...and must reject the identical severity+message on a field OUTSIDE
    # `programme.phases.` -- otherwise the field check could be replaced with
    # `True` and nothing above would notice.
    assert not _is_v9_only_rule_issue(
        replace(arbitrary_phase_overrun, field="sales_phasing.tranches.0")
    )
    # Each phase quotes ITS OWN lateness, not the programme's (Task 9's fix
    # round 1, Finding 1) -- so the exemption is not swallowing a rule that has
    # silently degenerated to one message repeated three times.
    assert len({i.message for i in overruns}) == 3
    # And it does NOT fire at the stored term: a predicate that matched
    # everything would satisfy the assertions above just as well.
    assert [i for i in validate_inputs(migrate_inputs_to_v9(inputs)) if _is_v9_only_rule_issue(i)] == []


def test_v9_migration_gate_2_a_term_2_document_from_a_gated_fixture_really_does_produce_a_genuine_short_term_issue() -> None:
    """Fix round 1, Finding 3 (Task 8): the original version of this control
    asserted on fixture H, and the error satisfying it was the temporary "v9
    programme network... not yet implemented" placeholder that Task 10
    deletes, at which point the control would have silently stopped testing
    anything. It proved neither that a GATED document produces issues, nor
    that a short-term RULE is what fires.

    This version uses fixture I, which carries a `sales_phasing` block whose
    three tranches sit at months 9/10/11 of a 12-month term. Shortened to a
    2-month term, `term - 1 == 1`, so every tranche breaches sales_phasing's
    own permanent term bound -- a rule with nothing to do with programme
    scaffolding, and one that is NOT on the v9-only list, so property 3
    compares it on both sides."""
    doc = _load_fixture(FIXTURE_DIR / "i-phased-sales.json")
    shortened = _with_term_months(doc["inputs"], 2)
    issues = validate_inputs(migrate_inputs_to_v9(shortened))
    tail_issues = [i for i in issues if i.severity == "error" and i.field.startswith("sales_phasing.tranches")]
    assert len(tail_issues) > 0
    assert all(i.message == "Tranche month must be a whole month between 0 and 1." for i in tail_issues)
    # Sanity: this must not be satisfied by the scaffolding placeholder the
    # original control (mistakenly) relied on.
    assert not any("not yet implement" in i.message for i in issues)


# R9 Task 12. A fixture may pin the appraisal produced by one of its OWN named scenarios
# (spec Sec 12.1). Fixture O uses this to carry the ancillary split all the way through a
# -10% GDV stress: the stressed ancillary values are hand-derived, so a scenario binding
# that stressed internal value alone -- the pre-Task-7 behaviour -- fails here rather than
# passing on the internal figures. Mirrors golden-fixtures.test.ts's scenario loop.
_SCENARIO_CASES = [
    (path, name)
    for path in APPRAISAL_FIXTURES
    for name in _load_fixture(path).get("expected_scenarios", {})
]


def test_at_least_one_fixture_pins_a_scenario_appraisal() -> None:
    """Non-vacuity: an ``expected_scenarios`` block dropped by an edit would otherwise
    shrink the parametrisation below to nothing rather than fail."""
    assert [(p.stem, n) for p, n in _SCENARIO_CASES] == [("o-ancillary-value", "downside")]


@pytest.mark.parametrize(
    "path,scenario", _SCENARIO_CASES, ids=lambda x: x if isinstance(x, str) else x.stem,
)
def test_fixture_reproduces_its_hand_derived_scenario(path: Path, scenario: str) -> None:
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    overrides = getattr(inputs.scenarios, scenario)
    run = run_appraisal(apply_scenario(inputs, overrides))
    _assert_pins(run, doc["expected_scenarios"][scenario], f"{path.stem}[{scenario}]")


# Fix round 2 (R8 Task 5). Every fixture in the corpus is now v5, so the test above
# proves only that "a v5 document merged onto v5 defaults reproduces its pins". The
# property that matters for real data is the other one: *an old stored document still
# reproduces its pins after normalisation* -- every persisted row in the database is
# v3 or v4, and nothing writes v5 yet. This reverses the R8 additions and re-runs the
# whole corpus through the migration chain from where it actually was before this
# release. Mirrors golden-fixtures.test.ts.
_R8_ACQUISITION_KEYS = (
    "jurisdiction", "jurisdiction_source", "jurisdiction_evidence_status",
    "acquisition_date", "acquisition_tax_override_pence",
    "acquisition_tax_override_reason",
)


def _as_pre_r8_document(inputs: dict) -> dict:
    doc = copy.deepcopy(inputs)
    for key in _R8_ACQUISITION_KEYS:
        doc["acquisition"].pop(key, None)
    # The pre-R8 version, derived structurally rather than hard-coded per stem: the
    # three v4 blocks arrived together in Release 3a, so a fixture carrying
    # `programme` was v4 and one without it was v3.
    doc["inputs_version"] = 4 if "programme" in doc else 3
    return doc


# R8 Task 12. The property below ("a pre-R8 document reproduces its pins") is only
# well-defined for a fixture whose pinned figures are England/NI ones: the migration
# stamps `england_ni` *by definition*, because that is what every legacy document
# implicitly was. A non-English fixture has no pre-R8 form -- stripping the R8 fields
# does not recover an older document, it asserts a different property. So the
# parametrisation runs over the England/NI fixtures, and the excluded ones are covered
# by the stronger assertion below rather than by silence. Mirrors
# golden-fixtures.test.ts's preR8Fixtures / nonEnglishFixtures split.
def _jurisdiction_of(path: Path) -> str:
    return _load_fixture(path)["inputs"]["acquisition"].get("jurisdiction", "england_ni")


# R9 narrows it further: a v6 fixture has no pre-R8 form either. ``_as_pre_r8_document``
# stamps v3/v4, and migrating that back up would leave the R9 ``areas`` and ``ancillary``
# blocks at their zeroed defaults -- a different document, not an older one.
_PRE_R8_FIXTURES = [
    p for p in APPRAISAL_FIXTURES
    if _jurisdiction_of(p) == "england_ni" and _version_of(_load_fixture(p)) == 5
]
_NON_ENGLISH_FIXTURES = [p for p in APPRAISAL_FIXTURES if _jurisdiction_of(p) != "england_ni"]


def test_the_pre_r8_parametrisation_covers_every_england_ni_v5_fixture() -> None:
    """Without this, deleting a fixture's `jurisdiction` field -- or mistyping it --
    would quietly move it out of the parametrisation below and reduce coverage
    without failing. Mirrors golden-fixtures.test.ts."""
    assert [_jurisdiction_of(p) for p in _NON_ENGLISH_FIXTURES] == ["wales", "scotland"]
    excluded = [p for p in APPRAISAL_FIXTURES if p not in _PRE_R8_FIXTURES]
    assert [p.stem for p in excluded] == [
        "m-wales-jurisdiction", "n-area-bridge", "o-ancillary-value", "p-scotland-levered",
        "q-detailed-cost-plan", "r-vat-quarterly", "s-dated-programme",
        "t-investment-case", "u-investment-case-ltv-binds", "v-exhausted-reserve",
        "w-monitoring-on-site", "x-unit-sales-ledger",
    ]
    # Every exclusion is justified by one of the two stated reasons, not by silence.
    # R10 widens the second reason from "== 6" to "== 6 or 7", and R11 widens it again
    # to include 8: fixture R (v8), like fixture Q (v7) before it, has no pre-R8 form --
    # migrating a stamped-back v3/v4 document up would leave the R9 areas/ancillary,
    # the R10 cost_plan AND the R11 vat blocks at their zeroed/legacy-derived/inert
    # defaults, a different document.
    #
    # R12 widens it once more to include 9: fixture S is BORN at v9 and has no
    # pre-R8 form at all -- it did not exist before R8, and stamping it v3/v4 would
    # additionally strip the R12 programme network the fixture is entirely about.
    #
    # R13 Task 5b widens it once more to include 10: fixtures T and U are BORN at
    # v10 for the same reason S was born at v9 -- they did not exist before R8,
    # and stamping them v3/v4 would additionally strip the R13 investment case
    # the fixtures are entirely about. R14 Task 2 adds a third v10-native
    # fixture, V, for the same reason: it did not exist before R8 and is stored
    # at v10 because v11 does not exist yet (Task 6's gate migrates it).
    #
    # R14 Task 8 widens it once more to include 11: fixture W is BORN at v11 for
    # the same reason -- it did not exist before R8, and stamping it v3/v4 would
    # additionally strip the R14 `monitoring` block and the detailed cost plan
    # the fixture is entirely about.
    #
    # R13b Task 2 widens it once more to include 12: fixture X is BORN at v12
    # for the same reason -- it did not exist before R8, and stamping it v3/v4
    # would additionally strip the R13b `unit_sales` block the fixture is
    # entirely about.
    #
    # Fix round 1, I3: this must enumerate the versions the exclusion is genuinely
    # about, NOT negate _PRE_R8_FIXTURES's own defining condition ("== 5" flipped to
    # "!= 5") -- that phrasing is the literal complement of how `excluded` was built,
    # so it is vacuously true for every member and can never fail. Enumerating
    # 6/7/8/9/10/11/12 keeps the check able to fail: it catches a fixture excluded for
    # an EIGHTH, unstated reason (e.g. a future non-v5..v12 fixture, or a change to
    # _PRE_R8_FIXTURES's own filter that this assertion was never updated to match).
    for path in excluded:
        version = _version_of(_load_fixture(path))
        assert (
            _jurisdiction_of(path) != "england_ni"
            or version == 6
            or version == 7
            or version == 8
            or version == 9
            or version == 10
            or version == 11
            or version == 12
        ), f"{path.stem} is excluded from the pre-R8 parametrisation for no stated reason"


@pytest.mark.parametrize("path", _PRE_R8_FIXTURES, ids=lambda p: p.stem)
def test_pre_r8_fixture_form_reproduces_its_metrics_after_migration(path: Path) -> None:
    doc = _load_fixture(path)
    pre = _as_pre_r8_document(doc["inputs"])
    assert pre["inputs_version"] != 5
    assert not any(k in pre["acquisition"] for k in _R8_ACQUISITION_KEYS)

    v5 = migrate_inputs_to_v5(pre)
    assert v5.inputs_version == 5
    # The migration stamps what a legacy document honestly is: England/NI by
    # default, unconfirmed, no transaction date (spec Sec 14).
    assert v5.acquisition.jurisdiction == "england_ni"
    assert v5.acquisition.jurisdiction_source == "migrated_default"
    assert v5.acquisition.jurisdiction_evidence_status == "unconfirmed"
    assert v5.acquisition.acquisition_date is None
    _assert_expected_metrics(run_appraisal(v5), doc, f"{path.stem}[pre-R8 -> v5]")


def _as_england_ni_document(inputs: dict) -> dict:
    doc = copy.deepcopy(inputs)
    doc["acquisition"]["jurisdiction"] = "england_ni"
    return doc


@pytest.mark.parametrize("path", _NON_ENGLISH_FIXTURES, ids=lambda p: p.stem)
def test_a_non_english_fixtures_england_ni_twin_is_a_different_appraisal(path: Path) -> None:
    """R9 Task 12. The non-English fixtures get the *stronger* statement: switching the
    document's jurisdiction to England/NI must change the acquisition tax, and change it
    to precisely the England/NI figure on the same consideration. That is what makes the
    fixture's jurisdiction load-bearing -- a table edit, or a mis-wired call site that
    quietly reverted to SDLT, fails here rather than passing because the two regimes
    happened to agree. Mirrors golden-fixtures.test.ts.

    R8 wrote this with fixture M's figures hard-coded inside a parametrisation over every
    non-English fixture, and left a MAINTENANCE note saying that adding a second one meant
    rewriting it. Fixture P is that second one, so it is rewritten: the expected pair and
    the three deltas now come from each fixture's own hand-derived
    ``jurisdiction_contrast`` block.

    It also matters that the deltas are pinned SEPARATELY rather than asserted equal to
    each other. Fixture M is all-cash, so its tax difference reaches TDC unchanged and
    never touches peak debt. Fixture P is levered, so the extra tax exhausts committed
    equity a month earlier and then compounds: its TDC delta (106,161p) is strictly larger
    than its acquisition delta (100,000p). An engine that computed the right tax but
    funded it wrongly would satisfy the first and fail the second -- the interaction R8's
    implementation report recorded as unpinned."""
    doc = _load_fixture(path)
    contrast = doc["jurisdiction_contrast"]
    native = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    english = run_appraisal(parse_calculator_inputs(_as_england_ni_document(doc["inputs"])))

    assert native.metrics.acquisition_tax.regime == contrast["regime"]
    assert english.metrics.acquisition_tax.regime == contrast["england_ni_regime"]
    assert english.metrics.acquisition_tax_pence == contrast["england_ni_acquisition_tax_pence"]
    # Non-vacuity: the two regimes must actually disagree on this consideration.
    assert contrast["acquisition_cost_delta_pence"] > 0
    # The difference must reach the headline cost stack, not stop at the metrics object --
    # this is the two-call-site defect R8 Task 5 found, pinned.
    assert (
        english.metrics.acquisition_cost_pence - native.metrics.acquisition_cost_pence
    ) == contrast["acquisition_cost_delta_pence"]
    assert (
        english.metrics.total_development_cost_pence
        - native.metrics.total_development_cost_pence
    ) == contrast["total_development_cost_delta_pence"]
    assert (
        english.metrics.peak_debt_pence - native.metrics.peak_debt_pence
    ) == contrast["peak_debt_delta_pence"]


@pytest.mark.parametrize(
    "path", [p for p in _NON_ENGLISH_FIXTURES if _version_of(_load_fixture(p)) == 5],
    ids=lambda p: p.stem,
)
def test_a_non_english_fixtures_pre_r8_form_is_a_different_england_ni_appraisal(
    path: Path,
) -> None:
    """R8's original route to the same statement, kept for the v5 non-English fixtures
    because it additionally proves the migration stamps ``england_ni`` on a document that
    never said otherwise. Now driven off the contrast block rather than hard-coded, so it
    survives the next non-English fixture unchanged."""
    doc = _load_fixture(path)
    contrast = doc["jurisdiction_contrast"]
    v5 = migrate_inputs_to_v5(_as_pre_r8_document(doc["inputs"]))
    assert v5.acquisition.jurisdiction == "england_ni"
    english = run_appraisal(v5)
    native = run_appraisal(parse_calculator_inputs(doc["inputs"]))

    assert english.metrics.acquisition_tax_pence == contrast["england_ni_acquisition_tax_pence"]
    assert native.metrics.acquisition_tax_pence == doc["expected_metrics"]["acquisition_tax_pence"]
    assert english.metrics.acquisition_tax.regime == contrast["england_ni_regime"]
    assert native.metrics.acquisition_tax.regime == contrast["regime"]
    assert (
        english.metrics.acquisition_cost_pence - native.metrics.acquisition_cost_pence
    ) == contrast["acquisition_cost_delta_pence"]
    assert (
        english.metrics.total_development_cost_pence
        - native.metrics.total_development_cost_pence
    ) == contrast["total_development_cost_delta_pence"]


# R9 Task 12 fix round 1. Python twin of golden-fixtures.test.ts's negative-control block,
# which had no mirror here -- an asymmetry that predates R9 but that R9 widened by adding
# three mapped pins (`gross_sales_pence` and the two `cost_to_complete_*` keys on fixture P).
#
# The point is the one fixture H established in Release 3a: a pinned key that no assertion
# actually reaches is a copy-paste false pass, not coverage. Every key in _FLAT_KEYS reaches
# the run through a mapper rather than through getattr, so a typo in a mapper -- or a key
# silently absent from the mapper table -- could compare None against None and pass. This
# flips each mapped key to a deliberately wrong value and asserts _assert_pins RAISES.
#
# THE CONVENTION: every key in _FLAT_KEYS is negative-controlled by at least one fixture
# here. Adding a mapper means adding an entry below.
_NEGATIVE_CONTROLS = [
    # Fixtures I and J exercise opposite sides of the same redemption mappers: I's
    # redemption balance is 0 and its three-entry schedule ends at 0, while J's is non-zero
    # and its two-entry schedule ends non-zero. A mapper that returned a constant, or
    # dropped the final entry, could satisfy one fixture's control while failing the other's.
    ("i-phased-sales", {
        "redemption_balance_at_disposal_pence": 1,
        "redemption_schedule_months": [9, 10],
        "redemption_schedule_balances_pence": [53431299, 10782708, 1],
        "funding_gap_pence": 1,
    }),
    ("j-blended-refinance", {
        "redemption_balance_at_disposal_pence": 4946601,
        "redemption_schedule_months": [9, 10],
        "redemption_schedule_balances_pence": [53431299, 4946601],
        "funding_gap_pence": 1,
    }),
    # Fixture O is the one that matters for `gross_sales_pence`: under a blended exit GDV
    # and receipts are DIFFERENT numbers (74,500,000 vs 32,000,000), so a mapper wired to
    # the wrong total is caught. A control on a sell_all fixture could not tell them apart.
    ("o-ancillary-value", {"gross_sales_pence": 74_500_000}),
    # Fixture P's cost-to-complete pair used to hold spec Sec 5.10's C1 defect (a phantom
    # shortfall from double-counting rolled-up interest against the net facility). R14
    # closed C1 (spec Sec 5.10 rewritten, calc 2.13.0): the reserve credit clears the
    # series at every month, so the true pins are None / 0 and the old phantom figures
    # (1 / 392483) are now what the negative control must catch instead.
    ("p-scotland-levered", {
        "gross_sales_pence": 143_999_999,
        "cost_to_complete_first_shortfall_month": 1,
        "cost_to_complete_max_shortfall_pence": 392_483,
        "funding_gap_pence": 1,
    }),
    # R10 Task 11 fix round 1 (the same convention stated above): fixture Q adds ten
    # new _FLAT_KEYS mappers (the three contingency classes' base and amount, and the
    # two percentage fee lines' base and amount), and every one needs a control here.
    # One entry covers all ten -- poisoning `general`'s base with `existing_building`'s
    # figure (and so on) rather than an arbitrary wrong number, so a control failure
    # reads as "found the wrong line" rather than "found a typo". Mirrors
    # golden-fixtures.test.ts's negativeControls entry for fixture Q.
    ("q-detailed-cost-plan", {
        "cost_plan_contingency_general_base_pence": 23_000_000,           # truly 47000000
        "cost_plan_contingency_general_amount_pence": 2_350_001,          # truly 2350000
        "cost_plan_contingency_existing_building_base_pence": 47_000_000, # truly 23000000
        "cost_plan_contingency_existing_building_amount_pence": 3_450_001, # truly 3450000
        "cost_plan_contingency_abnormal_base_pence": 47_000_000,          # truly 3000000
        "cost_plan_contingency_abnormal_amount_pence": 240_001,           # truly 240000
        "cost_plan_fee_pct_construction_total_base_pence": 47_000_000,    # truly 53040000
        "cost_plan_fee_pct_construction_total_amount_pence": 795_601,     # truly 795600
        "cost_plan_fee_pct_base_build_base_pence": 53_040_000,            # truly 47000000
        "cost_plan_fee_pct_base_build_amount_pence": 2_820_001,           # truly 2820000
    }),
    # R11 (the same convention stated above): fixture R adds four new _FLAT_KEYS array
    # mappers (the schedule's construction spend curve, and the VAT engine's three
    # month-indexed arrays). Each wrong value is a plausible REAL mistake -- a shifted
    # programme window, a swapped incurred-VAT month, the two periods' reclaims
    # swapped, a one-pence slip at the peak carry -- not an arbitrary wrong number, so
    # a control failure reads as "found the wrong month/line" rather than "found a typo".
    ("r-vat-quarterly", {
        # truly [0, 25000000, 25000000, 25000000, 25000000, 0, 0] -- shifted one month
        # later, the exact shape an unset `programme` block (auto windows) would give.
        "uses_construction_pence": [0, 0, 25000000, 25000000, 25000000, 25000000, 0],
        # truly [10000000, 5000000, 5000000, 5000000, 5000000, 0, 0] -- months 0/1 swapped.
        "vat_months_incurred_pence": [5000000, 10000000, 5000000, 5000000, 5000000, 0, 0],
        # truly [0, 0, 0, 20000000, 0, 0, 10000000] -- the two periods' reclaims swapped.
        "vat_months_reclaimed_pence": [0, 0, 0, 10000000, 0, 0, 20000000],
        # truly [10000000, 15000000, 20000000, 5000000, 10000000, 10000000, 0] -- the
        # peak off by one penny.
        "vat_months_carry_pence": [10000000, 15000000, 19999999, 5000000, 10000000, 10000000, 0],
    }),
    # R12 (the same convention stated above): fixture S adds six new _FLAT_KEYS
    # mappers for the derived ProgrammeResult. Each wrong value is a plausible REAL
    # regression rather than an arbitrary wrong number:
    #   - finish_month 21 is what Sec 18.2's maximum gives if the MILESTONE arm is
    #     dropped, i.e. max(finish) over duration>=1 phases alone -- the programme
    #     would then be reported as finishing before its own maturity_tail;
    #   - the critical path with `construction` removed is what the successor-only
    #     late-finish rule produces (Sec 18.4's correction): its SS successor
    #     `marketing` would lend it a float of 2 it does not have;
    #   - the float array with marketing at 0 is a wholly-critical network, the state
    #     guard 1 exists to reject;
    #   - the start array with marketing at 8 is an SS lag read as 0 rather than 3;
    #   - the finish array with practical_completion at 17 is a milestone given a
    #     one-month duration;
    #   - the id array with `design` and `procurement` transposed is the reordering
    #     that would silently re-key the three positional arrays above.
    # Mirrors golden-fixtures.test.ts's negativeControls entry for fixture S.
    ("s-dated-programme", {
        "programme_finish_month": 21,
        "programme_critical_path": [
            "acquisition", "planning", "conditions", "strip_out", "testing",
            "building_control", "practical_completion", "unit_completions", "sales",
            "maturity_tail",
        ],
        "programme_phase_ids": [
            "acquisition", "planning", "conditions", "procurement", "design", "strip_out",
            "construction", "testing", "building_control", "practical_completion",
            "marketing", "unit_completions", "sales", "maturity_tail",
        ],
        "programme_phase_start_months": [0, 1, 4, 1, 5, 6, 8, 14, 15, 16, 8, 16, 18, 21],
        "programme_phase_finish_months": [1, 4, 6, 5, 7, 8, 14, 15, 16, 17, 15, 18, 21, 21],
        "programme_phase_total_float_months": [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    }),
    # R14 (the same convention stated above): fixture V is the release's own
    # hand-derived positive case for the reserve-headroom correction (spec Sec 4),
    # so its five pins each get a pin +/- 1 control, matching every other
    # fixture's convention exactly (see docs/financial-model/test-cases.md
    # Sec 20.1 for the worksheet these pins come from). Mirrors
    # golden-fixtures.test.ts's negativeControls entry for fixture V.
    ("v-exhausted-reserve", {
        "gdv_pence": 30_000_001,                          # truly 30000000
        "peak_debt_pence": 12_445_220,                     # truly 12445219 (direct key)
        "funding_gap_pence": 704_022,                      # truly 704021
        "cost_to_complete_first_shortfall_month": 2,       # truly 1
        "cost_to_complete_max_shortfall_pence": 949_241,   # truly 949240
    }),
    # R14 Task 8 (the same convention stated above): fixture W is the release's
    # golden case for the Sec 20.4 monitoring statement and the cross-engine
    # penny-agreement carrier, so its pins get pin +/- 1 controls too (see
    # docs/financial-model/test-cases.md Sec 20.4 for the worksheet they come
    # from). Task 9 wires the four monitoring FLAT_KEYS mappers and their
    # controls below. Mirrors golden-fixtures.test.ts's negativeControls entry
    # for fixture W.
    ("w-monitoring-on-site", {
        "gdv_pence": 45_000_001,                           # truly 45000000
        "peak_debt_pence": 14_188_794,                     # truly 14188793 (direct key)
        "funding_gap_pence": 1,                            # truly 0
        "cost_to_complete_first_shortfall_month": 1,       # truly None (no shortfall)
        "cost_to_complete_max_shortfall_pence": 1,         # truly 0
        # The Sec 4.2(b) ratio, pinned through the dotted path rather than the
        # flat key Task 9 adds. 11/12 is not representable, so the control is a
        # neighbouring double rather than "the pin + 1".
        "cost_plan.lender_eligible_ratio": 0.9166666666666667,
        # Task 9's four monitoring-statement pins, pin +/- 1 for the two pence
        # figures and the neighbouring double for the ratio, matching the
        # convention above exactly.
        "monitoring_shortfall_pence": 1,                          # truly 0
        "monitoring_estimated_final_cost_pence": 27_520_001,      # truly 27520000
        "monitoring_surplus_pence": 10_101_206,                   # truly 10101207
        "lender_eligible_ratio": 0.9166666666666667,              # truly 0.9166666666666666
    }),
    # R13b Task 7 (the same convention stated above): fixture X adds eleven new
    # _FLAT_KEYS array mappers (spec Sec 22.6) -- the nine per-unit rows and the
    # two month-indexed arrays -- and every one needs a control here. Each wrong
    # value is a plausible REAL mistake rather than an arbitrary one: u2/u3 (or
    # u1/u2, or u1/u3) transposed -- the two units missing an exchange or legal
    # override sit adjacent in the input list -- u3's 2.0% agent-fee override
    # dropped to the scheme default, an anchor offset dropped by one month, and
    # a receipt landing in the wrong month. Mirrors golden-fixtures.test.ts's
    # negativeControls entry for fixture X.
    ("x-unit-sales-ledger", {
        # truly ["u1", "u2", "u3", "u4"] -- u2/u3 transposed
        "unit_sales_unit_ids": ["u1", "u3", "u2", "u4"],
        # truly [26000000, 30000000, 17500000, 21000000] -- u2/u3 transposed
        "unit_sales_unit_gross_pence": [26000000, 17500000, 30000000, 21000000],
        # truly [2600000, 3000000, 0, 1050000] -- u2/u3 transposed
        "unit_sales_unit_deposit_pence": [2600000, 0, 3000000, 1050000],
        # truly [2600000, 3000000, 0, 1050000] -- u2/u3 transposed
        "unit_sales_unit_deposit_released_pence": [2600000, 0, 3000000, 1050000],
        # truly [390000, 450000, 350000, 315000] -- u3's 2.0% override dropped to
        # the scheme default (1.5% of 17500000 = 262500)
        "unit_sales_unit_agent_fee_pence": [390000, 450000, 262500, 315000],
        # truly [201550, 150000, 135659, 162791] -- u1/u3 transposed
        "unit_sales_unit_legal_fee_pence": [135659, 150000, 201550, 162791],
        # truly [25408450, 29400000, 17014341, 20522209] -- u1/u2 transposed
        "unit_sales_unit_net_pence": [29400000, 25408450, 17014341, 20522209],
        # truly [8, 10, None, 11] -- u1's marketing anchor offset dropped by one month
        "unit_sales_unit_exchange_months": [7, 10, None, 11],
        # truly [12, 13, 13, 20] -- u2's practical_completion + 1 anchor offset dropped
        "unit_sales_unit_completion_months": [12, 12, 13, 20],
        # truly u1's released deposit landing in month 8 -- shifted one month late
        "unit_sales_deposits_received_pence": (
            [0] * 9 + [2600000, 3000000, 1050000] + [0] * 12
        ),
        # truly months 12/13 (u1's completion, then u2+u3's) -- the two figures
        # transposed
        "receipts_gross_sale_pence": (
            [0] * 8 + [2600000, 0, 3000000, 1050000, 44500000, 23400000]
            + [0] * 6 + [19950000] + [0] * 3
        ),
    }),
]


def test_every_flat_key_is_negative_controlled() -> None:
    """The convention above, asserted rather than trusted."""
    controlled = {key for _, wrong in _NEGATIVE_CONTROLS for key in wrong}
    assert set(_FLAT_KEYS) - controlled == set(), (
        "these _FLAT_KEYS mappers have no negative control: "
        f"{sorted(set(_FLAT_KEYS) - controlled)}"
    )


@pytest.mark.parametrize("stem,wrong_values", _NEGATIVE_CONTROLS, ids=[c[0] for c in _NEGATIVE_CONTROLS])
def test_negative_control_a_wrong_value_for_each_mapped_key_fails(
    stem: str, wrong_values: dict,
) -> None:
    path = next(p for p in APPRAISAL_FIXTURES if p.stem == stem)
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    # The run itself must be correct first, or "the poisoned pin failed" would prove nothing.
    _assert_expected_metrics(run, doc, stem)
    for key, wrong in wrong_values.items():
        with pytest.raises(AssertionError):
            _assert_pins(run, {key: wrong}, f"negative-control[{stem}]")


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_invariants(path: Path) -> None:
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    for m in run.model.months:
        assert m.closing_balance_pence == (
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
            + m.interest_capitalised_pence - m.repayment_pence
        )
        assert m.closing_balance_pence >= 0
    assert run.reconciliation.sources_equal_uses


def _programme_for_term(term_months: int) -> ProgrammeInputs:
    """Port of invariants.test.ts's `programmeForTerm`: a generic programme fitted to
    any term_months, sitting well inside the spec Sec 6 window bound (finish by
    term-2) -- every package starts at month 0, so it stays valid even for a short
    term rather than assuming term=12."""
    term = max(1, int(term_months))
    cap = max(1, term - 2)
    return ProgrammeInputs(
        anchor_month=None,
        packages=ProgrammePackages(
            construction=ProgrammePackage(
                start_offset=0, duration_months=min(6, cap), curve=SimpleSpendCurve(kind="s_curve"),
            ),
            professional=ProgrammePackage(
                start_offset=0, duration_months=min(3, cap), curve=SimpleSpendCurve(kind="straight_line"),
            ),
            statutory=ProgrammePackage(
                start_offset=0, duration_months=min(2, cap), curve=SimpleSpendCurve(kind="back_loaded"),
            ),
        ),
    )


def _network_for_term(term_months: int) -> ProgrammeNetwork:
    """R12: the v9 sibling of _programme_for_term, for a fixture BORN at v9.
    migrate_inputs_to_v8 refuses such a document (_RECOGNISED_VERSIONS_V8 stops at
    8), so the "programme" variant below cannot route it through the legacy shape.

    Deliberately the same THREE predecessor-free phases the v8 -> v9 migration
    itself produces (spec Sec 18.7), with the same windows _programme_for_term
    uses, so the variant asserts the same claim on both arms: the ledger
    invariants hold for a document whose spend is driven by a programme fitted to
    its own term, whatever shape that programme is stored in."""
    term = max(1, int(term_months))
    cap = max(1, term - 2)
    return ProgrammeNetwork(
        anchor_month=None,
        phases=[
            Phase(
                id="construction", code="construction", label="Construction",
                duration_months=min(6, cap), slip_months=0, start_offset=0,
                curve=SimpleSpendCurve(kind="s_curve"), predecessors=[],
            ),
            Phase(
                id="professional", code="design", label="Professional",
                duration_months=min(3, cap), slip_months=0, start_offset=0,
                curve=SimpleSpendCurve(kind="straight_line"), predecessors=[],
            ),
            Phase(
                id="statutory", code="planning", label="Statutory",
                duration_months=min(2, cap), slip_months=0, start_offset=0,
                curve=SimpleSpendCurve(kind="back_loaded"), predecessors=[],
            ),
        ],
        category_phase_ids=CategoryPhaseIds(
            construction="construction", professional="professional", statutory="statutory",
        ),
    )


def _invariant_variants(inputs: AnyCalculatorInputs) -> list[tuple[str, AnyCalculatorInputs]]:
    """Mirrors invariants.test.ts's `variants()`: derived transformations of each
    fixture, widening coverage without new hand calcs. Each variant is deep-copied off
    the base `inputs` so mutating one never leaks into another (or into the base).

    Release 3a Task 9 adds a fifth, "programme", variant so every ledger invariant
    below also exercises the dated-programme path (spec Sec 6.1), not just fixture
    H's hand-authored one -- mirroring invariants.test.ts's own addition."""
    retained = inputs.model_copy(deep=True)
    retained.exit_strategy.route = "retain_all"
    serviced = inputs.model_copy(deep=True)
    serviced.finance.interest_type = "serviced"
    short_term = inputs.model_copy(deep=True)
    short_term.finance.term_months = 1
    # R9: normalised to v6, not v5 -- migrate_inputs_to_v5 refuses a v6 document by
    # design, since producing one would mean dropping ``areas`` and every unit's
    # ``ancillary`` block, the silent downgrade that guard exists to prevent.
    # R10: widened again, to v7 not v6, for the symmetric reason -- migrate_inputs_to_v6
    # refuses a v7 document (fixture Q), since producing one would mean dropping
    # ``cost_plan``. The corpus now mixes v5, v6 and v7 documents, and migrate_inputs_to_v7
    # accepts all three.
    # R11: widened once more, to v8 -- migrate_inputs_to_v7 refuses a v8 document
    # (fixture R) by the same design, since producing one would mean dropping `vat`.
    # migrate_inputs_to_v8 accepts all four versions (upgrade, upgrade, upgrade, merge),
    # and the isinstance check below still holds unchanged: CalculatorInputsV8
    # subclasses CalculatorInputsV7.
    # R12: a v9-born fixture (fixture S) cannot go through migrate_inputs_to_v8 at
    # all -- it refuses a v9 document by the same design that made it refuse nothing
    # below 9. It takes the v9 arm instead, and gets a v9 NETWORK fitted to its term
    # rather than the legacy three-package block.
    #
    # R13 Task 5b: a v10-born fixture (T, U) cannot go through migrate_inputs_to_v9
    # either, by the identical design one version further on (migrate_inputs_to_v9
    # refuses a v10 document -- it would have to drop `refinance`'s v10 narrowing
    # and `investment_case`). `isinstance(programmed, CalculatorInputsV9)` still
    # holds for a v10 result unchanged: CalculatorInputsV10 subclasses
    # CalculatorInputsV9, the same relationship V9/V8 already had above.
    #
    # R14 Task 8: and once more for v11 -- a v11-born fixture (W) cannot go through
    # migrate_inputs_to_v10 either, by the identical design one version further on
    # (migrate_inputs_to_v10 refuses a v11 document -- it would have to drop
    # `monitoring`). `isinstance(programmed, CalculatorInputsV9)` still holds for a
    # v11 result unchanged: CalculatorInputsV11 subclasses CalculatorInputsV10
    # subclasses CalculatorInputsV9.
    #
    # R13b Task 2: and once more for v12 -- fixture X (v12-native) cannot go
    # through migrate_inputs_to_v11 either, by the identical design one version
    # further on (migrate_inputs_to_v11 refuses a v12 document -- it would have
    # to drop `unit_sales`). `isinstance(programmed, CalculatorInputsV9)` still
    # holds for a v12 result unchanged: CalculatorInputsV12 subclasses
    # CalculatorInputsV11 subclasses CalculatorInputsV10 subclasses
    # CalculatorInputsV9.
    if inputs.inputs_version >= 12:
        programmed = migrate_inputs_to_v12(inputs.model_dump(mode="json"))
    elif inputs.inputs_version >= 11:
        programmed = migrate_inputs_to_v11(inputs.model_dump(mode="json"))
    elif inputs.inputs_version >= 10:
        programmed = migrate_inputs_to_v10(inputs.model_dump(mode="json"))
    elif inputs.inputs_version >= 9:
        programmed = migrate_inputs_to_v9(inputs.model_dump(mode="json"))
    else:
        programmed = None
    if programmed is not None:
        assert isinstance(programmed, CalculatorInputsV9)
        programmed.programme = _network_for_term(programmed.finance.term_months)
        # Replacing the network orphans any Sec 18.6 anchor that named one of the
        # phases just discarded. ``anchor: None`` is that field's own documented
        # meaning -- "use month_offset" -- so clearing it keeps the variant a
        # document the validator would accept, rather than one that only survives
        # because build_schedule's defensive degrade catches an absent phase_id.
        if programmed.sales_phasing is not None:
            for tranche in programmed.sales_phasing.tranches:
                tranche.anchor = None
        if programmed.refinance is not None:
            programmed.refinance.anchor = None
        # R13 Task 5b: the identical orphaning applies to a v10 document's
        # investment-case stabilisation anchor (Sec 19.6) -- it is anchored to
        # `practical_completion`, a phase `_network_for_term`'s three-phase
        # network does not carry. `computeInvestmentCase` (Task 8) does not
        # exist yet to read it, so nothing observably breaks today either way;
        # cleared anyway to match the sales_phasing/refinance treatment above,
        # rather than leaving a dangling anchor for Task 6's validation rule 6
        # to trip over once it lands.
        ic = getattr(programmed, "investment_case", None)
        if ic is not None:
            ic.stabilisation.anchor = None
        # R13b Task 2: the identical orphaning applies to a v12 document's
        # unit_sales exchange/completion anchors (Sec 22.1) -- fixture X's
        # anchors name `marketing`/`practical_completion`/`unit_completions`,
        # none of which exist on `_network_for_term`'s three-phase network.
        # No engine reads `unit_sales` yet (Tasks 3-6), so nothing observably
        # breaks either way today; cleared anyway to match the
        # sales_phasing/refinance/investment_case treatment above rather than
        # leaving a dangling anchor for a later task's validation rule to trip
        # over once it lands.
        us = getattr(programmed, "unit_sales", None)
        if us is not None:
            for row in us.units:
                if row.exchange is not None:
                    row.exchange.anchor = None
                row.completion.anchor = None
    else:
        programmed = migrate_inputs_to_v8(inputs.model_dump(mode="json"))
        assert isinstance(programmed, CalculatorInputsV7)
        programmed.programme = _programme_for_term(programmed.finance.term_months)
    return [
        ("base", inputs),
        ("retain_all", retained),
        ("serviced", serviced),
        ("term=1", short_term),
        ("programme", programmed),
    ]


def _fixture_variant_matrix() -> list[tuple[str, str, AnyCalculatorInputs]]:
    out: list[tuple[str, str, AnyCalculatorInputs]] = []
    for path in APPRAISAL_FIXTURES:
        doc = _load_fixture(path)
        base_inputs = parse_calculator_inputs(doc["inputs"])
        for label, variant_inputs in _invariant_variants(base_inputs):
            out.append((path.stem, label, variant_inputs))
    return out


_FIXTURE_VARIANTS = _fixture_variant_matrix()
_FIXTURE_VARIANT_IDS = [f"{stem}[{label}]" for stem, label, _ in _FIXTURE_VARIANTS]


def _is_fully_realised(run) -> bool:
    """Spec Sec 7's fully-realised precondition, in ONE place: the gated profit
    identity in TestInvariantMatrix and its Sec 5 witness below must apply the
    same predicate, or the witness stops witnessing the thing it names.
    Mirrors isFullyRealised in invariants.test.ts."""
    return (
        run.model.senior_outstanding_at_maturity_pence == 0
        and run.schedule.totals.retained_value_pence == 0
        and run.model.totals.funding_gap_pence == 0
    )


@pytest.mark.parametrize("stem,label,inputs", _FIXTURE_VARIANTS, ids=_FIXTURE_VARIANT_IDS)
class TestInvariantMatrix:
    """Python port of frontend/src/lib/model/invariants.test.ts's top `describe` block
    (spec Sec 4/Sec 8 roll-forward invariant, Sec 5.7 peak debt, Sec 3.9/Sec 9 zero-debt
    cost, Sec 4.4 retained exits, Sec 6 schedule spreads, Sec 3.12/Sec 7 profit identity,
    Sec 7 TDC identity): every golden fixture run through the same 5 derived variants
    (base/retain_all/serviced/term=1/programme -- the last fitting a generic dated
    programme to the variant's term, spec Sec 6.1) TS exercises, giving the same widened
    coverage on the Python side. Closes the gap recorded in docs/financial-model/test-cases.md Sec 4
    and Sec 7. Each TS `it()` in that describe block has a one-to-one Python method
    below (same order), rather than one flat function, so a single invariant's failure
    doesn't mask the others -- the same diagnostic granularity as the TS suite."""

    def test_debt_rollforward_reconciles_and_closing_balance_never_negative(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        for m in run.model.months:
            assert m.closing_balance_pence == (
                m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
                + m.interest_capitalised_pence - m.repayment_pence
            )
            assert m.closing_balance_pence >= 0

    def test_sources_equal_uses_unconditionally(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        """Release 3a Task 9 (spec Sec 7): sources = uses is an unconditional accounting
        identity (validation.reconcile()), not just true "when fully realised" -- this
        closes the gap where only the fully-realised profit-identity test below
        exercised it, and is exactly what surfaces a programme mis-wiring in
        build_schedule."""
        run = run_appraisal(inputs)
        assert run.reconciliation.sources_equal_uses is True

    def test_peak_debt_equals_the_maximum_monthly_pre_repayment_balance(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        max_balance = max(
            [0] + [
                m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
                + m.interest_capitalised_pence
                for m in run.model.months
            ]
        )
        assert run.model.peak_debt_pence == max_balance

    def test_cash_funding_produces_zero_debt_cost(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        if inputs.finance.funding_source == "cash":
            assert run.metrics.finance_costs_pence == 0
            assert run.model.totals.draws_pence == 0

    def test_retained_exits_receive_no_sale_proceeds(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        if inputs.exit_strategy.route == "retain_all":
            assert all(m.gross_receipts_pence == 0 for m in run.model.months)
            assert run.metrics.selling_costs_pence == 0

    def test_monthly_schedule_spreads_sum_exactly_to_cost_totals(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        assert (
            sum(m.construction_pence for m in run.schedule.uses)
            == run.schedule.totals.construction_pence
        )
        assert (
            sum(m.professional_pence for m in run.schedule.uses)
            == run.schedule.totals.professional_pence
        )
        assert (
            sum(m.statutory_pence for m in run.schedule.uses)
            == run.schedule.totals.statutory_pence
        )

    def test_profit_equals_equity_flows_and_sources_equal_uses_when_fully_realised(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        if _is_fully_realised(run):
            assert run.metrics.profit_pence == sum(run.model.equity_cashflows_pence)
            assert run.reconciliation.sources_equal_uses is True

    def test_tdc_equals_the_sum_of_all_monthly_uses_plus_rolled_interest_capitalised_fees_and_exit_fee(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        # Task 6 correction (spec Sec 7): monthly uses_total_pence includes month-0
        # ancillary fees but NOT the capitalised arrangement fee, while TDC (from
        # metrics) does include it -- so the identity needs an explicit
        # + capitalised_fees_pence term.
        #
        # R11 correction (spec Sec 17.5/17.6, fixture R): `uses_total_pence` carries
        # `u.vat_pence`, the FULL gross input VAT charged that month -- but TDC only
        # ever carries the IRRECOVERABLE slice forward (`irrecoverable_vat_pence`,
        # folded into cost_before_finance). The recoverable slice comes back as
        # `vat_reclaim_pence`, a repayment, not a cost, so it must be netted out here
        # or this identity over-counts by exactly `vat.total_recoverable_pence` --
        # confirmed against fixture R, where it was zero for every one of the twelve
        # pre-VAT fixtures (registered: false, nothing to recover) and this term was
        # vacuously zero throughout, so the gap went unseen until now.
        run = run_appraisal(inputs)
        monthly_uses = sum(m.uses_total_pence for m in run.model.months)
        rolled = sum(m.interest_capitalised_pence for m in run.model.months)
        serviced = sum(m.interest_serviced_pence for m in run.model.months)
        assert run.metrics.total_development_cost_pence == (
            monthly_uses - run.metrics.vat.total_recoverable_pence
            + rolled + serviced + run.metrics.selling_costs_pence
            + run.model.totals.exit_fee_pence + run.model.totals.capitalised_fees_pence
        )


def test_the_fully_realised_profit_identity_is_not_vacuous() -> None:
    """R14 (spec Sec 5, fix round 1). The profit identity in TestInvariantMatrix
    is GATED on `_is_fully_realised`, so it can go quiet without ever failing.
    Wiring `lender_eligible` to the Sec 4.2(b) advance cap opened a real funding
    gap on fixtures Q and S -- the corpus's ONLY two detailed-mode documents --
    and `funding_gap_pence == 0` is a term of the predicate, so neither reaches
    the identity any more. That is correct behaviour on those fixtures, but it
    means the gate needs a witness.

    SELF-CONTAINED: this walks the corpus itself rather than reading a counter
    the parametrised sweep filled in, so it depends on no test ordering and a
    filtered run (`-k`) cannot make it fail spuriously. Same shape as
    `saw_positive_case` in test_financial_model_cost_to_complete.py. It re-runs
    the appraisals, which is cheap beside the seven assertions each already
    carries.

    R14 Task 8 TIGHTENS it per COST MODE, which is what the Task 3 comment this
    replaces asked for. Corpus-wide non-emptiness alone would still go quiet on
    the thing the cap actually broke: every document that reached the identity
    could be HEADLINE mode, and the detailed-mode arm -- the one the Sec 4.2(b)
    ratio scales -- would prove nothing. Fixture W is the detailed-mode carrier
    (spec Sec 20.2, funding gap 0, senior repaid whole in ledger month 17,
    nothing retained), so the second assertion below names the mode rather than
    the fixture: another detailed-mode document reaching the identity would keep
    it green, and W silently drifting out of full realisation would not.
    Mirrors invariants.test.ts's 'at least one fixture/variant actually reaches
    the fullyRealised profit identity'."""
    reached = [
        (stem, label, run)
        for stem, label, inputs in _FIXTURE_VARIANTS
        for run in [run_appraisal(inputs)]
        if _is_fully_realised(run)
    ]
    assert reached != [], (
        "no fixture/variant reaches the fully-realised profit identity -- the gated "
        "assertion in TestInvariantMatrix is now vacuous across the whole corpus."
    )
    detailed = [
        f"{stem}[{label}]" for stem, label, run in reached
        if run.metrics.cost_plan.mode == "detailed"
    ]
    assert detailed != [], (
        "no DETAILED-mode fixture/variant reaches the fully-realised profit identity "
        "-- the gated assertion in TestInvariantMatrix is vacuous on exactly the cost "
        "mode the Sec 4.2(b) lender_eligible cap applies to."
    )


# Release 3b Task 10 (spec Sec 4.4.1/Sec 4.5, calc 2.3.0): phased-sale / refinance sweep
# invariants over fixture I (phased sell_all) and J (phased + blended refinance) -shaped
# inputs, plus two "awkward pence" derivatives per fixture (odd gross totals; a 3-tranche
# 33.4/33.3/33.3 split) -- 2 fixtures x 3 variants = 6 runs. Both fixtures, and every
# derivative built here, keep finance.interest_type == "rolled_up" and a non-negative
# refinance net proceeds figure (never touched by these variants) -- that is what makes
# the sweep-conservation identity below an *exact* equality rather than a bound: with
# rolled_up interest, engine.py's interest-serviced branch (the other source that can add
# to additional_equity_pence) never fires, so every pence of additional_equity_pence(m) in
# these runs is attributable to the refinance-shortfall branches alone. Mirrors
# invariants.test.ts's "phased-sale / refinance sweep invariants" describe block
# field-for-field (same variant labels, same 4 checks, same order).
# R8: the shared corpus moved to inputs v5. The check stays exact (isinstance
# alone would pass for a v4 document too, since V5 subclasses V4, letting a
# fixture drift out of this matrix without failing), mirroring
# invariants.test.ts's toV5Clone.
def _to_v5_clone(inputs: AnyCalculatorInputs) -> CalculatorInputsV5:
    if inputs.inputs_version != 5 or not isinstance(inputs, CalculatorInputsV5):
        raise TypeError("sweep-invariant fixture must be inputs_version 5")
    return inputs.model_copy(deep=True)


def _odd_gross_sweep_variant(inputs: AnyCalculatorInputs) -> CalculatorInputsV5:
    """Nudge each unit's value by a distinct odd pence amount so gross sale totals,
    tranche splits and agent-fee rounding all land on awkward (non-round) pence."""
    v = _to_v5_clone(inputs)
    for i, u in enumerate(v.unit_mix.units):
        u.estimated_value_pence += 2 * i + 1
    return v


def _three_tranche_sweep_variant(inputs: AnyCalculatorInputs) -> CalculatorInputsV5:
    v = _to_v5_clone(inputs)
    last = max(0, int(v.finance.term_months) - 1)
    v.sales_phasing = SalesPhasingInputs(
        tranches=[
            SalesPhasingTranche(month_offset=max(0, last - 2), pct_of_gross_receipts=33.4),
            SalesPhasingTranche(month_offset=max(0, last - 1), pct_of_gross_receipts=33.3),
            SalesPhasingTranche(month_offset=last, pct_of_gross_receipts=33.3),
        ],
    )
    return v


def _sweep_variants(inputs: AnyCalculatorInputs) -> list[tuple[str, CalculatorInputsV5]]:
    return [
        ("base", _to_v5_clone(inputs)),
        ("odd-gross", _odd_gross_sweep_variant(inputs)),
        ("three-tranche", _three_tranche_sweep_variant(inputs)),
    ]


def _sweep_fixture_variant_matrix() -> list[tuple[str, str, CalculatorInputsV5]]:
    out: list[tuple[str, str, CalculatorInputsV5]] = []
    for path in APPRAISAL_FIXTURES:
        if path.stem not in ("i-phased-sales", "j-blended-refinance"):
            continue
        doc = _load_fixture(path)
        base_inputs = parse_calculator_inputs(doc["inputs"])
        for label, variant_inputs in _sweep_variants(base_inputs):
            out.append((path.stem, label, variant_inputs))
    return out


_SWEEP_FIXTURE_VARIANTS = _sweep_fixture_variant_matrix()
assert len(_SWEEP_FIXTURE_VARIANTS) == 6, "expected fixtures I and J x 3 variants = 6 sweep-invariant runs"
_SWEEP_FIXTURE_VARIANT_IDS = [f"{stem}[{label}]" for stem, label, _ in _SWEEP_FIXTURE_VARIANTS]


@pytest.mark.parametrize("stem,label,inputs", _SWEEP_FIXTURE_VARIANTS, ids=_SWEEP_FIXTURE_VARIANT_IDS)
class TestPhasedSaleRefinanceSweepInvariants:
    """Python port of invariants.test.ts's 'phased-sale / refinance sweep invariants'
    describe block (Release 3b Task 10, spec Sec 4.4.1/Sec 4.5, calc 2.3.0): fixtures I and
    J, each run through 3 derived variants (base / odd-gross / three-tranche), giving the
    same 2 x 3 = 6-way matrix TS exercises. One Python test method per TS `it()` (same
    order), so a single invariant's failure doesn't mask the others."""

    def test_tranche_conservation_gross_agent_legal(
        self, stem: str, label: str, inputs: CalculatorInputsV5,
    ) -> None:
        run = run_appraisal(inputs)
        sum_gross = sum(r.gross_sale_pence for r in run.schedule.receipts)
        sum_agent = sum(r.agent_fee_pence for r in run.schedule.receipts)
        sum_legal = sum(r.selling_legal_pence for r in run.schedule.receipts)
        assert sum_gross == run.schedule.totals.gross_sales_pence
        assert sum_agent == money_round(
            (run.schedule.totals.gross_sales_pence * inputs.exit_strategy.selling_agent_fee_pct) / 100
        )
        assert sum_legal == (
            inputs.exit_strategy.selling_legal_fee_pence
            if run.schedule.totals.gross_sales_pence > 0 else 0
        )

    def test_sweep_conservation_every_month(
        self, stem: str, label: str, inputs: CalculatorInputsV5,
    ) -> None:
        """Pinned identity, derived from engine.py's sweep block (repayment/exit_fee/
        distribution split net_receipts exactly: `distribution = net_receipts - repayment -
        exit_fee`) composed with its refinance block (which either (a) tops up distribution
        by `refi_net - required` when refi_net >= balance+fee, or (b) adds `required -
        refi_net` to additional_equity when it doesn't, or (c) -- balance already 0 -- adds
        the whole refi_net to distribution): in every case the four fields below net to
        exactly zero. Holds every month, not just disposal/refinance months (both sides are
        0 otherwise)."""
        run = run_appraisal(inputs)
        for m in run.model.months:
            assert (
                m.distribution_pence + m.repayment_pence + m.exit_fee_pence
                == m.net_receipts_pence + m.refinance_proceeds_pence + m.additional_equity_pence
            )

    def test_interest_never_accrues_on_repaid_principal(
        self, stem: str, label: str, inputs: CalculatorInputsV5,
    ) -> None:
        run = run_appraisal(inputs)
        monthly_rate = inputs.finance.annual_interest_rate_pct / 100 / 12
        months = run.model.months
        for i in range(len(months) - 1):
            expected = money_round(
                (months[i].closing_balance_pence + months[i + 1].draw_pence
                 + months[i + 1].capitalised_fees_pence) * monthly_rate
            )
            assert months[i + 1].interest_accrued_pence == expected

    def test_redemption_schedule_declines(
        self, stem: str, label: str, inputs: CalculatorInputsV5,
    ) -> None:
        run = run_appraisal(inputs)
        sched = run.model.redemption_schedule
        for i in range(1, len(sched)):
            assert sched[i].month > sched[i - 1].month
            assert sched[i].balance_pence <= sched[i - 1].balance_pence
        if sched:
            assert run.model.redemption_balance_at_disposal_pence == sched[-1].balance_pence


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_lender_gdv_never_defaults_to_developer_gdv(path: Path) -> None:
    """Spec Sec 3.2 / Release 2b Task 3: lender-basis metrics must never default
    to developer GDV -- null is the only representation of "unknown", exactly
    when the block itself is absent, on every fixture."""
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    block_present = inputs.lender_valuation is not None
    assert (run.metrics.lender_gdv_pence is None) == (not block_present)
    if block_present:
        # Recomputed here (not just re-asserted against the pinned fixture value)
        # so this catches a regression where ltgdv_lender_pct is wired to
        # developer GDV instead of lender GDV.
        assert run.metrics.ltgdv_lender_pct == pct(
            run.model.peak_debt_pence, run.metrics.lender_gdv_pence
        )


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 4 (spec Sec 5.11): senior_breakeven_pence is null exactly when
    the ledger recorded no disposal (cash deals, or nothing sold)."""
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert (run.metrics.senior_breakeven_pence is None) == (
        run.model.redemption_balance_at_disposal_pence is None
    )


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_covers_redemption_plus_exit_fee(path: Path) -> None:
    """When non-null, senior_breakeven_pence >= redemption balance + exit fee due on
    redeeming it (spec Sec 5.11 invariant)."""
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    redemption = run.model.redemption_balance_at_disposal_pence
    if redemption is not None and run.metrics.senior_breakeven_pence is not None:
        exit_fee = exit_fee_amount(
            inputs.finance, run.model.committed_gross_facility_pence, run.model.peak_debt_pence,
            redemption,
        )
        assert run.metrics.senior_breakeven_pence >= redemption + exit_fee


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_percentages_null_unless_lender_gdv_present(path: Path) -> None:
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    lender_gdv_present = run.metrics.lender_gdv_pence is not None
    if run.metrics.senior_breakeven_pence is None or not lender_gdv_present:
        assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
        assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None
    else:
        assert run.metrics.senior_breakeven_pct_of_lender_gdv is not None
        assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is not None
        total = (
            run.metrics.senior_breakeven_pct_of_lender_gdv
            + run.metrics.senior_breakeven_fall_from_lender_gdv_pct
        )
        assert round(total, 2) == 100.0


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_developer_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 5 (spec Sec 5.12): developer_breakeven_pence is null exactly when
    the schedule recorded no disposal at all (gross_sales_pence == 0) -- a strictly wider
    condition than senior_breakeven_pence's redemption-balance guard, since it does not
    depend on a facility existing."""
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert (run.metrics.developer_breakeven_pence is None) == (
        run.schedule.totals.gross_sales_pence == 0
    )


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_developer_breakeven_covers_tdc_ex_selling_plus_legal(path: Path) -> None:
    """When non-null, developer_breakeven_pence >= TDC-ex-selling + the flat selling
    legal fee (spec Sec 5.12 invariant -- the fixed-cost floor before the agent's
    percentage fee on P itself)."""
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    if run.metrics.developer_breakeven_pence is not None:
        tdc_ex_selling = run.metrics.total_development_cost_pence - run.metrics.selling_costs_pence
        assert run.metrics.developer_breakeven_pence >= (
            tdc_ex_selling + inputs.exit_strategy.selling_legal_fee_pence
        )


def test_developer_breakeven_non_null_for_cash_fixture_a() -> None:
    """Debt-independence: fixture A is a cash deal with no facility (senior_breakeven_pence
    is null for it), but it still sold every unit, so developer_breakeven_pence must be
    non-null."""
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.developer_breakeven_pence is not None


def test_developer_breakeven_unsolvable_flag_raised_once_when_agent_fee_at_100_pct() -> None:
    """Release 2b Task 5 (spec Sec 5.12): when the agent fee is >= 100%, the solver
    returns None and derive_metrics raises exactly one developer_breakeven_unsolvable red
    flag on the result, with the exact spec-mandated message -- mirroring Task 4's
    senior_breakeven_unsolvable flag."""
    doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
    doc["inputs"]["exit_strategy"]["selling_agent_fee_pct"] = 100
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)

    assert run.schedule.totals.gross_sales_pence > 0
    assert run.metrics.developer_breakeven_pence is None
    # Deviation from brief (R3a Task 6): derive_metrics no longer mutates model.flags
    # -- the flag now lands on the result's own `flags` list, not model.flags. The
    # assertion content is unchanged.
    flags = [f for f in run.metrics.flags if f.code == "developer_breakeven_unsolvable"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month is None
    assert flags[0].amount_pence is None
    assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


def test_senior_breakeven_all_null_for_cash_fixture_a() -> None:
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
    assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None


def test_senior_breakeven_unsolvable_flag_raised_once_when_agent_fee_at_100_pct() -> None:
    """Release 2b Task 4 (spec Sec 5.11): when the agent fee is >= 100%, the solver
    returns None and derive_metrics raises exactly one senior_breakeven_unsolvable red
    flag on the result, with the exact spec-mandated message."""
    doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
    doc["inputs"]["exit_strategy"]["selling_agent_fee_pct"] = 100
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)

    assert run.model.redemption_balance_at_disposal_pence is not None
    assert run.metrics.senior_breakeven_pence is None
    # Deviation from brief (R3a Task 6): derive_metrics no longer mutates model.flags
    # -- the flag now lands on the result's own `flags` list, not model.flags. The
    # assertion content is unchanged.
    flags = [f for f in run.metrics.flags if f.code == "senior_breakeven_unsolvable"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month is None
    assert flags[0].amount_pence is None
    assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


def test_migration_preserves_floors_zero() -> None:
    """conversion-defaults.ts:162 uses `project?.floors ?? DEFAULT_DEAL_SPIDER.storeys`
    -- nullish coalescing, which only falls through on None/absent. A Python port
    using `or` instead of a None-check would wrongly replace a genuine `floors: 0`
    (e.g. a single-storey unit) with the default storeys (2), and cascade into a
    non-zero building_height_m. Both must come out as exactly 0."""
    project = {"id": "p1", "price_pence": 0, "floor_area_sqm": 0, "floors": 0}
    run = migrate_inputs({}, project)
    assert run.deal_spider.storeys == 0
    assert run.deal_spider.building_height_m == 0


# ---------------------------------------------------------------------------
# Fixture K -- the sensitivity suite (spec Sec 12, calc 2.4.0)
#
# Mirror of golden-fixtures.test.ts's `describe('Fixture K - sensitivity suite')`
# block: the same five tests, in the same order, reading the same hand-derived
# expectations out of the same JSON document.
#
# Fixture K carries no `inputs` of its own -- it names `base_fixture`, so Fixture F's
# document cannot drift away from the contract built on it -- which is why it is
# excluded from APPRAISAL_FIXTURES above and asserted here instead.
#
# WHICH ASSERTIONS ARE WHICH (the distinction is the point -- see
# docs/financial-model/model-governance.md Sec 2.1). The derived inputs, the base cell,
# the two corner cells and every tornado span are HAND-DERIVED on the worksheet in
# docs/financial-model/test-cases.md ("Fixture K -- sensitivity suite"), independently
# of both engines. The final test is IDENTITY-ASSERTED, not a snapshot: Sec 12.3 *defines*
# a cell as run_appraisal(apply_scenario(base, overrides)), so asserting that equality
# is asserting the contract itself. A future reader must not mistake it for a snapshot,
# and must not "fix" a hand-derived number by copying what the engine printed.
# ---------------------------------------------------------------------------

K_DOC = _load_fixture(FIXTURE_DIR / "k-sensitivity.json")
K_BASE_INPUTS = parse_calculator_inputs(
    _load_fixture(FIXTURE_DIR / f"{K_DOC['base_fixture']}.json")["inputs"]
)


def _config_from(c: dict) -> SensitivityConfig:
    return SensitivityConfig(
        rows=SensitivityAxis(lever=c["rows"]["lever"], steps=list(c["rows"]["steps"])),
        cols=SensitivityAxis(lever=c["cols"]["lever"], steps=list(c["cols"]["steps"])),
        tornado=[TornadoRange(lever=t["lever"], low=t["low"], high=t["high"]) for t in c["tornado"]],
    )


def _k_config() -> SensitivityConfig:
    return _config_from(K_DOC["config"])


def _levered(**levers: float) -> AnyCalculatorInputs:
    return apply_scenario(K_BASE_INPUTS, ScenarioOverrides(
        label="",
        gdv_adjustment_pct=levers.get("gdv", 0),
        construction_cost_adjustment_pct=levers.get("construction_cost", 0),
        timeline_adjustment_months=levers.get("timeline", 0),
        interest_rate_adjustment_pct=levers.get("interest_rate", 0),
    ))


K_RESULT = run_sensitivity(K_BASE_INPUTS, _k_config())


def test_fixture_k_applies_each_lever_to_the_hand_derived_value() -> None:
    """Hand-derived: the per-axis derived inputs (Sec 12.1 disjointness makes these per
    axis, not per cell). A lever-composition bug shows up here first."""
    for step, expected in K_DOC["expected_derived_inputs"]["gdv"].items():
        levered = _levered(gdv=float(step))
        assert all(u.estimated_value_pence == expected for u in levered.unit_mix.units)
    for step, expected in K_DOC["expected_derived_inputs"]["construction_cost"].items():
        levered = _levered(construction_cost=float(step))
        assert levered.conversion_costs.construction_cost_per_sqm_pence == expected
    for step, expected in K_DOC["expected_derived_inputs"]["timeline"].items():
        assert _levered(timeline=float(step)).finance.term_months == expected
    for step, expected in K_DOC["expected_derived_inputs"]["interest_rate"].items():
        assert _levered(interest_rate=float(step)).finance.annual_interest_rate_pct == expected


def test_fixture_k_reports_the_hand_derived_base_case() -> None:
    """Hand-derived: reused verbatim from Fixture F (Sec 12.5)."""
    for key, expected in K_DOC["expected_base"].items():
        assert getattr(K_RESULT.base, key) == expected, key


def test_fixture_k_reports_the_hand_derived_corner_cells() -> None:
    """Hand-derived: two corners worked through on a worksheet, the way Fixture F was."""
    cells = [c for row in K_RESULT.matrix for c in row]
    for corner in K_DOC["expected_corner_cells"]:
        match = [
            c for c in cells
            if c.row_step == corner["row_step"] and c.col_step == corner["col_step"]
        ]
        assert len(match) == 1, f"corner {corner['row_step']}/{corner['col_step']}"
        cell = match[0]
        for key, expected in corner.items():
            if key in ("row_step", "col_step"):
                continue
            actual = getattr(cell, key)
            assert actual == expected, (
                f"corner {corner['row_step']}/{corner['col_step']}.{key}: {actual} != {expected}"
            )


def test_fixture_k_reports_the_hand_derived_tornado_spans_and_order() -> None:
    """Hand-derived: spans and the resulting order."""
    assert [b.lever for b in K_RESULT.tornado] == K_DOC["expected_tornado_order"]
    for bar in K_RESULT.tornado:
        assert bar.span_pence == K_DOC["expected_tornado_spans_pence"][bar.lever], bar.lever


def test_fixture_k_defines_every_remaining_cell_as_the_levered_appraisal() -> None:
    """Identity-asserted, NOT snapshotted: Sec 12.3 *defines* a cell as this expression,
    so the assertion is the contract. Wrong composition or enumeration is already caught
    by the hand-derived derived-inputs and corners above."""
    for ri, row_step in enumerate(K_RESULT.config.rows.steps):
        for ci, col_step in enumerate(K_RESULT.config.cols.steps):
            expected = run_appraisal(
                _levered(construction_cost=row_step, gdv=col_step)
            ).metrics
            cell = K_RESULT.matrix[ri][ci]
            assert cell.profit_pence == expected.profit_pence
            assert cell.profit_on_cost_pct == expected.profit_on_cost_pct
            assert cell.ltgdv_developer_pct == expected.ltgdv_developer_pct
            assert cell.peak_debt_pence == expected.peak_debt_pence
            assert cell.flags == [f.code for f in expected.flags]


def test_fixture_k_invalid_case_matches_spec_12_7():
    """Hand-derived: 12 + (-12) = 0 < 1 -> unmeasured; 12 + (-11) = 1 -> measured."""
    ic = K_DOC["invalid_case"]
    result = run_sensitivity(K_BASE_INPUTS, _config_from(ic["config"]))
    expected_error = ic["expected_unmeasured_error"]

    for step in ic["expected_unmeasured_rows"]:
        row = next(cells for cells in result.matrix if cells[0].row_step == step)
        for cell in row:
            assert cell.profit_pence is None
            assert cell.peak_debt_pence is None
            assert cell.flags == []
            assert any(
                e.severity == expected_error["severity"]
                and e.field == expected_error["field"]
                and e.message == expected_error["message"]
                for e in cell.validation_errors
            )

    for step in ic["expected_measured_rows"]:
        row = next(cells for cells in result.matrix if cells[0].row_step == step)
        for cell in row:
            assert cell.validation_errors == []
            assert cell.profit_pence is not None


# ---------------------------------------------------------------------------
# Release 4a Task 8 (spec Sec 12, calc 2.4.0): sensitivity suite invariants,
# asserted across the whole fixture corpus rather than pinned to one document.
#
# Fixture K (above) pins exact numbers for a single document (Fixture F levered).
# These assert Sec 12's *properties* hold for every document in the corpus -- the
# base-case identity (Sec 12.5), facility-and-equity invariance in every cell
# (Sec 12.2), total tornado ordering (Sec 12.4), and reproducibility (Sec 1.4) --
# which is what would catch a regression on a deal shaped unlike Fixture F, that
# Fixture K alone cannot. Mirrors invariants.test.ts's "sensitivity suite
# invariants" describe block field-for-field (same four checks, same order).
# ---------------------------------------------------------------------------

def _sensitivity_corpus() -> list[AnyCalculatorInputs]:
    """Every pipeline-shaped fixture in the corpus, not just Fixture F. Includes
    fixture A (all-cash, no debt at all) -- every invariant below must therefore hold
    for a zero-facility document too, not only for financed deals."""
    return [parse_calculator_inputs(_load_fixture(p)["inputs"]) for p in APPRAISAL_FIXTURES]


_SENSITIVITY_CORPUS = _sensitivity_corpus()
_SENSITIVITY_CORPUS_IDS = [p.stem for p in APPRAISAL_FIXTURES]


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_base_case_identical_to_unadjusted_appraisal(inputs: AnyCalculatorInputs) -> None:
    """Spec Sec 12.5: the measurement taken with every lever at zero must equal the
    unadjusted appraisal of the base document exactly, in every reported quantity."""
    plain = run_appraisal(inputs).metrics
    base = run_sensitivity(inputs).base
    assert base.profit_pence == plain.profit_pence
    assert base.peak_debt_pence == plain.peak_debt_pence
    assert base.flags == [f.code for f in plain.flags]


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_holds_committed_facility_and_equity_invariant_in_every_cell(
    inputs: AnyCalculatorInputs,
) -> None:
    """Spec Sec 12.2: the committed facility and equity sources are held at their
    base-document values in every cell of the default grid -- no lever may write to
    them, directly or indirectly."""
    config = DEFAULT_SENSITIVITY_CONFIG
    for row_step in config.rows.steps:
        for col_step in config.cols.steps:
            levered = apply_scenario(inputs, ScenarioOverrides(
                label="",
                gdv_adjustment_pct=col_step,
                construction_cost_adjustment_pct=row_step,
                timeline_adjustment_months=0,
                interest_rate_adjustment_pct=0,
            ))
            assert (
                levered.finance.committed_net_facility_pence
                == inputs.finance.committed_net_facility_pence
            )
            assert (
                levered.finance.committed_gross_facility_pence
                == inputs.finance.committed_gross_facility_pence
            )
            assert levered.finance.day_one_advance_pence == inputs.finance.day_one_advance_pence
            assert (
                [e.amount_pence for e in levered.equity_sources]
                == [e.amount_pence for e in inputs.equity_sources]
            )


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_sorts_the_tornado_totally_and_deterministically(inputs: AnyCalculatorInputs) -> None:
    """Spec Sec 12.4: bars are ordered by span descending, ties broken by the fixed
    lever order -- total, and therefore independent of the order ranges were supplied
    in (Sec 1.4)."""
    forward = run_sensitivity(inputs)
    shuffled_config = SensitivityConfig(
        rows=DEFAULT_SENSITIVITY_CONFIG.rows,
        cols=DEFAULT_SENSITIVITY_CONFIG.cols,
        tornado=list(reversed(DEFAULT_SENSITIVITY_CONFIG.tornado)),
    )
    shuffled = run_sensitivity(inputs, shuffled_config)
    assert [b.lever for b in shuffled.tornado] == [b.lever for b in forward.tornado]
    spans = [b.span_pence for b in forward.tornado]
    # Sec 12.7: a null span (an unmeasured endpoint, e.g. fixtures I/J's timeline bar)
    # always sorts last already, and treating None as 0 here (mirroring the TS sibling
    # test's null-to-0 coercion) is <= every real span here (a magnitude) -- so this
    # numeric re-sort still agrees with the engine's actual placement. This asserts
    # total order, not nullness.
    assert sorted(spans, key=lambda s: -(s or 0)) == spans


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_is_reproducible(inputs: AnyCalculatorInputs) -> None:
    """Spec Sec 1.4: two runs of one document agree exactly."""
    assert run_sensitivity(inputs) == run_sensitivity(inputs)


def test_odd_construction_window_derives_a_4_month_professional_statutory_window() -> None:
    """Not in the original Task 8 brief -- a confirmed coverage gap found during
    Task 7. Every pre-existing fixture in the corpus runs term_months: 12, an even
    (10-month) construction window, so ceil and floor agree there and nothing in the
    whole corpus can ever exercise Sec 6's "odd windows round up" rule (professional /
    statutory window = ceil(construction_window / 2), not floor). A -3 month timeline
    lever on Fixture F (a plain v3 document with no explicit `programme`, so
    build_schedule takes the auto-window branch at schedule.py:158) turns its 12-month
    term into 9 months, so construction_window = max(1, 9 - 2) = 7 (odd) and, per
    Sec 6, professional_window = ceil(7 / 2) = 4 -- derived here from the rule itself,
    not read off the engine and copied back in. Guarded inside this sensitivity-suite
    module, rather than the general schedule tests, because the timeline lever is what
    the corpus needed to reach an odd window in the first place."""
    f_doc = _load_fixture(FIXTURE_DIR / "f-dev-finance-12mo.json")
    f_inputs = parse_calculator_inputs(f_doc["inputs"])
    assert getattr(f_inputs, "programme", None) is None  # must take the auto-window branch

    levered = apply_scenario(f_inputs, ScenarioOverrides(
        label="",
        gdv_adjustment_pct=0,
        construction_cost_adjustment_pct=0,
        timeline_adjustment_months=-3,
        interest_rate_adjustment_pct=0,
    ))
    assert levered.finance.term_months == 9

    schedule = build_schedule(levered)
    assert schedule.term_months == 9

    # construction_window = max(1, term - 2) = 7 (odd); professional_window =
    # ceil(7 / 2) = 4, per Sec 6's "odd windows round up" rule. Both spreads are
    # placed starting at month index 1, so the professional window occupies exactly
    # indices 1..4 of a 9-month schedule.
    professional_presence = [m.professional_pence > 0 for m in schedule.uses]
    assert professional_presence == [False, True, True, True, True, False, False, False, False]

    # Statutory month 0 also always carries the flat prior-approval fee
    # (unconditional, schedule.py), so the window check excludes it and looks only
    # at the spread that starts at month 1 -- the same 4-month window as professional.
    statutory_window_months = sum(1 for m in schedule.uses[1:] if m.statutory_pence > 0)
    assert statutory_window_months == 4
