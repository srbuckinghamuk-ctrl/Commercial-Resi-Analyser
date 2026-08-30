"""Mirror of frontend/src/lib/model/elemental-benchmark.ts (R17, spec Sec 27).

The elemental cost benchmark layer: a versioned benchmark set embedded in the
document, per-element selections, index-ratio currentisation with an
evidenced location multiplier, and a comparison against the cost plan that is
ADVISORY -- nothing computed here enters construction_total_pence, TDC, peak
debt or profit (Sec 27.4; `enters_tdc` is a pinned literal False).

The pydantic INPUT models live in types.py (the cost-plan split). This module
holds the catalogue, the result dataclasses, the engine, the warnings and the
content hash. Same function order as the TS module.
"""
from __future__ import annotations

import json
import hashlib
import math
from dataclasses import dataclass, field
from typing import Any

from .area_units import SQFT_PER_SQM
from .cost_plan import CostPlanResult
from .engine import ModelFlag, money_round, pct

PROVIDER_TYPES = ("bcis_licensed", "public_benchmark", "user_qs")

# Sec 27.4 / design Sec 12. The heading word the report may use. Never "BCIS"
# unless the provider is the licensed tier -- and then always qualified.
PROVIDER_LABEL = {
    "bcis_licensed": "User-supplied BCIS licensed benchmark",
    "public_benchmark": "Public benchmark",
    "user_qs": "User/QS benchmark",
}

BENCHMARK_PROJECT_TYPES = ("new_build", "refurbishment", "conversion")
MEASUREMENT_BASES = ("area", "per_unit", "per_item", "percentage", "lump_sum")
ORIGINAL_UNITS = ("gbp_per_sqm", "gbp_per_sqft", "gbp_per_unit", "gbp_per_item", "pct", "gbp")

# Sec 27.5 rule 3: the units a basis admits.
UNITS_FOR_BASIS = {
    "area": ("gbp_per_sqm", "gbp_per_sqft"),
    "per_unit": ("gbp_per_unit",),
    "per_item": ("gbp_per_item",),
    "percentage": ("pct",),
    "lump_sum": ("gbp",),
}
# Sec 27.5 rule 9: the quantity unit a basis requires.
QUANTITY_UNIT_FOR_BASIS = {
    "area": "sqm", "per_unit": "unit", "per_item": "item", "percentage": "pct_base", "lump_sum": "each",
}
RATE_EVIDENCE_STATUSES = ("verified", "unverified", "draft", "estimated")


@dataclass(frozen=True)
class ElementCatalogueEntry:
    code: str
    label: str
    default_basis: str
    default_package: str


