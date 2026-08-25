"""R10 spec §16. Python mirror of frontend/src/lib/model/cost-plan.test.ts.

Mirrors the TS file's test cases and their literal expected values (see the
comment above `doc()`/`CLASSES`/`pkg()` below), but not byte-for-byte: Task 6
fix round 1 (I3) found `_default_v7()` below TEMPORARILY diverged from its TS
counterpart (TS's `defaultCalculatorInputsV7()` still built `cost_plan` from
the bare `DEFAULT_COST_PLAN`, no fee lines). Task 12 made the TS side repoint
to `costPlanFromLegacyCosts(DEFAULT_CONVERSION_COSTS)` -- the same
construction this function already goes through via `migrate_inputs_to_v7` --
so the two engines' v7 defaults have RE-CONVERGED. See
`test_default_v7_matches_typescripts_default_calculator_inputs_v7` below,
which pins the same eight fee-line literals
`conversion-defaults.test.ts` pins on the TS side."""
import copy
import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.cost_plan import compute_cost_plan
from app.financial_model.due_diligence import months_between
from app.financial_model.engine import money_round
from app.financial_model.migrate import migrate_inputs_to_v6, migrate_inputs_to_v7, migrate_inputs_to_v13
from app.financial_model.types import (
    CONTINGENCY_CLASS_NAMES,
    COST_PACKAGE_CODES,
    DEFAULT_COST_PLAN,
    FEE_CODE_CATEGORY,
    CalculatorInputsV7,
    CalculatorInputsV13,
    CostPlanInputs,
    default_contingency_classes,
)
from tests.fixtures_cost_plan_in_time import doc_z, doc_z_no_allowance, parse


def test_package_codes_match_the_audit_list():
    # The twelve packages of audit §7.5, plus `other`. Pinned as a literal so
    # that adding or renaming a code is a deliberate, reviewed change rather
    # than a silent widening of the schedule.
    assert COST_PACKAGE_CODES == (
        "enabling_strip_out_asbestos", "structure", "envelope", "roof_windows",
        "fire_acoustic_thermal", "mech_elec_public_health", "drainage_utilities",
        "lift", "partitions", "finishes", "common_parts", "externals", "other",
    )


def test_building_control_is_statutory_not_professional():
    # The single most likely migration defect: building_control sits inside the
    # professional-fee block in ConversionCostInputs but schedule.py counts it in
    # the STATUTORY total. Getting it wrong leaves every grand total correct.
    assert FEE_CODE_CATEGORY["building_control"] == "statutory"
    assert FEE_CODE_CATEGORY["prior_approval"] == "statutory"
    assert FEE_CODE_CATEGORY["cil_s106"] == "statutory"
    assert FEE_CODE_CATEGORY["architect"] == "professional"
    assert FEE_CODE_CATEGORY["mande"] == "professional"


def test_default_cost_plan_is_headline_with_no_packages():
    assert DEFAULT_COST_PLAN.mode == "headline"
    assert DEFAULT_COST_PLAN.packages == []
    assert [c.name for c in DEFAULT_COST_PLAN.contingency] == list(CONTINGENCY_CLASS_NAMES)


def test_legacy_conversion_keeps_building_control_statutory():
    # The one construction shared by the migration and the engine fallback.
    # A second, divergent copy would make migrating a document change its figures.
    from app.financial_model.types import ConversionCostInputs, cost_plan_from_legacy_costs

    cc = ConversionCostInputs(
        prior_approval_fee_per_dwelling_pence=150_000,
        cil_s106_pence=200_000,
        architect_pence=500_000,
        structural_engineer_pence=100_000,
        mande_pence=100_000,
        planning_consultant_pence=50_000,
        building_control_pence=75_000,
        other_professional_fees_pence=25_000,
        construction_cost_per_sqm_pence=200_000,
        total_construction_sqm=500.0,
        contingency_pct=10.0,
        fire_safety_pence=0,
        sound_insulation_pence=0,
        part_l_compliance_pence=0,
    )

    plan = cost_plan_from_legacy_costs(cc)
    by_code = {f.code: f for f in plan.fee_lines}
    assert len(plan.fee_lines) == 8
    assert all(f.basis == "fixed" for f in plan.fee_lines)
    assert by_code["building_control"].category == "statutory"
    assert by_code["prior_approval"].per_dwelling is True
    assert by_code["architect"].category == "professional"
    # Strengthening (Task 4): the assertions above never checked the amount a
    # bug that zeroed every converted fee would still pass them.
    expected_amounts = {
        "architect": 500_000,
        "structural_engineer": 100_000,
        "mande": 100_000,
        "planning_consultant": 50_000,
        "other_professional": 25_000,
        "prior_approval": 150_000,
        "cil_s106": 200_000,
        "building_control": 75_000,
    }
    for code, amount in expected_amounts.items():
        assert by_code[code].amount_pence == amount


