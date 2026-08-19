"""R10 spec §16. Python mirror of frontend/src/lib/model/cost-plan.test.ts."""
from app.financial_model.types import (
    CONTINGENCY_CLASS_NAMES,
    COST_PACKAGE_CODES,
    DEFAULT_COST_PLAN,
    FEE_CODE_CATEGORY,
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


def test_default_contingency_classes_put_the_percentage_on_general_only():
    classes = default_contingency_classes(12.5)
    assert [(c.name, c.pct) for c in classes] == [
        ("general", 12.5), ("existing_building", 0.0), ("abnormal", 0.0),
    ]
    assert all(c.basis == "all_packages" for c in classes)
