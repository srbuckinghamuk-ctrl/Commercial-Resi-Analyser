"""Transliteration of frontend/src/lib/model/lender-valuation.test.ts. Both
implementations must agree with the hand-computed values (spec Sec 3.2), not
merely with each other. If Python disagrees with a fixture, the Python port
is wrong -- never adjust these numbers to make peace."""
import pytest

from app.financial_model import run_appraisal
from app.financial_model.lender_valuation import SQFT_PER_SQM, compute_lender_gdv
from app.financial_model.migrate import default_calculator_inputs_v2, migrate_inputs_to_v6, migrate_v2_to_v3
from app.financial_model.types import (
    CalculatorInputsV3,
    CalculatorInputsV6,
    LenderValuation,
    ProposedUnit,
    ProposedUnitV6,
    UnitAncillary,
    UnitMixInputsV6,
)

PROVENANCE = {"reason": "Test haircut", "author": "test-author", "date": "2026-08-13"}


def base_inputs(lender_valuation: LenderValuation | None) -> CalculatorInputsV3:
    v3_dict = migrate_v2_to_v3(default_calculator_inputs_v2())
    inputs = CalculatorInputsV3.model_validate(v3_dict)
    inputs.unit_mix.units = [
        ProposedUnit(
            id="u1", type="1bed", floor_area_sqm=50,
            estimated_value_pence=10_000_000, comparable_notes="",
        ),
        ProposedUnit(
            id="u2", type="2bed", floor_area_sqm=70,
            estimated_value_pence=15_000_000, comparable_notes="",
        ),
    ]
    inputs.lender_valuation = lender_valuation
    return inputs


class TestComputeLenderGdv:
    def test_returns_none_when_lender_valuation_is_absent(self):
        assert compute_lender_gdv(base_inputs(None)) is None

    def test_sqft_per_sqm_matches_the_codebase_wide_conversion_literal(self):
        assert SQFT_PER_SQM == 10.7639

    def test_global_pct_applies_a_uniform_pct_adjustment_to_every_unit(self):
        lv = LenderValuation(basis="global_pct", global_value=-10, per_key_values=None, **PROVENANCE)
        result = compute_lender_gdv(base_inputs(lv))
        # round(10,000,000 * 0.90) + round(15,000,000 * 0.90)
        assert result.lender_gdv_pence == 9_000_000 + 13_500_000
        assert result.unit_values_pence == [9_000_000, 13_500_000]

    def test_global_per_sqft_replaces_every_unit_value(self):
        lv = LenderValuation(basis="global_per_sqft", global_value=200_000, per_key_values=None, **PROVENANCE)
        result = compute_lender_gdv(base_inputs(lv))
        # round(200,000 * 50 * 10.7639) + round(200,000 * 70 * 10.7639)
        assert result.lender_gdv_pence == 107_639_000 + 150_694_600
        assert result.unit_values_pence == [107_639_000, 150_694_600]

    def test_unit_type_applies_a_per_type_pct_and_falls_back_for_missing_types(self):
        lv = LenderValuation(
            basis="unit_type", global_value=None,
            per_key_values={"1bed": 5, "2bed": -5}, **PROVENANCE,
        )
        inputs = base_inputs(lv)
        inputs.unit_mix.units.append(ProposedUnit(
            id="u3", type="studio", floor_area_sqm=30,
            estimated_value_pence=5_000_000, comparable_notes="",
        ))
        result = compute_lender_gdv(inputs)
        # u1: round(10,000,000*1.05)=10,500,000; u2: round(15,000,000*0.95)=14,250,000;
        # u3 (no 'studio' entry): unchanged 5,000,000
        assert result.lender_gdv_pence == 10_500_000 + 14_250_000 + 5_000_000
        assert result.unit_values_pence == [10_500_000, 14_250_000, 5_000_000]

    def test_per_unit_uses_the_absolute_pence_value_recorded_for_each_id(self):
        lv = LenderValuation(
            basis="per_unit", global_value=None,
            per_key_values={"u1": 9_500_000, "u2": 14_000_000}, **PROVENANCE,
        )
        result = compute_lender_gdv(base_inputs(lv))
        assert result.lender_gdv_pence == 23_500_000
        assert result.unit_values_pence == [9_500_000, 14_000_000]

    def test_per_unit_raises_when_a_unit_id_has_no_recorded_value(self):
        lv = LenderValuation(
            basis="per_unit", global_value=None, per_key_values={"u1": 9_500_000}, **PROVENANCE,
        )
        with pytest.raises(
            ValueError,
            match=r'Lender valuation \(per_unit basis\) is missing a value for unit "u2"\.',
        ):
            compute_lender_gdv(base_inputs(lv))

    def test_fixed_amount_uses_global_value_directly(self):
        lv = LenderValuation(basis="fixed_amount", global_value=50_000_000, per_key_values=None, **PROVENANCE)
        result = compute_lender_gdv(base_inputs(lv))
        assert result.lender_gdv_pence == 50_000_000
        assert result.unit_values_pence == []

    def test_fixed_amount_raises_when_global_value_is_none(self):
        lv = LenderValuation(basis="fixed_amount", global_value=None, per_key_values=None, **PROVENANCE)
        with pytest.raises(ValueError, match="requires a global_value"):
            compute_lender_gdv(base_inputs(lv))

    def test_global_pct_raises_when_global_value_is_none(self):
        lv = LenderValuation(basis="global_pct", global_value=None, per_key_values=None, **PROVENANCE)
        with pytest.raises(ValueError, match="requires a global_value"):
            compute_lender_gdv(base_inputs(lv))

    def test_raises_when_a_computed_unit_value_is_not_positive(self):
        lv = LenderValuation(basis="global_pct", global_value=-100, per_key_values=None, **PROVENANCE)
        with pytest.raises(ValueError, match="must be positive"):
            compute_lender_gdv(base_inputs(lv))

    def test_raises_when_the_fixed_amount_total_is_not_positive(self):
        lv = LenderValuation(basis="fixed_amount", global_value=0, per_key_values=None, **PROVENANCE)
        with pytest.raises(ValueError, match="Lender GDV must be a positive value"):
            compute_lender_gdv(base_inputs(lv))

    def test_fixed_amount_does_not_truncate_fractional_pence(self):
        """Task-3-review IMPORTANT fix: compute_lender_gdv used to silently
        truncate fractional pence via int() on the fixed_amount/per_unit paths
        -- a genuine cross-language divergence from lender-valuation.ts, which
        never truncates. Fractional pence is rejected by validate_inputs, not
        this function (the whole-number rule lives in exactly one place)."""
        lv = LenderValuation(basis="fixed_amount", global_value=50_000_000.5, per_key_values=None, **PROVENANCE)
        result = compute_lender_gdv(base_inputs(lv))
        assert result.lender_gdv_pence == 50_000_000.5

    def test_per_unit_does_not_truncate_fractional_pence(self):
        """Task-3-review IMPORTANT fix (see above), per_unit path."""
        lv = LenderValuation(
            basis="per_unit", global_value=None,
            per_key_values={"u1": 9_500_000.5, "u2": 14_000_000}, **PROVENANCE,
        )
        result = compute_lender_gdv(base_inputs(lv))
        assert result.unit_values_pence == [9_500_000.5, 14_000_000]
        assert result.lender_gdv_pence == 23_500_000.5