def test_default_contingency_classes_put_the_percentage_on_general_only():
    classes = default_contingency_classes(12.5)
    assert [(c.name, c.pct) for c in classes] == [
        ("general", 12.5), ("existing_building", 0.0), ("abnormal", 0.0),
    ]


# --- compute_cost_plan -- direct port of cost-plan.test.ts ------------------
#
# Every literal below is copied verbatim from the shipped TypeScript test, not
# recomputed: these numbers are the cross-engine parity contract (R10 Task 4).


def _default_v7() -> CalculatorInputsV7:
    """Task 6 repoint, fix round 1 (I3): this defers to the real
    migrate_inputs_to_v7 rather than hand-rebuilding a v7 document (the
    original reason for the hand-rebuild -- "Python has no
    defaultCalculatorInputsV7() yet" -- no longer held once Task 6 shipped
    the migration).

    Between Task 6 and Task 12 this was NOT a verbatim mirror of
    cost-plan.test.ts's own `doc()`/default helper: TS's helper called
    `defaultCalculatorInputsV7()`, which built `cost_plan` from the bare
    `DEFAULT_COST_PLAN` (no fee lines), while this function -- via
    migrate_inputs_to_v7({}) -- already derived `cost_plan` from
    DEFAULT_CONVERSION_COSTS via cost_plan_from_legacy_costs, so it produced
    eight non-zero fee lines where TS's helper produced zero.

    Task 12 made the TS side repoint to the same construction
    (`costPlanFromLegacyCosts(DEFAULT_CONVERSION_COSTS)`), so the two engines'
    v7 defaults have RE-CONVERGED --
    `test_default_v7_matches_typescripts_default_calculator_inputs_v7` below
    pins the same eight fee-line literals `conversion-defaults.test.ts` pins
    on the TS side."""
    return migrate_inputs_to_v7({})


def test_default_v7_matches_typescripts_default_calculator_inputs_v7():
    """R10 Task 12, carried item (b). Both engines' v7 default document is
    built the same way -- `cost_plan_from_legacy_costs(DEFAULT_CONVERSION_COSTS)`
    -- and Python's DEFAULT_CONVERSION_COSTS (app/financial_model/migrate.py)
    is field-for-field identical to TS's (frontend/src/lib/conversion-defaults.ts).
    This pins the literal figures `conversion-defaults.test.ts`'s
    'defaultCalculatorInputsV7 (R10 Task 12)' describe block independently
    pins on the TS side: same fee-line codes, categories, amounts and
    per_dwelling flags, and the same contingency percentages. If either
    engine's default changes without the other, this is the test that fails."""
    plan = _default_v7().cost_plan
    assert plan.mode == "headline"
    assert plan.packages == []
    assert [(c.name, c.pct) for c in plan.contingency] == [
        ("general", 10.0), ("existing_building", 0.0), ("abnormal", 0.0),
    ]
    by_code = {f.code: f for f in plan.fee_lines}
    assert set(by_code.keys()) == {
        "architect", "structural_engineer", "mande", "planning_consultant",
        "other_professional", "prior_approval", "cil_s106", "building_control",
    }
    expected = {
        "architect": ("professional", 1_500_000, False),
        "structural_engineer": ("professional", 500_000, False),
        "mande": ("professional", 500_000, False),
        "planning_consultant": ("professional", 300_000, False),
        "other_professional": ("professional", 0, False),
        "prior_approval": ("statutory", 9_600, True),
        "cil_s106": ("statutory", 0, False),
        "building_control": ("statutory", 200_000, False),
    }
    for code, (category, amount, per_dwelling) in expected.items():
        f = by_code[code]
        assert f.basis == "fixed"
        assert f.category == category
        assert f.amount_pence == amount
        assert f.pct == 0
        assert f.per_dwelling is per_dwelling


def doc(over: dict, costs: dict | None = None) -> CalculatorInputsV7:
    """A v7 document with the cost plan (and optionally the cost fields)
    replaced. Mirrors cost-plan.test.ts's `doc` helper: `over` is merged onto
    the default cost_plan and re-validated, so nested dicts for packages /
    contingency / fee_lines become real CostPackage / ContingencyClass /
    FeeLine instances rather than plain dicts the duck-typed engine can't
    read attributes off."""
    base = _default_v7()
    cost_plan = CostPlanInputs.model_validate({
        **base.cost_plan.model_dump(mode="json"), **over,
    })
    conversion_costs = (
        base.conversion_costs.model_copy(update=costs) if costs else base.conversion_costs
    )
    return base.model_copy(update={"cost_plan": cost_plan, "conversion_costs": conversion_costs})


def CLASSES(general: float, existing: float, abnormal: float) -> list[dict]:
    return [
        {"name": "general", "pct": general},
        {"name": "existing_building", "pct": existing},
        {"name": "abnormal", "pct": abnormal},
    ]


