"""Transliteration of frontend/src/lib/area-units.test.ts (R17, spec §27.2).

Same figures, ``math.isclose`` at the same precisions, plus the parity pin
that reads the TS source so the two ``SQFT_PER_SQM`` literals cannot drift.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

from app.financial_model.area_units import (
    AREA_UNITS,
    SQFT_PER_SQM,
    area_unit_label,
    display_area,
    entry_area_to_sqm,
    entry_rate_to_pence_per_sqm,
    rate_per_sqft_to_per_sqm,
    rate_per_sqm_to_per_sqft,
    rate_unit_label,
    sqft_to_sqm,
    sqm_to_sqft,
)
from app.financial_model import lender_valuation

REPO = Path(__file__).resolve().parent.parent
TS_MODULE = REPO / "frontend" / "src" / "lib" / "area-units.ts"


class TestConstant:
    def test_carries_the_exact_constant(self):
        assert math.isclose(SQFT_PER_SQM, 10.7639104167097, rel_tol=0, abs_tol=1e-13)
        assert AREA_UNITS == ("metric", "imperial")

    def test_ts_twin_carries_the_same_literal(self):
        source = TS_MODULE.read_text(encoding="utf-8")
        match = re.search(r"export const SQFT_PER_SQM = ([0-9.]+);", source)
        assert match is not None, "area-units.ts no longer declares SQFT_PER_SQM"
        assert match.group(1) == "10.7639104167097"
        assert float(match.group(1)) == SQFT_PER_SQM

    def test_lender_valuation_keeps_its_own_stored_convention(self):
        # Spec §27.9 limitation 6: a separate calculation input, not this constant.
        assert lender_valuation.SQFT_PER_SQM == 10.7639
        assert lender_valuation.SQFT_PER_SQM != SQFT_PER_SQM


class TestConversions:
    def test_620_sqm_is_6673_62445836_sqft(self):
        # 620 × 10.7639104167097 = 6,673.6244583600…; spec §27.2's "6,673.62445835…"
        # is that figure truncated, not rounded, so the 8-dp pin is …836.
        assert math.isclose(sqm_to_sqft(620), 6673.62445836, rel_tol=0, abs_tol=5e-9)

    def test_1_sqft_is_0_09290304_sqm(self):
        assert math.isclose(sqft_to_sqm(1), 0.09290304, rel_tol=0, abs_tol=5e-9)

    def test_125000_p_per_sqm_is_11612_88_p_per_sqft(self):
        # 125,000 / 10.7639104167097 = 11,612.880000000023 (spec §27.2's prose
        # prints "11,612.8125…", which is not this quotient; the constant rules).
        assert math.isclose(rate_per_sqm_to_per_sqft(125_000), 11612.88, rel_tol=0, abs_tol=5e-7)

    def test_the_product_is_the_same_in_either_unit_before_the_one_rounding(self):
        metric = 620 * 125_000
        imperial = sqm_to_sqft(620) * rate_per_sqm_to_per_sqft(125_000)
        assert abs(imperial - metric) < 1e-6
        assert math.floor(imperial + 0.5) == 77_500_000 == math.floor(metric + 0.5)

    def test_rate_round_trips_both_directions_within_1e_9_relative(self):
        for rate in (125_000, 1, 0.37, 98_765_432.1):
            assert math.isclose(rate_per_sqft_to_per_sqm(rate_per_sqm_to_per_sqft(rate)), rate, rel_tol=1e-9)
            assert math.isclose(rate_per_sqm_to_per_sqft(rate_per_sqft_to_per_sqm(rate)), rate, rel_tol=1e-9)
        for area in (620, 100, 0.5):
            assert math.isclose(sqft_to_sqm(sqm_to_sqft(area)), area, rel_tol=1e-9)

    def test_1000_alternating_display_conversions_never_touch_the_canonical(self):
        canonical = 620
        first_metric = display_area(canonical, "metric")
        first_imperial = display_area(canonical, "imperial")
        for i in range(1000):
            unit = "imperial" if i % 2 == 0 else "metric"
            shown = display_area(canonical, unit)
            expected = first_imperial if unit == "imperial" else first_metric
            assert math.isclose(shown, expected, rel_tol=0, abs_tol=1e-12)
        assert canonical == 620
        assert first_metric == 620  # metric display is the canonical itself
        assert math.isclose(first_imperial, 6673.62445836, rel_tol=0, abs_tol=5e-9)


class TestLabels:
    def test_labels(self):
        assert area_unit_label("metric") == "m²"
        assert area_unit_label("imperial") == "ft²"
        assert rate_unit_label("metric") == "£/m²"
        assert rate_unit_label("imperial") == "£/ft²"


class TestEntry:
    def test_imperial_area_is_stored_to_4dp_of_sqm_metric_untouched(self):
        # 1076.39 / 10.7639104167097 = 99.9999032256… → 99.9999 at the stated
        # entry precision (not 100.0000: 100 m² is 1,076.39104… ft²).
        assert math.isclose(entry_area_to_sqm(1076.39, "imperial"), 99.9999, rel_tol=0, abs_tol=1e-10)
        assert math.isclose(entry_area_to_sqm(1076.391, "imperial"), 100.0, rel_tol=0, abs_tol=1e-10)
        assert math.isclose(entry_area_to_sqm(SQFT_PER_SQM, "imperial"), 1.0, rel_tol=0, abs_tol=1e-10)
        assert math.floor(entry_area_to_sqm(1076.39, "imperial") * 1e4 + 0.5) == 999_999
        assert entry_area_to_sqm(620.123456, "metric") == 620.123456

    def test_imperial_rate_is_stored_unrounded_metric_untouched(self):
        assert entry_rate_to_pence_per_sqm(125_000, "metric") == 125_000
        assert math.isclose(entry_rate_to_pence_per_sqm(11612.88, "imperial"), 125_000, rel_tol=0, abs_tol=5e-7)
        assert math.isclose(entry_rate_to_pence_per_sqm(1, "imperial"), 10.7639104167097, rel_tol=0, abs_tol=1e-12)
