"""Transliteration of frontend/src/lib/model/lender-valuation.test.ts. Both
implementations must agree with the hand-computed values (spec Sec 3.2), not
merely with each other. If Python disagrees with a fixture, the Python port
is wrong -- never adjust these numbers to make peace."""
import pytest

from app.financial_model.lender_valuation import SQFT_PER_SQM, compute_lender_gdv
from app.financial_model.migrate import default_calculator_inputs_v2, migrate_v2_to_v3
from app.financial_model.types import CalculatorInputsV3, LenderValuation, ProposedUnit

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