class TestRunAppraisalContainsAnInvalidLenderValuation:
    """Task-3-review CRITICAL fix: an invalid-but-present lender_valuation block
    must never crash the pipeline. compute_lender_gdv raises for these three
    cases (see TestComputeLenderGdv above); run_appraisal must contain that
    raise, not propagate it, and validation must independently flag the same
    condition as a hard error."""

    @pytest.mark.parametrize(
        ("lv_kwargs", "message_contains"),
        [
            pytest.param(
                {"basis": "fixed_amount", "global_value": None, "per_key_values": None},
                "requires a global_value",
                id="missing-global-value",
            ),
            pytest.param(
                {"basis": "per_unit", "global_value": None, "per_key_values": {"u1": 9_500_000}},
                'missing a value for unit "u2"',
                id="missing-per-unit-id",
            ),
            pytest.param(
                {"basis": "global_pct", "global_value": -100, "per_key_values": None},
                "must be positive",
                id="non-positive-computed-value",
            ),
        ],
    )
    def test_does_not_raise_lender_metrics_are_none_and_a_hard_issue_is_present(
        self, lv_kwargs, message_contains,
    ):
        lv = LenderValuation(**lv_kwargs, **PROVENANCE)
        inputs = base_inputs(lv)
        run = run_appraisal(inputs)  # must not raise
        assert run.metrics.lender_gdv_pence is None
        assert run.metrics.lender_gdv_variance_pence is None
        assert run.metrics.lender_gdv_variance_pct is None
        assert run.metrics.ltgdv_lender_pct is None
        assert any(
            i.severity == "error" and i.field == "lender_valuation" and message_contains in i.message
            for i in run.validation
        ), run.validation


def _v6_inputs_with_balcony(balcony_terrace_sqm: float) -> CalculatorInputsV6:
    inputs = migrate_inputs_to_v6({}, {"id": "p", "price_pence": 0, "floor_area_sqm": 0})
    inputs.lender_valuation = LenderValuation(
        basis="global_per_sqft", global_value=40_000, per_key_values=None,
        reason="r", author="a", date="2026-08-18",
    )
    inputs.unit_mix = UnitMixInputsV6(units=[ProposedUnitV6(
        id="u1", type="1bed", floor_area_sqm=50, estimated_value_pence=10_000_000, comparable_notes="",
        ancillary=UnitAncillary(
            balcony_terrace_sqm=balcony_terrace_sqm, balcony_terrace_value_pence=0,
            parking_spaces=0, parking_value_pence=0,
        ),
    )])
    return inputs


class TestGlobalPerSqftIsBoundToInternalNia:
    """R9 (Task 7 -- Defect 1): a v6 unit now carries an internal area
    (floor_area_sqm) AND a separate balcony/terrace area
    (ancillary.balcony_terrace_sqm). Spec Sec 3.2's "pence per sq ft applied
    to every unit's area" is ambiguous once a unit has two areas, and the
    ambiguity silently moves lender GDV. This pins the basis to internal NIA
    only, so a future change that folds balcony area into the per-sq-ft
    calculation is caught here rather than discovered in a live valuation."""

    def test_ignores_balcony_and_terrace_area_when_applying_a_per_sqft_rate(self):
        with_balcony = compute_lender_gdv(_v6_inputs_with_balcony(20))
        without_balcony = compute_lender_gdv(_v6_inputs_with_balcony(0))
        assert with_balcony.lender_gdv_pence == without_balcony.lender_gdv_pence
        # 40,000p/sq ft x 50 m^2 x 10.7639
        assert with_balcony.lender_gdv_pence == 21_527_800
