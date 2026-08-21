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
from app.financial_model.cost_plan import compute_cost_plan
from app.financial_model.migrate import migrate_inputs_to_v6, migrate_inputs_to_v7
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

    def test_returns_a_null_implied_rate_when_the_area_is_zero(self):
        r = compute_cost_plan(
            doc({"mode": "detailed", "packages": [pkg("p1", 2_000_000)],
                 "contingency": CLASSES(0, 0, 0)}),
            0, 1,
        )
        assert r.implied_rate_pence_per_sqm is None
