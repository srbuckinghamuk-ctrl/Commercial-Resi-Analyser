"""Transliteration of frontend/src/lib/model/package-timing.test.ts (R15b spec Sec 24.2)."""
import json
from pathlib import Path

import pytest

from app.financial_model.curves import curve_weights
from app.financial_model.migrate import migrate_inputs_to_v8, migrate_inputs_to_v13
from app.financial_model.package_timing import compute_package_timing
from app.financial_model.types import (
    Dependency,
    Phase,
    ProgrammeInputs,
    ProgrammePackage,
    ProgrammePackages,
    SimpleSpendCurve,
    parse_calculator_inputs,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _fixture(stem: str) -> dict:
    return json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))


def _raw(stem: str):
    """Parses a fixture's inputs at their OWN version -- no migration. Mirrors
    package-timing.test.ts's `raw()`."""
    return parse_calculator_inputs(_fixture(stem)["inputs"])


def _load(stem: str):
    """Migrates a fixture's inputs to v13. Mirrors package-timing.test.ts's
    `load()`; migrate_inputs_to_v13 already returns a validated model, so no
    separate parse_calculator_inputs step is needed."""
    return migrate_inputs_to_v13(_fixture(stem)["inputs"])


class TestComputePackageTiming:
    def test_network_tagged_package_takes_its_phase_window_untagged_the_category_default(self):
        # fixture S
        t = compute_package_timing(_load("s-dated-programme"))
        by_id = {x.id: x for x in t}

        enabling = by_id["pkg-enabling"]
        assert enabling.phase_id == "strip_out"
        assert enabling.start_month == 6
        assert enabling.finish_month == 8
        assert enabling.duration_months == 2
        assert enabling.midpoint_month == 6.5

        structure = by_id["pkg-structure"]
        assert structure.phase_id == "construction"
        assert structure.start_month == 8
        assert structure.finish_month == 14
        # Not a plain == 10.5: with equal 1/6 weights summed ascending
        # (s + w * (start + k), spec Sec 24.2's fixed order -- ties the TS and
        # Python doubles bit-for-bit), the accumulated 1/6 rounding error lands
        # one ULP below the mathematically-exact 10.5.
        assert structure.midpoint_month == pytest.approx(10.5, abs=1e-9)
        assert structure.weights == [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]

    def test_midpoint_is_curve_aware_back_loaded_3_month_phase_from_month_11_gives_74_over_6(self):
        doc = _load("s-dated-programme")
        doc.programme.phases.append(Phase(
            id="mande_fitout", code="other", label="M&E fit-out",
            duration_months=3, slip_months=0, start_offset=0,
            curve=SimpleSpendCurve(kind="back_loaded"),
            predecessors=[Dependency(phase_id="construction", type="SS", lag_months=3)],
        ))
        pkg = next(p for p in doc.cost_plan.packages if p.id == "pkg-mande")
        pkg.phase_id = "mande_fitout"

        m = next(x for x in compute_package_timing(doc) if x.id == "pkg-mande")
        assert m.phase_id == "mande_fitout"
        assert m.start_month == 11
        assert m.finish_month == 14
        assert m.midpoint_month == pytest.approx(74 / 6, abs=1e-10)
        assert m.midpoint_month != 12

    def test_auto_path_every_package_shares_sec6_construction_window(self):
        # fixture Q, term from the document
        doc = _load("q-detailed-cost-plan")
        term = max(1, int(doc.finance.term_months))
        t = compute_package_timing(doc)
        assert len(t) == len(doc.cost_plan.packages)
        for x in t:
            assert x.phase_id is None
            assert x.start_month == 1
            assert x.finish_month == 1 + max(1, term - 2)
        assert len({x.midpoint_month for x in t}) == 1

    def test_auto_path_term_1_month_0_one_month(self):
        doc = _load("q-detailed-cost-plan")
        doc.finance.term_months = 1
        first = compute_package_timing(doc)[0]
        assert first.start_month == 0
        assert first.finish_month == 1
        assert first.midpoint_month == 0

    def test_legacy_three_package_arm_raw_v8_shape_unreachable_from_a_stored_document(self):
        # Built by hand: a raw v8-shaped document (Q's cost plan, migrated to v8,
        # then given the legacy programme.packages shape a v9 migration would
        # have deleted) with programme.packages.construction { start_offset: 2,
        # duration_months: 4, curve: s_curve }.
        doc = migrate_inputs_to_v8(_fixture("q-detailed-cost-plan")["inputs"])
        doc.programme = ProgrammeInputs(
            anchor_month=None,
            packages=ProgrammePackages(
                construction=ProgrammePackage(
                    start_offset=2, duration_months=4, curve=SimpleSpendCurve(kind="s_curve"),
                ),
                professional=ProgrammePackage(
                    start_offset=0, duration_months=1, curve=SimpleSpendCurve(kind="straight_line"),
                ),
                statutory=ProgrammePackage(
                    start_offset=0, duration_months=1, curve=SimpleSpendCurve(kind="straight_line"),
                ),
            ),
        )

        t = compute_package_timing(doc)
        assert len(t) == len(doc.cost_plan.packages)
        assert len(t) > 0
        w = curve_weights(4, SimpleSpendCurve(kind="s_curve"))
        expected_midpoint = 0.0
        for k, wk in enumerate(w):
            expected_midpoint = expected_midpoint + wk * (2 + k)
        for x in t:
            assert x.phase_id is None
            assert x.start_month == 2
            assert x.finish_month == 6
            assert x.duration_months == 4
            assert x.curve == SimpleSpendCurve(kind="s_curve")
            assert x.midpoint_month == pytest.approx(expected_midpoint, abs=1e-10)

    def test_no_cost_plan_empty_headline_mode_with_no_packages_empty(self):
        # a-all-cash carries no `cost_plan` field at all (pre-v7, unmigrated).
        no_cost_plan = _raw("a-all-cash")
        assert compute_package_timing(no_cost_plan) == []
        # t-investment-case is headline mode: cost_plan exists but packages is empty.
        assert compute_package_timing(_load("t-investment-case")) == []