def pkg(id_: str, amount: int, over: dict | None = None) -> dict:
    d = {
        "id": id_, "code": "structure", "label": id_, "amount_pence": amount,
        "contingency_class": "general", "lender_eligible": True, "notes": "",
    }
    if over:
        d.update(over)
    return d


def detailed_cost_plan_document(*, packages: list[dict] | None = None,
                                 contingency: list[dict] | None = None) -> CalculatorInputsV7:
    """R11 spec Sec 17.8. Python twin of cost-plan.test.ts's
    detailedCostPlanDocument. `package_ids: []` is stamped onto every
    contingency class regardless: a bare `{"name", "pct"}` is the correct
    final input shape (the field is gone from ContingencyClass), but
    stamping it keeps this helper safe to run against the PRE-refactor
    engine too, which still reads `c.package_ids` -- without it, pydantic's
    own default (also `[]`) would apply just the same via model_validate,
    but stamping it explicitly here keeps the two engines' helpers as close
    to identical, statement for statement, as the languages allow."""
    over: dict = {"mode": "detailed"}
    if packages is not None:
        over["packages"] = packages
    if contingency is not None:
        over["contingency"] = [{"package_ids": [], **c} for c in contingency]
    return doc(over)


def headline_cost_plan_document(*, construction_per_sqm: int | None = None,
                                 area_sqm: float | None = None,
                                 contingency: list[dict] | None = None) -> CalculatorInputsV7:
    over: dict = {"mode": "headline"}
    if contingency is not None:
        over["contingency"] = [{"package_ids": [], **c} for c in contingency]
    costs = (
        {"construction_cost_per_sqm_pence": construction_per_sqm}
        if construction_per_sqm is not None else None
    )
    return doc(over, costs)


class TestComputeCostPlanHeadlineMode:
    def test_reproduces_the_pre_r10_base_rate_times_area(self):
        # 80,730 p/m2 x 500 m2 = 40,365,000 p. Derived by hand.
        r = compute_cost_plan(
            doc({"mode": "headline", "contingency": CLASSES(0, 0, 0)},
                {"construction_cost_per_sqm_pence": 80_730}),
            500, 1,
        )
        assert r.base_build_pence == 40_365_000
        assert r.compliance_pence == 0
        assert r.construction_total_pence == 40_365_000

    def test_keeps_compliance_allowances_as_a_separate_component_in_headline_mode(self):
        # 40,365,000 base + 0 contingency + (250,000 + 150,000 + 100,000) compliance
        r = compute_cost_plan(
            doc({"mode": "headline", "contingency": CLASSES(0, 0, 0)}, {
                "construction_cost_per_sqm_pence": 80_730,
                "fire_safety_pence": 250_000, "sound_insulation_pence": 150_000,
                "part_l_compliance_pence": 100_000,
            }),
            500, 1,
        )
        assert r.compliance_pence == 500_000
        assert r.construction_total_pence == 40_865_000


class TestComputeCostPlanThreeContingencyClassesRoundIndependently:
    def test_sums_three_rounded_figures_rather_than_rounding_the_sum(self):
        # Base build chosen so each 5% lands on a half-penny: 1,000,010 x 5% =
        # 50,000.5 -> 50,001 half-up. Three classes: 150,003.
        # One class at 15% would be 150,001.5 -> 150,002. The two differ by 1p,
        # so this test fails if the classes are ever collapsed for rounding.
        #
        # Headline mode: R11 spec Sec 17.8 makes existing_building/abnormal
        # scope by package tag in DETAILED mode, so a single untagged package
        # could no longer give all three classes the same base. Headline mode
        # still gives every class the whole base build, which is what this
        # test needs to isolate rounding independence from scoping.
        r = compute_cost_plan(
            headline_cost_plan_document(
                construction_per_sqm=1_000_010, area_sqm=1, contingency=CLASSES(5, 5, 5),
            ),
            1, 1,
        )
        assert [c.amount_pence for c in r.contingency] == [50_001, 50_001, 50_001]
        assert r.contingency_total_pence == 150_003

    def test_resolves_existing_building_against_only_its_tagged_packages_as_an_addition_to_general(self):
        # existing_building at 20% of p2 alone (2,000,000, tagged
        # existing_building) = 400,000.
        # general at 10% of the whole base build (3,000,000) = 300,000.
        r = compute_cost_plan(
            detailed_cost_plan_document(
                packages=[
                    pkg("p1", 1_000_000, {"contingency_class": "general"}),
                    pkg("p2", 2_000_000, {"contingency_class": "existing_building"}),
                ],
                contingency=[
                    {"name": "general", "pct": 10},
                    {"name": "existing_building", "pct": 20},
                    {"name": "abnormal", "pct": 0},
                ],
            ),
            0, 1,
        )
        assert r.base_build_pence == 3_000_000
        assert r.contingency[0].base_pence == 3_000_000
        assert r.contingency[0].amount_pence == 300_000
        assert r.contingency[1].base_pence == 2_000_000
        assert r.contingency[1].amount_pence == 400_000
        assert r.contingency_total_pence == 700_000