# Sec 27.1 (design Sec 4.2). Thirty-nine conversion elements, fixed order --
# byte-identical to ELEMENT_CATALOGUE in elemental-benchmark.ts.
ELEMENT_CATALOGUE: tuple[ElementCatalogueEntry, ...] = (
    ElementCatalogueEntry("facilitating_works", "Facilitating works", "lump_sum", "enabling_strip_out_asbestos"),
    ElementCatalogueEntry("surveys_investigations", "Surveys and investigations", "lump_sum", "enabling_strip_out_asbestos"),
    ElementCatalogueEntry("strip_out", "Strip-out", "area", "enabling_strip_out_asbestos"),
    ElementCatalogueEntry("demolition", "Demolition", "area", "enabling_strip_out_asbestos"),
    ElementCatalogueEntry("asbestos_removal", "Asbestos removal", "lump_sum", "enabling_strip_out_asbestos"),
    ElementCatalogueEntry("substructure_alterations", "Substructure alterations", "area", "structure"),
    ElementCatalogueEntry("frame_alterations", "Structural frame alterations", "area", "structure"),
    ElementCatalogueEntry("upper_floors_strengthening", "Upper floors and structural strengthening", "area", "structure"),
    ElementCatalogueEntry("roof_works", "Roof works", "area", "roof_windows"),
    ElementCatalogueEntry("stairs_ramps", "Stairs and ramps", "per_item", "structure"),
    ElementCatalogueEntry("external_walls_facade", "External walls and façade", "area", "envelope"),
    ElementCatalogueEntry("windows_external_doors", "Windows and external doors", "area", "roof_windows"),
    ElementCatalogueEntry("internal_walls_partitions", "Internal walls and partitions", "area", "partitions"),
    ElementCatalogueEntry("internal_doors", "Internal doors", "per_item", "partitions"),
    ElementCatalogueEntry("wall_finishes", "Wall finishes", "area", "finishes"),
    ElementCatalogueEntry("floor_finishes", "Floor finishes", "area", "finishes"),
    ElementCatalogueEntry("ceiling_finishes", "Ceiling finishes", "area", "finishes"),
    ElementCatalogueEntry("ffe", "Fittings, furnishings and equipment", "per_unit", "finishes"),
    ElementCatalogueEntry("kitchens", "Kitchens", "per_unit", "finishes"),
    ElementCatalogueEntry("bathrooms", "Bathrooms", "per_unit", "finishes"),
    ElementCatalogueEntry("sanitary_installations", "Sanitary installations", "per_unit", "mech_elec_public_health"),
    ElementCatalogueEntry("mechanical_services", "Mechanical services", "area", "mech_elec_public_health"),
    ElementCatalogueEntry("electrical_services", "Electrical services", "area", "mech_elec_public_health"),
    ElementCatalogueEntry("fire_alarm_life_safety", "Fire alarm and life-safety systems", "area", "fire_acoustic_thermal"),
    ElementCatalogueEntry("sprinklers", "Sprinklers", "area", "fire_acoustic_thermal"),
    ElementCatalogueEntry("smoke_ventilation", "Smoke ventilation", "lump_sum", "fire_acoustic_thermal"),
    ElementCatalogueEntry("acoustic_upgrades", "Acoustic upgrades", "area", "fire_acoustic_thermal"),
    ElementCatalogueEntry("thermal_part_l_upgrades", "Thermal and Part L upgrades", "area", "fire_acoustic_thermal"),
    ElementCatalogueEntry("drainage_alterations", "Drainage alterations", "lump_sum", "drainage_utilities"),
    ElementCatalogueEntry("incoming_utility_upgrades", "Incoming utility upgrades", "lump_sum", "drainage_utilities"),
    ElementCatalogueEntry("lifts", "Lifts", "per_item", "lift"),
    ElementCatalogueEntry("builders_work_in_connection", "Builders' work in connection", "percentage", "other"),
    ElementCatalogueEntry("preliminaries", "Preliminaries", "percentage", "other"),
    ElementCatalogueEntry("main_contractor_ohp", "Main contractor overhead and profit", "percentage", "other"),
    ElementCatalogueEntry("design_development_allowance", "Design-development allowance", "percentage", "other"),
    ElementCatalogueEntry("external_works", "External works", "area", "externals"),
    ElementCatalogueEntry("landscaping", "Landscaping", "area", "externals"),
    ElementCatalogueEntry("risk_allowances", "Risk allowances", "percentage", "other"),
    ElementCatalogueEntry("other_conversion_works", "Other conversion works", "lump_sum", "other"),
)
ELEMENT_CODES: tuple[str, ...] = tuple(e.code for e in ELEMENT_CATALOGUE)
ELEMENT_BY_CODE = {e.code: e for e in ELEMENT_CATALOGUE}
_ELEMENT_ORDER = {code: i for i, code in enumerate(ELEMENT_CODES)}
# The coverage denominator (Sec 27.5 incomplete_coverage): every non-percentage element.
CORE_ELEMENT_COUNT = sum(1 for e in ELEMENT_CATALOGUE if e.default_basis != "percentage")

DEFAULT_THRESHOLDS = {"material_variance_pct": 15.0, "stale_after_months": 12, "min_coverage_pct": 60.0}

BENCHMARK_LIMITATION_SENTENCE = (
    "Benchmark rates are an initial reasonableness check, not a substitute for project-specific "
    "QS advice, surveys, design development, contractor pricing or lender monitoring."
)
NO_LOCATION_SENTENCE = "No evidenced location adjustment applied."


@dataclass
class BenchmarkWarning:
    code: str
    severity: str  # 'red' | 'amber'
    message: str


@dataclass
class ElementalBenchmarkRow:
    """Mirrors ElementalBenchmarkRow in elemental-benchmark.ts, field for field and in order."""

    element_code: str
    element_label: str
    measurement_basis: str
    original_unit: str
    benchmark_rate_id: str | None
    quantity: float
    quantity_unit: str
    original_rate_pence: int
    rate_pct: float | None
    canonical_rate_pence_per_sqm: float | None
    currentised_rate_pence_per_sqm: float | None
    adjustment_pct: float
    adjustment_reason: str
    adjusted_rate_pence_per_sqm: float | None
    currentised_rate_pence: float | None
    adjusted_rate_pence: float | None
    benchmark_amount_pence: int
    target_cost_package_id: str | None
    target_package_label: str | None
    qs_amount_pence: int | None
    variance_pence: int | None
    variance_pct: float | None
    forward_inflation_factor: float | None
    forward_inflated_benchmark_amount_pence: int | None
    lower_quartile_currentised_pence: float | None
    median_currentised_pence: float | None
    upper_quartile_currentised_pence: float | None
    sample_count: int | None
    evidence_status: str
    outside_range: bool | None
    source_reference: str


