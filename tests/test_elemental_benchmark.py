"""R17 spec Sec 27. Python twin of elemental-benchmark.test.ts, case for case:
the element catalogue, fixture AB's hand-derived figures (test-cases.md Sec
27), unit invariance, the degrade paths and the warning table. The advisory
proof is the identity of every ledger figure with the block removed."""
from __future__ import annotations

import math
from dataclasses import asdict

import pytest

from app.financial_model import run_appraisal
from app.financial_model.area_units import SQFT_PER_SQM
from app.financial_model.elemental_benchmark import (
    BENCHMARK_LIMITATION_SENTENCE,
    CORE_ELEMENT_COUNT,
    DEFAULT_THRESHOLDS,
    ELEMENT_CATALOGUE,
    ELEMENT_CODES,
    NO_LOCATION_SENTENCE,
    PROVIDER_LABEL,
    QUANTITY_UNIT_FOR_BASIS,
    UNITS_FOR_BASIS,
    benchmark_content_hash,
    benchmark_flags,
    compute_elemental_benchmark,
    normalised_set,
)
from app.financial_model.types import CalculatorInputsV17
from tests.fixtures_elemental_benchmark import doc_ab, doc_ab_with, doc_ab_without_benchmark, raw_ab

AB_CONTENT_HASH = "087c57e76aeb98e5814faf68991481d579a28ad4c650c186f4d38acd9e3d6baf"


def result_of(doc: CalculatorInputsV17 | None = None):
    r = run_appraisal(doc if doc is not None else doc_ab()).metrics.elemental_benchmark
    assert r is not None
    return r


def by_code(result):
    return {row.element_code: row for row in result.rows}


def codes(result):
    return [w.code for w in result.warnings]


# --- the catalogue ----------------------------------------------------------


def test_catalogue_has_thirty_nine_fixed_codes_in_spec_order():
    assert len(ELEMENT_CATALOGUE) == 39
    assert ELEMENT_CODES[0] == "facilitating_works"
    assert ELEMENT_CODES[38] == "other_conversion_works"
    assert len(set(ELEMENT_CODES)) == 39
    assert [e.code for e in ELEMENT_CATALOGUE if e.default_basis == "percentage"] == [
        "builders_work_in_connection", "preliminaries", "main_contractor_ohp",
        "design_development_allowance", "risk_allowances",
    ]
    assert CORE_ELEMENT_COUNT == 34


def test_catalogue_mirrors_the_typescript_catalogue_literally():
    """The TS catalogue is the normative order; both engines must carry the same
    39 (code, label, basis, package) rows or fixture AB's row order drifts."""
    from pathlib import Path
    import re

    ts = (Path(__file__).resolve().parents[1] / "frontend/src/lib/model/elemental-benchmark.ts").read_text(encoding="utf-8")
    rows = re.findall(
        r"\{ code: '([a-z_]+)', label: (?:'([^']*)'|\"([^\"]*)\"), default_basis: '([a-z_]+)', default_package: '([a-z_]+)' \}", ts,
    )
    assert len(rows) == 39
    for (code, label1, label2, basis, package), entry in zip(rows, ELEMENT_CATALOGUE):
        assert entry.code == code
        assert entry.label == (label1 or label2)
        assert entry.default_basis == basis
        assert entry.default_package == package


def test_basis_units_and_labels():
    assert UNITS_FOR_BASIS["area"] == ("gbp_per_sqm", "gbp_per_sqft")
    assert UNITS_FOR_BASIS["percentage"] == ("pct",)
    assert QUANTITY_UNIT_FOR_BASIS["area"] == "sqm"
    assert QUANTITY_UNIT_FOR_BASIS["lump_sum"] == "each"
    assert PROVIDER_LABEL["bcis_licensed"] == "User-supplied BCIS licensed benchmark"
    assert "BCIS" not in PROVIDER_LABEL["public_benchmark"]
    assert "BCIS" not in PROVIDER_LABEL["user_qs"]
    assert "not a substitute for project-specific QS advice" in BENCHMARK_LIMITATION_SENTENCE
    assert NO_LOCATION_SENTENCE == "No evidenced location adjustment applied."


# --- fixture AB -------------------------------------------------------------


def test_ab_currentises_by_the_index_ratio_and_the_location_multiplier():
    r = result_of()
    assert math.isclose(r.currentisation_factor, 1.05, rel_tol=0, abs_tol=1e-12)
    assert r.currentisation_method == "index_ratio"
    assert math.isclose(r.location_multiplier, 0.95, abs_tol=1e-12)
    assert r.location_evidenced is True
    assert r.provider_label == "User/QS benchmark"
    assert r.area_sqm == 600
    assert r.cost_plan_mode == "detailed"