class TestComputeCostPlanContingencyScopedByPackageTag:
    """R11 spec Sec 17.8. Python twin of cost-plan.test.ts's planted-divergence
    suite. The two mechanisms (tag vs. package_ids) agree in every document
    that exists today, so a re-pin proves nothing -- these documents make the
    tag and a (pre-migration) id list DISAGREE deliberately."""

    def test_resolves_a_contingency_base_from_the_package_tag_not_from_a_stale_id_list(self):
        # Before this task, package_ids decided the base -- and this document's
        # helper stamps package_ids: [] on every class, since nothing here sets
        # it, so the old mechanism would report 0, not a plausible-looking
        # figure from either package. After it, the tag decides and the base
        # is the OTHER package (7,000,000, abnormal's own package, not
        # general's 1,000,000).
        inputs = detailed_cost_plan_document(
            packages=[
                pkg("p1", 1_000_000, {"contingency_class": "general"}),
                pkg("p2", 7_000_000, {"code": "externals", "contingency_class": "abnormal"}),
            ],
            contingency=[
                {"name": "general", "pct": 0},
                {"name": "existing_building", "pct": 0},
                {"name": "abnormal", "pct": 10},
            ],
        )
        result = compute_cost_plan(inputs, 100, 1)
        abnormal = next(c for c in result.contingency if c.name == "abnormal")
        assert abnormal.base_pence == 7_000_000
        assert abnormal.amount_pence == 700_000
        assert abnormal.basis == "selected_packages"

    def test_gives_every_contingency_class_the_whole_base_build_in_headline_mode(self):
        # The calculator renders all three percentages in BOTH modes, and a
        # headline document has no packages to tag. Scoping by tag here would
        # silently zero a live, shipped input path (spec Sec 17.8).
        inputs = headline_cost_plan_document(
            construction_per_sqm=100_000, area_sqm=100,   # base build 10,000,000p
            contingency=[
                {"name": "general", "pct": 5},
                {"name": "existing_building", "pct": 15},
                {"name": "abnormal", "pct": 0},
            ],
        )
        result = compute_cost_plan(inputs, 100, 1)
        existing = next(c for c in result.contingency if c.name == "existing_building")
        assert existing.base_pence == 10_000_000
        assert existing.amount_pence == 1_500_000
        assert existing.basis == "all_packages"

    def test_gives_general_the_whole_base_build_in_detailed_mode_tagged_or_not(self):
        inputs = detailed_cost_plan_document(
            packages=[
                pkg("p1", 1_000_000, {"contingency_class": "existing_building"}),
                pkg("p2", 7_000_000, {"code": "externals", "contingency_class": "abnormal"}),
            ],
            contingency=[
                {"name": "general", "pct": 5},
                {"name": "existing_building", "pct": 0},
                {"name": "abnormal", "pct": 0},
            ],
        )
        result = compute_cost_plan(inputs, 100, 1)
        general = next(c for c in result.contingency if c.name == "general")
        assert general.base_pence == 8_000_000
        assert general.basis == "all_packages"


class TestComputeCostPlanFeeBasesNeverIncludeFees:
    def test_resolves_pct_of_construction_total_against_cost_only_not_against_other_fees(self):
        # base_build 2,000,000; general contingency 10% = 200,000; compliance 0
        # (detailed mode) -> construction_total 2,200,000.
        # Architect at 6% of construction total = 132,000.
        # A large fixed fee of 9,000,000 is present precisely so that a defect
        # which folded fees into the base would produce 672,000 instead of
        # 132,000.
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 2_000_000)],
                "contingency": CLASSES(10, 0, 0),
                "fee_lines": [
                    {"id": "f1", "code": "architect", "category": "professional",
                     "label": "Architect", "basis": "pct_of_construction_total",
                     "amount_pence": 0, "pct": 6, "per_dwelling": False},
                    {"id": "f2", "code": "other_professional", "category": "professional",
                     "label": "PM", "basis": "fixed", "amount_pence": 9_000_000, "pct": 0,
                     "per_dwelling": False},
                ],
            }),
            0, 1,
        )
        assert r.construction_total_pence == 2_200_000
        assert r.fees[0].base_pence == 2_200_000
        assert r.fees[0].amount_pence == 132_000
        assert r.professional_total_pence == 9_132_000

    def test_resolves_pct_of_base_build_against_the_base_build_excluding_contingency(self):
        # base_build 2,000,000, contingency 10% -> the two bases differ by
        # 200,000. 6% of 2,000,000 = 120,000, against 132,000 on the other basis.
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 2_000_000)],
                "contingency": CLASSES(10, 0, 0),
                "fee_lines": [
                    {"id": "f1", "code": "architect", "category": "professional",
                     "label": "Architect", "basis": "pct_of_base_build",
                     "amount_pence": 0, "pct": 6, "per_dwelling": False},
                ],
            }),
            0, 1,
        )
        assert r.fees[0].base_pence == 2_000_000
        assert r.fees[0].amount_pence == 120_000

    def test_multiplies_a_per_dwelling_fixed_fee_by_unit_count_and_splits_categories(self):
        # prior approval 9,600 x 4 dwellings = 38,400, STATUTORY.
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 1_000_000)],
                "contingency": CLASSES(0, 0, 0),
                "fee_lines": [
                    {"id": "f1", "code": "prior_approval", "category": "statutory",
                     "label": "Prior approval", "basis": "fixed", "amount_pence": 9_600,
                     "pct": 0, "per_dwelling": True},
                    {"id": "f2", "code": "architect", "category": "professional",
                     "label": "Architect", "basis": "fixed", "amount_pence": 1_500_000,
                     "pct": 0, "per_dwelling": False},
                ],
            }),
            0, 4,
        )
        assert r.statutory_total_pence == 38_400
        assert r.professional_total_pence == 1_500_000