@dataclass
class ElementalBenchmarkTotals:
    benchmark_base_construction_pence: int
    elemental_subtotal_pence: int
    qs_base_construction_pence: int
    difference_pence: int
    difference_pct: float | None
    benchmark_rate_pence_per_sqm: int | None
    qs_rate_pence_per_sqm: int | None
    mapped_qs_amount_pence: int
    unmapped_qs_amount_pence: int
    unpriced_elements: int
    elements_without_evidence: int
    elements_outside_range: int
    coverage_pct: float | None


@dataclass
class ElementalBenchmarkResult:
    """Mirrors ElementalBenchmarkResult in elemental-benchmark.ts, field for field and in order."""

    provider_type: str
    provider_label: str
    set_id: str
    set_name: str
    dataset_version: str
    content_hash: str
    library_set_id: str | None
    building_function: str
    project_type: str
    specification_level: str
    region: str
    base_date: str
    currentisation_date: str | None
    base_index_name: str | None
    base_index_value: float | None
    current_index_name: str | None
    current_index_value: float | None
    index_dataset_version: str | None
    currentisation_factor: float | None
    currentisation_method: str
    location_factor: float | None
    location_multiplier: float
    location_evidenced: bool
    area_sqm: float
    cost_plan_mode: str
    rows: list[ElementalBenchmarkRow] = field(default_factory=list)
    totals: ElementalBenchmarkTotals | None = None
    warnings: list[BenchmarkWarning] = field(default_factory=list)
    thresholds: dict[str, Any] = field(default_factory=dict)
    enters_tdc: bool = False


def _positive_or_none(v: Any) -> float | None:
    """Sec 27.3. A finite, positive index value or None. Zero/negative is a
    validation error (Sec 27.5 rule 7); the engine degrades to no factor."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def _json_number(v: Any) -> Any:
    """Canonical-hash normalisation: an integral float renders as an int, the
    way JavaScript's JSON.stringify renders 1.0 as `1` (sha256.ts documents the
    asymmetry; this is the Python side's normalisation of it)."""
    if isinstance(v, bool):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: _json_number(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_json_number(x) for x in v]
    return v


def normalised_set(set_doc: dict[str, Any]) -> dict[str, Any]:
    """Port of normalisedSet: ONLY the ElementalBenchmarkSet / ElementalBenchmarkRate
    fields (a whitelist -- a server read-back carrying extra keys such as
    `position` or `set_id` must hash identically to the import document), with
    content_hash, id, created_at and imported_by removed; rates sorted by
    element_code then id."""
    from .types import ElementalBenchmarkSet  # lazy: types imports nothing from here

    doc = ElementalBenchmarkSet.model_validate(set_doc).model_dump(mode="json")
    rest = {k: v for k, v in doc.items() if k not in ("content_hash", "id", "created_at", "imported_by", "rates")}
    rates = sorted(doc.get("rates") or [], key=lambda r: (str(r.get("element_code")), str(r.get("id"))))
    return {**rest, "rates": rates}