def test_ab_prices_every_row_with_one_rounding():
    r = result_of()
    rows = by_code(r)
    assert math.isclose(rows["strip_out"].currentised_rate_pence_per_sqm, 7980, abs_tol=1e-9)
    assert rows["strip_out"].benchmark_amount_pence == 4_788_000
    frame = rows["frame_alterations"]
    assert frame.original_unit == "gbp_per_sqft"
    assert math.isclose(frame.canonical_rate_pence_per_sqm, 2500 * SQFT_PER_SQM, abs_tol=1e-9)
    assert frame.benchmark_amount_pence == 16_105_501
    facade = rows["external_walls_facade"]
    assert facade.adjustment_pct == -10
    assert math.isclose(facade.adjusted_rate_pence_per_sqm, 22_443.75, abs_tol=1e-9)
    assert facade.benchmark_amount_pence == 13_466_250
    assert rows["mechanical_services"].benchmark_amount_pence == 10_773_000
    assert rows["kitchens"].benchmark_amount_pence == 3_192_000
    assert rows["kitchens"].canonical_rate_pence_per_sqm is None
    assert rows["external_works"].benchmark_amount_pence == 4_987_500
    assert r.totals.elemental_subtotal_pence == 53_312_251
    assert rows["preliminaries"].benchmark_amount_pence == 6_397_470
    assert r.totals.benchmark_base_construction_pence == 59_709_721


def test_ab_compares_against_the_plan_without_moving_it():
    r = result_of()
    t = r.totals
    assert t.qs_base_construction_pence == 69_192_000
    assert t.difference_pence == -9_482_279
    assert t.difference_pct == -13.7
    assert t.benchmark_rate_pence_per_sqm == 99_516
    assert t.qs_rate_pence_per_sqm == 115_320
    assert t.mapped_qs_amount_pence == 69_192_000
    assert t.unmapped_qs_amount_pence == 0
    assert t.unpriced_elements == 0
    assert t.elements_without_evidence == 2
    assert t.elements_outside_range == 1
    assert t.coverage_pct == 17.65
    assert r.enters_tdc is False


def test_ab_reads_the_forward_factor_off_the_mapped_package():
    kitchens = by_code(result_of())["kitchens"]
    assert math.isclose(kitchens.forward_inflation_factor, 1.06 ** (12.5 / 12), abs_tol=1e-12)
    assert kitchens.forward_inflated_benchmark_amount_pence == 3_391_745
    assert kitchens.benchmark_amount_pence == 3_192_000
    assert kitchens.qs_amount_pence == 3_192_000
    assert kitchens.variance_pence == 0


def test_ab_raises_exactly_three_warnings():
    r = result_of()
    assert codes(r) == ["incomplete_coverage", "material_variance", "source_unverified"]
    assert next(w for w in r.warnings if w.code == "material_variance").severity == "red"
    assert r.thresholds["material_variance_pct"] == 10
    flags = benchmark_flags(r)
    assert [f.code for f in flags] == ["benchmark_warning", "benchmark_material_variance", "benchmark_warning"]
    assert flags[1].amount_pence == -9_482_279
    run = run_appraisal(doc_ab())
    assert sum(1 for f in run.metrics.flags if f.code == "benchmark_material_variance") == 1


def test_the_advisory_proof_every_ledger_figure_is_identical_with_the_block_removed():
    with_block = run_appraisal(doc_ab())
    without = run_appraisal(doc_ab_without_benchmark())
    assert without.metrics.elemental_benchmark is None
    a = asdict(with_block.metrics)
    b = asdict(without.metrics)
    for k in ("elemental_benchmark", "flags"):
        a.pop(k)
        b.pop(k)
    assert a == b
    assert asdict(with_block.model) == asdict(without.model)
    assert asdict(with_block.schedule) == asdict(without.schedule)
    assert with_block.metrics.cost_plan.construction_total_pence == 69_192_000 + 4_321_187 + 3_459_600


def test_content_hash_parity_with_typescript():
    raw = raw_ab()["elemental_benchmark"]["set"]
    assert raw["content_hash"] == AB_CONTENT_HASH
    assert benchmark_content_hash(raw) == AB_CONTENT_HASH
    assert benchmark_content_hash(doc_ab().elemental_benchmark.set) == AB_CONTENT_HASH
    renamed = {**raw, "id": "other", "created_at": "later", "imported_by": "someone else"}
    assert benchmark_content_hash(renamed) == AB_CONTENT_HASH
    changed = {**raw, "rates": [
        {**r, "original_rate_pence": r["original_rate_pence"] + 1} if i == 0 else r for i, r in enumerate(raw["rates"])
    ]}
    assert benchmark_content_hash(changed) != AB_CONTENT_HASH
    assert "content_hash" not in normalised_set(raw)