class TestComputeCostPlanDetailedModeDropsComplianceToZero:
    def test_ignores_the_compliance_fields_entirely_in_detailed_mode(self):
        # Validation rejects this document (Task 10), but the ENGINE must not
        # double count if it ever sees one: compliance is 0 in detailed mode.
        r = compute_cost_plan(
            doc({"mode": "detailed", "packages": [pkg("p1", 1_000_000)],
                 "contingency": CLASSES(0, 0, 0)},
                {"fire_safety_pence": 250_000}),
            0, 1,
        )
        assert r.compliance_pence == 0
        assert r.construction_total_pence == 1_000_000


class TestComputeCostPlanAPreV7DocumentKeepsItsOwnFigures:
    def test_derives_the_plan_from_the_legacy_cost_fields_not_from_default_cost_plan(self):
        # The exact defect this guards: DEFAULT_COST_PLAN has no fee lines and
        # a hardcoded 10% contingency, so a v6 document would report zero
        # professional fees and the wrong contingency once the schedule reads
        # these totals. Contingency 15% (not the 10% default) and architect
        # 1,500,000 are both chosen so the wrong fallback produces visibly
        # wrong numbers.
        #
        # DEFAULT_CONVERSION_COSTS carries non-zero defaults for every fee
        # field (structural_engineer_pence, mande_pence,
        # planning_consultant_pence, prior_approval_fee_per_dwelling_pence),
        # so every fee field other than architect/building_control is zeroed
        # here too -- otherwise the totals below would include figures this
        # test never mentions.
        v6 = migrate_inputs_to_v6({})
        v6 = v6.model_copy(update={
            "conversion_costs": v6.conversion_costs.model_copy(update={
                "construction_cost_per_sqm_pence": 10_000,
                "contingency_pct": 15,
                "architect_pence": 1_500_000,
                "structural_engineer_pence": 0,
                "mande_pence": 0,
                "planning_consultant_pence": 0,
                "other_professional_fees_pence": 0,
                "building_control_pence": 200_000,
                "prior_approval_fee_per_dwelling_pence": 0,
                "cil_s106_pence": 0,
                "fire_safety_pence": 0, "sound_insulation_pence": 0,
                "part_l_compliance_pence": 0,
            }),
        })
        r = compute_cost_plan(v6, 400, 1)
        assert r.base_build_pence == 4_000_000
        assert r.contingency[0].pct == 15
        assert r.contingency_total_pence == 600_000  # 15% of 4,000,000
        assert r.professional_total_pence == 1_500_000
        assert r.statutory_total_pence == 200_000