def benchmark_content_hash(set_doc: dict[str, Any] | Any) -> str:
    """Sec 27.6. sha256 over the canonical JSON (sorted keys, no spaces,
    non-ASCII kept) of the normalised set. Both engines compute this; the
    server computes it on import."""
    doc = set_doc if isinstance(set_doc, dict) else set_doc.model_dump(mode="json")
    payload = _json_number(normalised_set(doc))
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def compute_elemental_benchmark(inputs: Any, cost_plan: CostPlanResult, area_sqm: float) -> ElementalBenchmarkResult | None:
    """Port of computeElementalBenchmark. None exactly when the input block is None."""
    block = getattr(inputs, "elemental_benchmark", None)
    if block is None:
        return None
    from .due_diligence import months_between  # lazy: due_diligence imports cost_plan (cycle guard, cost_plan.py's technique)

    bset = block.set
    thresholds = {**DEFAULT_THRESHOLDS, **block.thresholds.model_dump(mode="json")}

    base_index = _positive_or_none(bset.base_index_value)
    current_index = _positive_or_none(bset.current_index_value)
    factor_or_none = current_index / base_index if base_index is not None and current_index is not None else None
    method = "index_ratio" if factor_or_none is not None else "none"
    set_location = _positive_or_none(bset.location_factor)
    set_multiplier = set_location / 100 if set_location is not None else 1.0

    rate_by_id = {r.id: r for r in bset.rates}
    package_by_id = {p.id: p for p in cost_plan.packages}
    detailed = cost_plan.mode == "detailed"

    drafts: list[tuple[Any, Any, ElementalBenchmarkRow]] = []
    ordered = sorted(block.selections, key=lambda s: _ELEMENT_ORDER.get(s.element_code, len(ELEMENT_CODES)))
    for sel in ordered:
        rate = rate_by_id.get(sel.benchmark_rate_id) if sel.benchmark_rate_id is not None else None
        entry = ELEMENT_BY_CODE.get(sel.element_code)
        label = (rate.element_label if rate is not None and rate.element_label else None) or (entry.label if entry else sel.element_code)
        basis = rate.measurement_basis if rate is not None else (entry.default_basis if entry else "lump_sum")
        unit = rate.original_unit if rate is not None else UNITS_FOR_BASIS[basis][0]
        rate_location = _positive_or_none(rate.location_factor) if rate is not None else None
        multiplier = rate_location / 100 if rate_location is not None else set_multiplier
        factor = factor_or_none if factor_or_none is not None else 1.0

        canonical_per_sqm: float | None = None
        currentised_per_sqm: float | None = None
        adjusted_per_sqm: float | None = None
        currentised_rate: float | None = None
        adjusted_rate: float | None = None
        amount = 0
        adj = 1 + sel.adjustment_pct / 100
        if rate is not None and basis == "area":
            canonical_per_sqm = rate.original_rate_pence * SQFT_PER_SQM if unit == "gbp_per_sqft" else float(rate.original_rate_pence)
            currentised_per_sqm = canonical_per_sqm * factor * multiplier
            adjusted_per_sqm = currentised_per_sqm * adj
            amount = money_round(adjusted_per_sqm * sel.quantity)
        elif rate is not None and basis in ("per_unit", "per_item", "lump_sum"):
            currentised_rate = rate.original_rate_pence * factor * multiplier
            adjusted_rate = currentised_rate * adj
            qty = 1.0 if basis == "lump_sum" else sel.quantity
            amount = money_round(adjusted_rate * qty)

        def quartile(q: int | None) -> float | None:
            if q is None or rate is None or basis == "percentage":
                return None
            canonical = q * SQFT_PER_SQM if unit == "gbp_per_sqft" else float(q)
            return canonical * factor * multiplier

        lq = quartile(rate.lower_quartile_rate_pence if rate is not None else None)
        md = quartile(rate.median_rate_pence if rate is not None else None)
        uq = quartile(rate.upper_quartile_rate_pence if rate is not None else None)
        compare_rate = currentised_per_sqm if basis == "area" else currentised_rate
        outside_range = (
            (compare_rate < lq or compare_rate > uq)
            if lq is not None and uq is not None and compare_rate is not None
            else None
        )

        target = package_by_id.get(sel.target_cost_package_id) if detailed and sel.target_cost_package_id is not None else None
        drafts.append((sel, rate, ElementalBenchmarkRow(
            element_code=sel.element_code,
            element_label=label,
            measurement_basis=basis,
            original_unit=unit,
            benchmark_rate_id=rate.id if rate is not None else None,
            quantity=sel.quantity,
            quantity_unit=sel.quantity_unit,
            original_rate_pence=rate.original_rate_pence if rate is not None else 0,
            rate_pct=rate.rate_pct if rate is not None else None,
            canonical_rate_pence_per_sqm=canonical_per_sqm,
            currentised_rate_pence_per_sqm=currentised_per_sqm,
            adjustment_pct=sel.adjustment_pct,
            adjustment_reason=sel.adjustment_reason,
            adjusted_rate_pence_per_sqm=adjusted_per_sqm,
            currentised_rate_pence=currentised_rate,
            adjusted_rate_pence=adjusted_rate,
            benchmark_amount_pence=amount,
            target_cost_package_id=target.id if target is not None else None,
            target_package_label=target.label if target is not None else None,
            qs_amount_pence=target.amount_pence if target is not None else None,
            variance_pence=None,
            variance_pct=None,
            forward_inflation_factor=target.inflation_factor if target is not None else None,
            forward_inflated_benchmark_amount_pence=None,
            lower_quartile_currentised_pence=lq,
            median_currentised_pence=md,
            upper_quartile_currentised_pence=uq,
            sample_count=rate.sample_count if rate is not None else None,
            evidence_status=rate.evidence_status if rate is not None else "unverified",
            outside_range=outside_range,
            source_reference=rate.source_reference if rate is not None else "",
        )))

    subtotal = sum(row.benchmark_amount_pence for _, _, row in drafts if row.measurement_basis != "percentage")
    for sel, rate, row in drafts:
        if row.measurement_basis == "percentage" and rate is not None and rate.rate_pct is not None:
            adj = 1 + sel.adjustment_pct / 100
            row.benchmark_amount_pence = money_round(subtotal * (rate.rate_pct / 100) * adj)
        if row.qs_amount_pence is not None:
            row.variance_pence = row.benchmark_amount_pence - row.qs_amount_pence
            row.variance_pct = pct(row.variance_pence, row.qs_amount_pence)
        if row.forward_inflation_factor is not None:
            row.forward_inflated_benchmark_amount_pence = money_round(row.benchmark_amount_pence * row.forward_inflation_factor)
    rows = [row for _, _, row in drafts]

    benchmark_total = sum(r.benchmark_amount_pence for r in rows)
    qs_base = cost_plan.base_build_pence
    targeted = {r.target_cost_package_id for r in rows if r.target_cost_package_id is not None}
    mapped = sum(package_by_id[i].amount_pence for i in targeted if i in package_by_id)
    unpriced = sum(
        1 for sel, rate, row in drafts
        if rate is None or (row.measurement_basis not in ("percentage", "lump_sum") and sel.quantity <= 0)
    )
    without_evidence = sum(1 for _, rate, _ in drafts if rate is not None and rate.evidence_status != "verified")
    outside = sum(1 for r in rows if r.outside_range is True)
    priced_core = sum(
        1 for sel, rate, row in drafts
        if rate is not None and row.measurement_basis != "percentage"
        and (row.measurement_basis == "lump_sum" or sel.quantity > 0)
    )
    coverage = money_round(priced_core / CORE_ELEMENT_COUNT * 10000) / 100 if CORE_ELEMENT_COUNT > 0 else None

    totals = ElementalBenchmarkTotals(
        benchmark_base_construction_pence=benchmark_total,
        elemental_subtotal_pence=subtotal,
        qs_base_construction_pence=qs_base,
        difference_pence=benchmark_total - qs_base,
        difference_pct=pct(benchmark_total - qs_base, qs_base),
        benchmark_rate_pence_per_sqm=money_round(benchmark_total / area_sqm) if area_sqm > 0 else None,
        qs_rate_pence_per_sqm=cost_plan.implied_rate_pence_per_sqm,
        mapped_qs_amount_pence=mapped,
        unmapped_qs_amount_pence=qs_base - mapped,
        unpriced_elements=unpriced,
        elements_without_evidence=without_evidence,
        elements_outside_range=outside,
        coverage_pct=coverage,
    )

    acq_date = getattr(inputs.acquisition, "acquisition_date", None)
    warnings = _benchmark_warnings(
        block, bset, method, totals, thresholds, acq_date, [rate for _, rate, _ in drafts], cost_plan, months_between,
    )

    return ElementalBenchmarkResult(
        provider_type=bset.provider_type,
        provider_label=PROVIDER_LABEL[bset.provider_type],
        set_id=bset.id,
        set_name=bset.name,
        dataset_version=bset.dataset_version,
        content_hash=bset.content_hash,
        library_set_id=block.library_set_id,
        building_function=bset.building_function,
        project_type=bset.project_type,
        specification_level=bset.specification_level,
        region=bset.region,
        base_date=bset.base_date,
        currentisation_date=bset.currentisation_date,
        base_index_name=bset.base_index_name,
        base_index_value=bset.base_index_value,
        current_index_name=bset.current_index_name,
        current_index_value=bset.current_index_value,
        index_dataset_version=bset.index_dataset_version,
        currentisation_factor=factor_or_none,
        currentisation_method=method,
        location_factor=set_location,
        location_multiplier=set_multiplier,
        location_evidenced=set_location is not None,
        area_sqm=area_sqm,
        cost_plan_mode=cost_plan.mode,
        rows=rows,
        totals=totals,
        warnings=warnings,
        thresholds=thresholds,
        enters_tdc=False,
    )