# --- unit invariance ----------------------------------------------------------


def _area_doc(unit: str, pence: float):
    def mutate(b):
        b["set"]["rates"] = [{
            **b["set"]["rates"][0], "id": "r1", "element_code": "strip_out", "measurement_basis": "area",
            "original_unit": unit, "original_rate_pence": pence, "lower_quartile_rate_pence": None,
            "median_rate_pence": None, "upper_quartile_rate_pence": None, "sample_count": None,
        }]
        b["set"]["base_index_value"] = None
        b["set"]["current_index_value"] = None
        b["set"]["location_factor"] = None
        b["selections"] = [{
            **b["selections"][0], "element_code": "strip_out", "benchmark_rate_id": "r1",
            "quantity": 620, "quantity_unit": "sqm", "target_cost_package_id": None,
        }]
        b["applications"] = []
    return doc_ab_with(mutate)


def test_620_sqm_at_1250_per_sqm_is_775000_and_the_same_rate_per_sqft_prices_identically():
    metric = result_of(_area_doc("gbp_per_sqm", 125_000))
    assert metric.rows[0].benchmark_amount_pence == 77_500_000
    # The pence-per-ft² rate is not an integer (11,612.88…); the pydantic
    # model's `original_rate_pence: int` refuses a float at the boundary, so
    # this engine's ft² arm is exercised on the nearest whole-pence rate and
    # the amount is checked against the hand figure for that rate:
    # 11,613 p/ft² × 10.7639104167097 = 125,001.29… p/m² × 620 = 77,500,800.8… → 77,500,801.
    imperial = result_of(_area_doc("gbp_per_sqft", 11_613))
    assert math.isclose(imperial.rows[0].canonical_rate_pence_per_sqm, 11_613 * SQFT_PER_SQM, abs_tol=1e-6)
    assert imperial.rows[0].benchmark_amount_pence == 77_500_801


def test_per_unit_lump_sum_and_percentage_rows_carry_no_area():
    rows = by_code(result_of())
    for code in ("kitchens", "external_works", "preliminaries"):
        assert rows[code].canonical_rate_pence_per_sqm is None
        assert rows[code].currentised_rate_pence_per_sqm is None


# --- degrade and warning paths ------------------------------------------------


def test_missing_index_means_no_factor_and_the_not_currentised_warning():
    no_base = result_of(doc_ab_with(lambda b: b["set"].__setitem__("base_index_value", None)))
    assert no_base.currentisation_factor is None
    assert no_base.currentisation_method == "none"
    assert "rates_not_currentised" in codes(no_base)
    assert no_base.rows[0].benchmark_amount_pence == 4_560_000
    no_current = result_of(doc_ab_with(lambda b: b["set"].__setitem__("current_index_value", None)))
    assert no_current.currentisation_method == "none"


@pytest.mark.parametrize("bad", [0, -1])
def test_zero_or_negative_index_degrades_without_raising(bad):
    r = result_of(doc_ab_with(lambda b: b["set"].__setitem__("base_index_value", bad)))
    assert r.currentisation_factor is None
    assert r.currentisation_method == "none"


def test_null_location_factor_multiplies_by_one_and_says_so():
    r = result_of(doc_ab_with(lambda b: b["set"].__setitem__("location_factor", None)))
    assert r.location_multiplier == 1
    assert r.location_evidenced is False
    assert next(w for w in r.warnings if w.code == "no_location_evidence").message == NO_LOCATION_SENTENCE
    assert r.rows[0].benchmark_amount_pence == 5_040_000


def test_per_rate_location_factor_overrides_the_set():
    r = result_of(doc_ab_with(lambda b: b["set"]["rates"][0].__setitem__("location_factor", 110)))
    assert r.rows[0].benchmark_amount_pence == 5_544_000
    assert math.isclose(r.location_multiplier, 0.95, abs_tol=1e-12)