class TestComputeCostPlanReportedExtras:
    def test_reports_the_lender_eligible_base_and_the_implied_rate(self):
        # eligible = p1 only (2,000,000); implied rate = 3,000,000 / 500 = 6,000 p/m2
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 2_000_000), pkg("p2", 1_000_000, {"lender_eligible": False})],
                "contingency": CLASSES(0, 0, 0),
            }),
            500, 1,
        )
        assert r.lender_eligible_base_pence == 2_000_000
        assert r.implied_rate_pence_per_sqm == 6_000

    # R14 spec Sec 5. The ratio the ledger's Sec 4.2(b) cap base reads.
    # Unrounded: 2,000,000 / 3,000,000 is exactly 2/3, and the ONE rounding
    # happens later, on `construction_pence * ratio` inside the ledger.
    def test_reports_the_lender_eligible_ratio_unrounded(self):
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 2_000_000), pkg("p2", 1_000_000, {"lender_eligible": False})],
                "contingency": CLASSES(0, 0, 0),
            }),
            500, 1,
        )
        assert r.lender_eligible_ratio == 2 / 3
        assert isinstance(r.lender_eligible_ratio, float)

    def test_reports_a_lender_eligible_ratio_of_one_when_every_package_is_eligible(self):
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 2_000_000), pkg("p2", 1_000_000)],
                "contingency": CLASSES(0, 0, 0),
            }),
            500, 1,
        )
        assert r.lender_eligible_ratio == 1

    # Headline mode has no packages at all, so `lender_eligible_base_pence` is 0
    # against a NON-zero base build -- the one case where the raw quotient (0)
    # would silently zero the ledger's whole construction cap base.
    def test_reports_a_lender_eligible_ratio_of_one_in_headline_mode(self):
        r = compute_cost_plan(
            doc({"mode": "headline", "packages": [], "contingency": CLASSES(0, 0, 0)},
                {"construction_cost_per_sqm_pence": 80_730}),
            500, 1,
        )
        assert r.packages == []
        assert r.base_build_pence == 40_365_000
        assert r.lender_eligible_base_pence == 0
        assert r.lender_eligible_ratio == 1

    # R14 fix round 1. The `not detailed` half of the guard, pinned on its own: a
    # headline document CAN carry stray packages (apply_scenario scales them
    # regardless of mode, and lender_eligible_base_pence sums them regardless of
    # mode), so base_build == 0 is NOT what saves headline mode here. Base build
    # is the rate * area product, the eligible base is 3,000,000 of a 4,000,000
    # package sum, and the quotient would be neither 1 nor even meaningful -- the
    # packages are not the base. Only `not detailed` gives the right answer.
    def test_reports_a_lender_eligible_ratio_of_one_in_headline_mode_with_stray_packages(self):
        r = compute_cost_plan(
            doc({
                "mode": "headline",
                "packages": [pkg("p1", 3_000_000), pkg("p2", 1_000_000, {"lender_eligible": False})],
                "contingency": CLASSES(0, 0, 0),
            }, {"construction_cost_per_sqm_pence": 80_730}),
            500, 1,
        )
        assert len(r.packages) == 2
        assert r.base_build_pence == 40_365_000  # rate * area, not the package sum
        assert r.lender_eligible_base_pence == 3_000_000
        assert r.lender_eligible_ratio == 1
        # Not the raw quotient, which would be a nonsense 0.0743...
        assert r.lender_eligible_ratio != 3_000_000 / 40_365_000

    def test_reports_a_lender_eligible_ratio_of_one_when_base_build_is_zero(self):
        r = compute_cost_plan(
            doc({"mode": "detailed", "packages": [], "contingency": CLASSES(0, 0, 0)}),
            500, 1,
        )
        assert r.base_build_pence == 0
        assert r.lender_eligible_ratio == 1

    def test_returns_a_null_implied_rate_when_the_area_is_zero(self):
        r = compute_cost_plan(
            doc({"mode": "detailed", "packages": [pkg("p1", 2_000_000)],
                 "contingency": CLASSES(0, 0, 0)}),
            0, 1,
        )
        assert r.implied_rate_pence_per_sqm is None


# R15 spec Sec 23.6. Fixture Y (docs/... y-derivation.md) is fixture X
# (fixtures/financial-model/x-unit-sales-ledger.json) with the evidence layer
# added and no money field changed. Task 4 runs BEFORE Task 3, so the shared
# `dd_doc`/`fixtures_due_diligence` builders do not exist yet -- this is a
# local, task-scoped equivalent covering only the cost-plan additions
# (`cost_plan.qs`, per-package `price_basis`) fixture Y carries.
_FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "financial-model"

_Y_QS = {
    "source": "Gardiner & Theobald", "stage": "riba_3", "date": "2026-08-01",
    "status": "issued", "base_date": "2026-07-01",
}
_Y_PRICE_BASIS = {"pkg-structure": "fixed_price", "pkg-envelope": "provisional_sum", "pkg-mande": None}


def _y_cost_plan_doc(overrides: dict | None = None) -> CalculatorInputsV13:
    o = dict(overrides or {})
    raw = json.loads((_FIXTURE_DIR / "x-unit-sales-ledger.json").read_text(encoding="utf-8"))["inputs"]
    v13 = migrate_inputs_to_v13(raw, None)
    plan = v13.model_dump(mode="json")

    plan["cost_plan"]["qs"] = o["qs"] if "qs" in o else copy.deepcopy(_Y_QS)

    basis = dict(_Y_PRICE_BASIS)
    basis.update(o.get("price_basis", {}))
    for p in plan["cost_plan"]["packages"]:
        p["price_basis"] = basis.get(p["id"])

    if "mode" in o:
        plan["cost_plan"]["mode"] = o["mode"]
        if o["mode"] == "headline":
            plan["cost_plan"]["packages"] = []

    return CalculatorInputsV13.model_validate(plan)


