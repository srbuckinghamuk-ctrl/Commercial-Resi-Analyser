"""R10 spec §16. Python mirror of frontend/src/lib/model/cost-plan.test.ts."""
from app.financial_model.cost_plan import compute_cost_plan
from app.financial_model.migrate import migrate_inputs_to_v6
from app.financial_model.types import (
    CONTINGENCY_CLASS_NAMES,
    COST_PACKAGE_CODES,
    DEFAULT_COST_PLAN,
    FEE_CODE_CATEGORY,
    CalculatorInputsV7,
    CostPlanInputs,
    default_contingency_classes,
)


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
    assert all(c.basis == "all_packages" for c in classes)


# --- compute_cost_plan -- direct port of cost-plan.test.ts ------------------
#
# Every literal below is copied verbatim from the shipped TypeScript test, not
# recomputed: these numbers are the cross-engine parity contract (R10 Task 4).


def _default_v7() -> CalculatorInputsV7:
    """Python has no defaultCalculatorInputsV7() yet (that migration helper is
    a later task) so this rebuilds what it will produce: v6 defaults promoted
    to v7, with cost_plan left to CalculatorInputsV7's own default factory
    (DEFAULT_COST_PLAN, deep-copied) -- exactly what defaultCalculatorInputsV7
    does in conversion-defaults.ts."""
    v6 = migrate_inputs_to_v6({})
    data = v6.model_dump(mode="json")
    data["inputs_version"] = 7
    return CalculatorInputsV7.model_validate(data)


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
        {"name": "general", "pct": general, "basis": "all_packages", "package_ids": []},
        {"name": "existing_building", "pct": existing, "basis": "all_packages", "package_ids": []},
        {"name": "abnormal", "pct": abnormal, "basis": "all_packages", "package_ids": []},
    ]


def pkg(id_: str, amount: int, over: dict | None = None) -> dict:
    d = {
        "id": id_, "code": "structure", "label": id_, "amount_pence": amount,
        "contingency_class": "general", "lender_eligible": True, "notes": "",
    }
    if over:
        d.update(over)
    return d


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
        r = compute_cost_plan(
            doc({"mode": "detailed", "packages": [pkg("p1", 1_000_010)],
                 "contingency": CLASSES(5, 5, 5)}),
            0, 1,
        )
        assert [c.amount_pence for c in r.contingency] == [50_001, 50_001, 50_001]
        assert r.contingency_total_pence == 150_003

    def test_resolves_a_selected_packages_class_against_only_the_named_packages(self):
        # existing_building at 20% of p2 alone (2,000,000) = 400,000.
        # general at 10% of the whole base build (3,000,000) = 300,000.
        r = compute_cost_plan(
            doc({
                "mode": "detailed",
                "packages": [pkg("p1", 1_000_000), pkg("p2", 2_000_000)],
                "contingency": [
                    {"name": "general", "pct": 10, "basis": "all_packages", "package_ids": []},
                    {"name": "existing_building", "pct": 20, "basis": "selected_packages",
                     "package_ids": ["p2"]},
                    {"name": "abnormal", "pct": 0, "basis": "all_packages", "package_ids": []},
                ],
            }),
            0, 1,
        )
        assert r.base_build_pence == 3_000_000
        assert r.contingency[0].base_pence == 3_000_000
        assert r.contingency[0].amount_pence == 300_000
        assert r.contingency[1].base_pence == 2_000_000
        assert r.contingency[1].amount_pence == 400_000
        assert r.contingency_total_pence == 700_000


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

    def test_returns_a_null_implied_rate_when_the_area_is_zero(self):
        r = compute_cost_plan(
            doc({"mode": "detailed", "packages": [pkg("p1", 2_000_000)],
                 "contingency": CLASSES(0, 0, 0)}),
            0, 1,
        )
        assert r.implied_rate_pence_per_sqm is None