def test_staleness_is_measured_on_the_document_and_twelve_months_is_not_stale():
    assert "benchmark_stale" not in codes(result_of())
    stale = result_of(doc_ab_with(lambda b: b["set"].__setitem__("base_date", "2025-05-01")))
    assert "13 months before 2026-06-01" in next(w for w in stale.warnings if w.code == "benchmark_stale").message

    def no_currentisation(b):
        b["set"]["currentisation_date"] = None
        b["set"]["base_index_value"] = None
    assert "benchmark_stale" in codes(result_of(doc_ab_with(no_currentisation)))
    raw = raw_ab()
    raw["elemental_benchmark"]["set"]["currentisation_date"] = None
    raw["acquisition"]["acquisition_date"] = None
    from app.financial_model.migrate import migrate_inputs_to_v17
    assert "benchmark_age_unknown" in codes(result_of(migrate_inputs_to_v17(raw)))


def test_project_type_warnings():
    nb = result_of(doc_ab_with(lambda b: b["set"].__setitem__("project_type", "new_build")))
    assert {"project_type_mismatch", "new_build_benchmark_on_conversion"} <= set(codes(nb))
    refurb = result_of(doc_ab_with(lambda b: b["set"].__setitem__("project_type", "refurbishment")))
    assert "project_type_mismatch" in codes(refurb)
    assert "new_build_benchmark_on_conversion" not in codes(refurb)


def test_missing_source_fires_per_provider_tier():
    def public(b):
        b["set"]["provider_type"] = "public_benchmark"
        b["set"]["source_url"] = None
    pub = result_of(doc_ab_with(public))
    assert "missing_source" in codes(pub)
    assert pub.provider_label == "Public benchmark"

    def licensed(b):
        b["set"]["provider_type"] = "bcis_licensed"
        b["set"]["licence_or_permission"] = ""
    lic = result_of(doc_ab_with(licensed))
    assert "missing_source" in codes(lic)
    assert lic.provider_label == "User-supplied BCIS licensed benchmark"
    assert "missing_source" not in codes(result_of())


def test_unpriced_selection_and_zero_quantity_are_counted():
    def mutate(b):
        b["selections"][0]["benchmark_rate_id"] = None
        b["selections"][1]["quantity"] = 0
    r = result_of(doc_ab_with(mutate))
    assert r.totals.unpriced_elements == 2
    assert "unpriced_elements" in codes(r)
    assert r.rows[0].benchmark_amount_pence == 0
    assert r.rows[1].benchmark_amount_pence == 0


def test_the_material_threshold_is_the_documents():
    r = result_of(doc_ab_with(lambda b: b["thresholds"].__setitem__("material_variance_pct", 15)))
    assert "material_variance" not in codes(r)
    assert r.totals.difference_pct == -13.7


def test_applied_without_currentisation_fires_from_the_package_origin():
    raw = raw_ab()
    for p in raw["cost_plan"]["packages"]:
        if p["id"] == "pkg-bm-kitchens":
            p["benchmark_origin"]["currentisation_method"] = "none"
    from app.financial_model.migrate import migrate_inputs_to_v17
    assert "applied_without_currentisation" in codes(result_of(migrate_inputs_to_v17(raw)))
    assert "applied_without_currentisation" not in codes(result_of())


def test_headline_mode_compares_the_total_only():
    raw = raw_ab()
    raw["cost_plan"]["mode"] = "headline"
    raw["cost_plan"]["packages"] = []
    raw["cost_plan"]["qs"] = None
    raw["conversion_costs"]["construction_cost_per_sqm_pence"] = 110_000
    for s in raw["elemental_benchmark"]["selections"]:
        s["target_cost_package_id"] = None
    raw["elemental_benchmark"]["applications"] = []
    from app.financial_model.migrate import migrate_inputs_to_v17
    r = result_of(migrate_inputs_to_v17(raw))
    assert r.cost_plan_mode == "headline"
    assert r.totals.qs_base_construction_pence == 66_000_000
    assert all(row.qs_amount_pence is None and row.variance_pence is None for row in r.rows)
    assert r.totals.mapped_qs_amount_pence == 0
    assert r.totals.benchmark_base_construction_pence == 59_709_721


def test_null_block_gives_null_result_and_no_flags():
    doc = doc_ab_without_benchmark()
    assert run_appraisal(doc).metrics.elemental_benchmark is None
    assert benchmark_flags(None) == []
    assert compute_elemental_benchmark(doc, run_appraisal(doc).metrics.cost_plan, 600) is None


def test_defaults_are_the_specs():
    assert DEFAULT_THRESHOLDS == {"material_variance_pct": 15.0, "stale_after_months": 12, "min_coverage_pct": 60.0}
    r = result_of(doc_ab_with(lambda b: b.__setitem__("selections", [])))
    assert r.rows == []
    assert r.totals.coverage_pct == 0
    assert r.totals.benchmark_base_construction_pence == 0