class TestPriceBasisSummaryAndQsProvenance:
    def test_price_basis_summary_by_hand_on_fixture_y(self):
        r = run_appraisal(_y_cost_plan_doc()).metrics.cost_plan
        pb = r.price_basis
        assert (pb.fixed_price_pence, pb.provisional_sums_pence, pb.estimate_pence, pb.unclassified_pence) == (
            12_000_000, 8_000_000, 0, 6_000_000,
        )
        assert (pb.fixed_price_coverage_pct, pb.provisional_sums_pct) == (46.15, 30.77)
        assert r.qs == {
            "source": "Gardiner & Theobald", "stage": "riba_3", "date": "2026-08-01",
            "status": "issued", "base_date": "2026-07-01", "inflation": None,
        }

    def test_classifying_the_null_package_moves_coverage_by_its_share(self):
        pb = run_appraisal(
            _y_cost_plan_doc({"price_basis": {"pkg-mande": "fixed_price"}})
        ).metrics.cost_plan.price_basis
        assert (pb.fixed_price_pence, pb.unclassified_pence, pb.fixed_price_coverage_pct) == (
            18_000_000, 0, 69.23,
        )
        pb2 = run_appraisal(
            _y_cost_plan_doc({"price_basis": {"pkg-mande": "estimate"}})
        ).metrics.cost_plan.price_basis
        assert (pb2.estimate_pence, pb2.unclassified_pence) == (6_000_000, 0)

    def test_headline_mode_publishes_no_price_basis_and_no_qs(self):
        r = run_appraisal(_y_cost_plan_doc({"mode": "headline", "qs": None})).metrics.cost_plan
        assert r.price_basis is None and r.qs is None