def _blank(s: Any) -> bool:
    return s is None or str(s).strip() == ""


def _benchmark_warnings(
    block: Any, bset: Any, method: str, totals: ElementalBenchmarkTotals, thresholds: dict[str, Any],
    acquisition_date: str | None, rates: list[Any], cost_plan: CostPlanResult, months_between: Any,
) -> list[BenchmarkWarning]:
    """Port of benchmarkWarnings, message for message."""
    out: list[BenchmarkWarning] = []

    def amber(code: str, message: str) -> None:
        out.append(BenchmarkWarning(code=code, severity="amber", message=message))

    reference = bset.currentisation_date or acquisition_date
    base_date = bset.base_date if isinstance(bset.base_date, str) and bset.base_date.strip() != "" else None
    if base_date is None or reference is None:
        amber("benchmark_age_unknown", "Benchmark age cannot be measured: no currentisation date or acquisition date is recorded.")
    else:
        age = months_between(base_date, reference)
        if age > thresholds["stale_after_months"]:
            amber("benchmark_stale", (
                f"Benchmark base date {base_date} is {age} months before {reference} — over the "
                f"{thresholds['stale_after_months']}-month staleness threshold."
            ))
    if (
        _blank(bset.source_title)
        or (bset.provider_type == "public_benchmark" and _blank(bset.source_url))
        or (bset.provider_type == "bcis_licensed" and _blank(bset.licence_or_permission))
    ):
        amber("missing_source", "Benchmark source is incomplete: title, URL (public) or licence note (licensed) is missing.")
    if _positive_or_none(bset.location_factor) is None:
        amber("no_location_evidence", NO_LOCATION_SENTENCE)
    if bset.project_type != "conversion":
        amber("project_type_mismatch", f"Benchmark project type is {bset.project_type}; this appraisal is a conversion.")
    if bset.project_type == "new_build":
        amber("new_build_benchmark_on_conversion", "A conversion scheme is being benchmarked with new-build data; conversion works are not comparable.")
    if totals.coverage_pct is not None and totals.coverage_pct < thresholds["min_coverage_pct"]:
        amber("incomplete_coverage", (
            f"Only {_js_num(totals.coverage_pct)}% of the non-percentage elements are priced — below the "
            f"{_js_num(thresholds['min_coverage_pct'])}% coverage threshold."
        ))
    if totals.difference_pct is not None and abs(totals.difference_pct) > thresholds["material_variance_pct"]:
        out.append(BenchmarkWarning(
            code="material_variance", severity="red",
            message=(
                f"Benchmark base build differs from the QS/developer figure by {_js_num(totals.difference_pct)}% — "
                f"beyond the {_js_num(thresholds['material_variance_pct'])}% material-variance threshold."
            ),
        ))
    if method == "none" and base_date is not None and bset.currentisation_date is not None and bset.currentisation_date != base_date:
        amber("rates_not_currentised", (
            f"Rates are compared at their base date {base_date}: no index ratio is available to currentise "
            f"them to {bset.currentisation_date}."
        ))
    if any(r is not None and r.evidence_status in ("draft", "unverified") for r in rates):
        amber("source_unverified", "One or more selected rates are marked draft or unverified.")
    if totals.unpriced_elements > 0:
        amber("unpriced_elements", f"{totals.unpriced_elements} selected element(s) carry no rate or no quantity.")
    applied_without = any(
        (p.benchmark_origin or {}).get("currentisation_method") == "none" for p in cost_plan.packages
    ) or any(
        len(a.element_codes) > 0 and method == "none" and a.set_content_hash == bset.content_hash
        for a in block.applications
    )
    if applied_without:
        amber("applied_without_currentisation", "Benchmark rates were applied to the cost plan without currentisation.")
    return out


def _js_num(v: float) -> str:
    """JavaScript's template-literal rendering of a number: `15` for 15.0, `12.5` for 12.5."""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def benchmark_flags(result: ElementalBenchmarkResult | None) -> list[ModelFlag]:
    """Sec 27.5. Every warning surfaces as a flag. Mirrors benchmarkFlags."""
    if result is None:
        return []
    return [
        ModelFlag(
            code="benchmark_material_variance" if w.code == "material_variance" else "benchmark_warning",
            severity=w.severity,
            month=None,
            amount_pence=result.totals.difference_pence if (w.code == "material_variance" and result.totals is not None) else None,
            message=w.message,
        )
        for w in result.warnings
    ]