# R15b spec Sec 24.3. Fixture Z (docs/superpowers/plans/2026-08-25-r15b-cost-
# plan-in-time.md, "Hand-derived figures for fixture Z") is fixture S
# (fixtures/financial-model/s-dated-programme.json) plus a QS provenance
# record carrying a tender-price inflation allowance, a new `mande_fitout`
# phase carrying pkg-mande's spend, per-package price basis tags, a VAT
# override on pkg-externals and an extra pct-of-construction-total fee line --
# see doc_z() in tests/fixtures_cost_plan_in_time.py. Every figure below is
# copied verbatim from the task brief's hand-derived worksheet, not
# recomputed. Twin of the 'R15b spec §24.3 inflation' describe block in
# frontend/src/lib/model/cost-plan.test.ts.
class TestInflation:
    def test_z_every_packages_months_factor_and_pence_by_hand(self):
        # The total is the sum of rounded lines.
        cp = compute_cost_plan(parse(doc_z()), 600.0, 4)   # developed_area_sqm is 600; unit count 4
        by = {p.id: p for p in cp.packages}
        enabling = by["pkg-enabling"]
        assert (
            enabling.resolved_phase_id, enabling.start_month,
            enabling.finish_month, enabling.midpoint_month,
        ) == ("strip_out", 6, 8, 6.5)
        assert (enabling.months_from_base, enabling.inflation_pence) == (12.5, 375_460)
        structure = by["pkg-structure"]
        assert (structure.months_from_base, structure.inflation_pence) == (16.5, 2_002_003)
        assert by["pkg-envelope"].inflation_pence == 1_501_502
        assert by["pkg-externals"].inflation_pence == 500_501
        mande = by["pkg-mande"]
        assert mande.months_from_base == pytest.approx(18 + 1 / 3, abs=1e-10)
        assert mande.inflation_pence == 1_117_256
        assert structure.inflation_factor == pytest.approx(1.0834167976, abs=1e-9)
        assert cp.inflation_total_pence == 5_496_722
        assert cp.latest_midpoint_month == pytest.approx(74 / 6, abs=1e-10)
        assert cp.latest_midpoint_months_from_base == pytest.approx(18 + 1 / 3, abs=1e-10)
        # The two whole-figure pins a generator may print alone (R15's lesson
        # -- spec Sec 24.3's own Interfaces note).
        assert cp.inflation_pct_of_base_build == 8.33
        assert cp.latest_midpoint_whole_months_from_base == 18

    def test_z_the_stack(self):
        # Base build uninflated, contingency on the uninflated base,
        # construction total carries the line, the pct fee follows it.
        cp = compute_cost_plan(parse(doc_z()), 600.0, 4)
        assert cp.base_build_pence == 66_000_000
        general = next(c for c in cp.contingency if c.name == "general")
        assert (general.base_pence, general.amount_pence) == (66_000_000, 3_300_000)
        assert cp.construction_total_pence == 74_796_722
        fee_pm = next(f for f in cp.fees if f.id == "fee-pm")
        assert (fee_pm.base_pence, fee_pm.amount_pence) == (74_796_722, 747_967)
        assert cp.professional_total_pence == 8_747_967
        assert cp.lender_eligible_base_pence == 60_000_000
        assert cp.price_basis.fixed_price_coverage_pct == 72.73

    def test_no_allowance(self):
        # Pence 0, factor None, but months_from_base and the latest-midpoint
        # fields are still published.
        cp = compute_cost_plan(parse(doc_z_no_allowance()), 600.0, 4)
        assert cp.inflation_total_pence == 0
        assert cp.construction_total_pence == 69_300_000
        assert all(p.inflation_pence == 0 and p.inflation_factor is None for p in cp.packages)
        assert next(p for p in cp.packages if p.id == "pkg-enabling").months_from_base == 12.5
        assert cp.latest_midpoint_months_from_base == pytest.approx(18 + 1 / 3, abs=1e-10)
        # The same two whole-figure fields the allowance twin pins above --
        # the months are unaffected by the allowance, only the pence and the
        # pct are.
        assert cp.inflation_pct_of_base_build == 0
        assert cp.latest_midpoint_whole_months_from_base == 18

    def test_the_midpoint_is_amount_independent(self):
        # Doubling a package moves its inflation, never its midpoint.
        d = doc_z()
        d["cost_plan"]["packages"][1]["amount_pence"] *= 2
        a = compute_cost_plan(parse(doc_z()), 600.0, 4).packages[1]
        b = compute_cost_plan(parse(d), 600.0, 4).packages[1]
        assert b.midpoint_month == a.midpoint_month
        assert b.inflation_factor == a.inflation_factor
        assert b.inflation_pence != a.inflation_pence

    def test_floor_at_zero(self):
        # A base date after every midpoint gives months 0, factor 1, pence 0
        # -- and the unfloored value is negative.
        d = doc_z()
        d["cost_plan"]["qs"]["base_date"] = "2028-06-01"   # 22 months after acquisition
        cp = compute_cost_plan(parse(d), 600.0, 4)
        assert all(
            p.months_from_base == 0 and p.inflation_factor == 1 and p.inflation_pence == 0
            for p in cp.packages
        )
        assert months_between("2028-06-01", "2026-08-01") + 12.5 < 0

    def test_blank_base_date(self):
        # No months, no inflation, even with acquisition_date and an
        # allowance both present.
        d = doc_z()
        d["cost_plan"]["qs"]["base_date"] = "   "
        cp = compute_cost_plan(parse(d), 600.0, 4)
        assert cp.inflation_total_pence == 0
        assert all(p.months_from_base is None and p.inflation_factor is None for p in cp.packages)
        assert cp.latest_midpoint_months_from_base is None
        # The midpoint itself is unaffected -- only the distance FROM the base is unknown.
        assert cp.latest_midpoint_month == pytest.approx(74 / 6, abs=1e-10)

    # Z's own 6% allowance rounds its sum-of-lines to the SAME figure as
    # rounding the raw sum (5,496,722 both ways -- the "by hand" test above),
    # so it cannot discriminate the two roundings. Verified with math.pow
    # before writing this test (matching the TS twin's Math.pow check): 7%
    # does discriminate on Z's five windows (8% was not needed) -- the five
    # ROUNDED lines sum to 6,424,687p, one penny above money-rounding the raw
    # (unrounded) sum, 6,424,686p.
    def test_rounded_lines_not_a_rounded_sum(self):
        d = doc_z()
        d["cost_plan"]["qs"]["inflation"] = {"annual_pct": 7}
        cp = compute_cost_plan(parse(d), 600.0, 4)
        sum_of_rounded_lines = sum(p.inflation_pence for p in cp.packages)
        rounded_sum_of_raw_products = money_round(
            sum(p.amount_pence * (p.inflation_factor - 1) for p in cp.packages)
        )
        assert cp.inflation_total_pence == sum_of_rounded_lines
        assert cp.inflation_total_pence == 6_424_687
        assert rounded_sum_of_raw_products == 6_424_686
        assert cp.inflation_total_pence != rounded_sum_of_raw_products

    def test_acquisition_date_none_no_months_no_inflation_compute_cost_plan_does_not_throw(self):
        d = doc_z()
        d["acquisition"]["acquisition_date"] = None
        cp = compute_cost_plan(parse(d), 600.0, 4)
        assert cp.inflation_total_pence == 0
        assert cp.packages[0].months_from_base is None
        assert cp.latest_midpoint_months_from_base is None

    def test_headline_mode_no_timing_no_inflation_fields_beyond_their_zero_none_seeds(self):
        cp = compute_cost_plan(
            headline_cost_plan_document(construction_per_sqm=80_730), 500, 1,
        )
        assert cp.packages == []
        assert cp.inflation_total_pence == 0
        assert cp.inflation_pct_of_base_build == 0
        assert cp.latest_midpoint_month is None
        assert cp.latest_midpoint_months_from_base is None
        assert cp.latest_midpoint_whole_months_from_base is None
