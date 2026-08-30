"""Mirror of frontend/src/lib/model/cost-plan.ts's engine (R10, spec Sec 16).

The pydantic INPUT models live in types.py (see areas.py / AreaBridgeInputs for
the same split). This module holds the result dataclass and the one engine that
serves both cost-plan modes.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .engine import money_round, pct
from .package_timing import compute_package_timing


@dataclass
class CostPackageLine:
    id: str
    code: str
    label: str
    amount_pence: int
    contingency_class: str
    lender_eligible: bool
    # R12 spec Sec 18.5. Carried straight through from the input line so
    # schedule.py's resolved_phase_id() (Task 12) can read it without
    # re-deriving the cost plan a second time. None on every migrated row and
    # on every line the user has not re-tagged. Mirrors CostPackageLine in
    # cost-plan.ts.
    phase_id: str | None = None
    # R15b spec Sec 24.2/24.3. Fields appended, in order, from
    # package_timing.py's PackageTiming plus the per-package inflation
    # allowance. `resolved_phase_id` is the RESOLVED phase (network-aware);
    # `phase_id` above keeps its raw-input meaning. `months_from_base` and
    # `inflation_factor` are None when the QS has no base_date/allowance (or
    # acquisition_date is unknown); `inflation_pence` is 0 in that case, never
    # None -- it always enters the additive construction total.
    resolved_phase_id: str | None = None
    start_month: int = 0
    finish_month: int = 0
    midpoint_month: float = 0.0
    months_from_base: float | None = None
    inflation_factor: float | None = None
    inflation_pence: int = 0
    # R17 spec Sec 27.1. Carried straight through from the input line (the
    # phase_id treatment); None on every row the apply action did not create.
    # A dict (model_dump) so the result stays JSON-shaped like `qs` above.
    benchmark_origin: dict[str, Any] | None = None


@dataclass
class ContingencyLine:
    name: str
    pct: float
    basis: str
    base_pence: int
    amount_pence: int


@dataclass
class FeeLineResult:
    id: str
    code: str
    category: str
    label: str
    basis: str
    base_pence: int
    amount_pence: int
    # See the matching comment on CostPackageLine.phase_id above.
    phase_id: str | None = None


@dataclass
class PriceBasisSummary:
    """R15 spec Sec 23.6. Mirrors PriceBasisSummary in cost-plan.ts, field for
    field and in order. `amount_pence` of every package summed by its
    `price_basis` tag; a package with no tag (None -- the migration default)
    falls into `unclassified_pence`. The two coverage percentages are against
    `base_build_pence`, via the shared `pct` helper (2 dp, None when the
    denominator is 0)."""

    fixed_price_pence: int
    provisional_sums_pence: int
    estimate_pence: int
    unclassified_pence: int
    fixed_price_coverage_pct: float | None
    provisional_sums_pct: float | None


@dataclass
class CostPlanResult:
    """Spec Sec 16. Mirrors CostPlanResult in cost-plan.ts field for field.
    The ONLY shape the UI and the report may read cost from. Every contingency
    and fee line carries its BASE as well as its amount."""

    mode: str
    packages: list[CostPackageLine] = field(default_factory=list)
    base_build_pence: int = 0
    contingency: list[ContingencyLine] = field(default_factory=list)
    contingency_total_pence: int = 0
    compliance_pence: int = 0
    construction_total_pence: int = 0
    fees: list[FeeLineResult] = field(default_factory=list)
    professional_total_pence: int = 0
    statutory_total_pence: int = 0
    # R10 Task 13 (CARRIED-2). construction_total_pence + professional_total_pence +
    # statutory_total_pence, computed once here so no component or report has to sum
    # three already-computed totals itself. Purely additive -- moves no other figure.
    conversion_total_pence: int = 0
    lender_eligible_base_pence: int = 0
    # R14 spec Sec 5 (Sec 4.2(b) amended). `lender_eligible_base_pence /
    # base_build_pence` as an UNROUNDED float, and 1.0 in headline mode or when
    # base_build_pence is 0 -- headline mode has no packages to flag, so its
    # eligible base is 0 against a non-zero base build, and the raw quotient
    # would silently zero the ledger's whole construction cap base. Reported
    # here so a reader can SEE the cap base rather than infer it; republished on
    # Schedule so the ledger reads one figure and never re-derives it. The one
    # rounding is on the product (construction_pence * ratio), in the ledger.
    lender_eligible_ratio: float = 1.0
    implied_rate_pence_per_sqm: int | None = None
    # R15b spec Sec 24.3. Sum of ROUNDED package lines, not a rounding of the
    # sum; 0 in headline mode and whenever no package carries an allowance.
    inflation_total_pence: int = 0
    # pct(inflation_total_pence, base_build_pence) -- the Costs page and memo
    # print it; None when base build is 0.
    inflation_pct_of_base_build: float | None = None
    latest_midpoint_month: float | None = None
    latest_midpoint_months_from_base: float | None = None
    # math.floor of the line above; the flag message and the memo sentence
    # print this integer, never the float.
    latest_midpoint_whole_months_from_base: int | None = None
    # R15 spec Sec 23.6. LAST two fields, both None in headline mode. `qs` is
    # the input block republished verbatim (model_dump(mode="json")) -- the
    # cost plan is the one place the report reads it from, so it never
    # re-derives provenance from the raw input document.
    price_basis: PriceBasisSummary | None = None
    qs: dict[str, Any] | None = None


def _cost_plan_of(inputs) -> Any:
    """A pre-v7 document has no cost_plan. Read structurally, exactly like
    areas.py's _bridge_inputs_of reads the bridge.

    The fallback DERIVES the plan from the document's own cost fields. It must
    not be DEFAULT_COST_PLAN -- see cost_plan_from_legacy_costs' docstring for
    why (zero professional and statutory costs on every unmigrated document,
    and the golden fixtures run natively without migrating)."""
    plan = getattr(inputs, "cost_plan", None)
    if plan is not None:
        return plan
    from .types import cost_plan_from_legacy_costs

    return cost_plan_from_legacy_costs(inputs.conversion_costs)


def compute_cost_plan(inputs, area_sqm: float, unit_count: int) -> CostPlanResult:
    plan = _cost_plan_of(inputs)
    cc = inputs.conversion_costs
    detailed = plan.mode == "detailed"

    # R15b spec Sec 24.3. `months_between` is due_diligence.py's Sec 23.9
    # helper, imported LAZILY: due_diligence.py imports CostPlanResult from
    # this module at module scope, so a top-level import back here would be a
    # hard Python cycle (the same technique package_timing.py uses for
    # `resolved_phase_id`, imported from schedule.py).
    from .due_diligence import months_between

    # Package timing, resolved once; the tender-price inflation origin
    # (qs.base_date -> acquisition_date) and allowance. Gated on detailed
    # mode: headline mode has no packages by validation, and a stray `qs`
    # left on a headline document must not leak an allowance into a mode with
    # nothing priced to inflate.
    timing = compute_package_timing(inputs)
    timing_by_id = {t.id: t for t in timing}
    acq_date = getattr(inputs.acquisition, "acquisition_date", None)
    plan_qs = getattr(plan, "qs", None) if detailed else None
    base_date = (
        plan_qs.base_date if plan_qs is not None and plan_qs.base_date.strip() != "" else None
    )
    # `getattr(None, ...)` is safe and returns the default -- no need to guard
    # plan_qs is None separately here.
    inflation = getattr(plan_qs, "inflation", None)
    # spec Sec 24.7 rule 1 owns the error; the engine degrades rather than
    # overflowing. A non-finite or negative rate reads as None here -- the
    # same "no allowance" state an absent `inflation` attribute produces --
    # so `factor`/`inflation_pence` fall to their None/0 defaults below
    # instead of feeding an infinite/NaN `x` into `money_round`'s
    # `math.floor(x + 0.5)`, which raises OverflowError. `months_from_base`
    # and the latest-midpoint fields do not read this value at all, so they
    # are unaffected and still published. (Pydantic already rejects a
    # negative or NaN annual_pct at parse time -- InflationAllowance.annual_pct
    # is `Field(ge=0)` -- so only `inf` reaches this check in this engine; the
    # `>= 0` arm is kept for parity with the TS engine, which is not
    # type-coerced and can reach it directly.)
    inflation_rate = (
        inflation.annual_pct
        if inflation is not None and math.isfinite(inflation.annual_pct) and inflation.annual_pct >= 0
        else None
    )
    base_to_month_0 = (
        months_between(base_date, acq_date) if base_date is not None and acq_date is not None else None
    )

    packages: list[CostPackageLine] = []
    for p in plan.packages:
        t = timing_by_id.get(p.id)
        start = t.start_month if t is not None else 0
        finish = t.finish_month if t is not None else 0
        midpoint = t.midpoint_month if t is not None else 0.0
        months_from_base = (
            None if base_to_month_0 is None else max(0.0, base_to_month_0 + midpoint)
        )
        factor = (
            (1 + inflation_rate / 100) ** (months_from_base / 12)
            if inflation_rate is not None and months_from_base is not None
            else None
        )
        inflation_pence = 0 if factor is None else money_round(p.amount_pence * (factor - 1))
        packages.append(CostPackageLine(
            id=p.id, code=p.code, label=p.label, amount_pence=p.amount_pence,
            contingency_class=p.contingency_class, lender_eligible=p.lender_eligible,
            # `p.phase_id` is already None on every migrated/untagged row --
            # CostPackage declares the field with that default -- so this is a
            # plain passthrough, not the TS side's `?? null` guard against an
            # absent key on an unvalidated object literal.
            phase_id=p.phase_id,
            resolved_phase_id=t.phase_id if t is not None else None,
            start_month=start, finish_month=finish, midpoint_month=midpoint,
            months_from_base=months_from_base, inflation_factor=factor,
            inflation_pence=inflation_pence,
            # getattr: a pre-v17 CostPackage model has the attribute (declared
            # with a None default) but a raw namespace might not.
            benchmark_origin=(
                None if getattr(p, "benchmark_origin", None) is None
                else p.benchmark_origin.model_dump(mode="json")
            ),
        ))

    # Spec Sec 1.1: the fractional-area product rounds once, at source.
    base_build = (
        sum(p.amount_pence for p in packages)
        if detailed
        else money_round(cc.construction_cost_per_sqm_pence * area_sqm)
    )

    # R14 spec Sec 5. Summed ONCE: both lender_eligible_base_pence and the ratio
    # the ledger's Sec 4.2(b) cap base reads are this figure.
    lender_eligible_base = sum(p.amount_pence for p in packages if p.lender_eligible)

    # Sec 3.2.1: in detailed mode compliance is priced inside the packages
    # (fire_acoustic_thermal). Counting the fields too would double count.
    compliance = (
        0
        if detailed
        else cc.fire_safety_pence + cc.sound_insulation_pence + cc.part_l_compliance_pence
    )

    # R11 spec Sec 17.8. One mechanism: the package's own tag. basis/package_ids
    # are gone from the input; the result keeps `basis` as a DERIVED description
    # of the base, so the reported shape and every fixture's strings are
    # unchanged.
    #
    # Headline mode gives every class the whole base build. There are no
    # packages to tag, and the calculator renders all three percentages in both
    # modes -- scoping by tag here would silently zero a live input path.
    contingency: list[ContingencyLine] = []
    for c in plan.contingency:
        scoped = detailed and c.name != "general"
        base = (
            sum(p.amount_pence for p in packages if p.contingency_class == c.name)
            if scoped
            else base_build
        )
        basis = "selected_packages" if scoped else "all_packages"
        contingency.append(
            ContingencyLine(
                name=c.name, pct=c.pct, basis=basis,
                base_pence=base, amount_pence=money_round(base * c.pct / 100),
            )
        )
    # Sum of ROUNDED figures. Three allowances at 5% are not one at 15%.
    contingency_total = sum(c.amount_pence for c in contingency)

    # R15b spec Sec 24.3. Sum of ROUNDED package lines, not a rounding of the
    # sum. 0 in headline mode -- there are no packages to inflate, and a
    # stray headline package's own inflation_pence is already 0 (plan_qs was
    # forced to None above).
    inflation_total = sum(p.inflation_pence for p in packages) if detailed else 0

    construction_total = base_build + inflation_total + contingency_total + compliance

    # No fee basis includes fees, so this needs no ordering and no iteration.
    fees: list[FeeLineResult] = []
    for f in plan.fee_lines:
        if f.basis == "pct_of_base_build":
            base = base_build
        elif f.basis == "pct_of_construction_total":
            base = construction_total
        else:
            base = 0
        if f.basis == "fixed":
            amount = f.amount_pence * max(1, unit_count) if f.per_dwelling else f.amount_pence
        else:
            amount = money_round(base * f.pct / 100)
        fees.append(
            FeeLineResult(
                id=f.id, code=f.code, category=f.category, label=f.label,
                basis=f.basis, base_pence=base, amount_pence=amount,
                # See the matching comment on the package mapping above.
                phase_id=f.phase_id,
            )
        )

    professional_total = sum(f.amount_pence for f in fees if f.category == "professional")
    statutory_total = sum(f.amount_pence for f in fees if f.category == "statutory")

    # R15 spec Sec 23.6. Read through getattr so a pre-v13 package (which has
    # no `price_basis` attribute at all -- not merely None) is treated the
    # same as an untagged v13 one: unclassified, not an AttributeError.
    price_basis_summary = None
    qs = None
    if detailed:
        fixed = sum(p.amount_pence for p in plan.packages if getattr(p, "price_basis", None) == "fixed_price")
        provisional = sum(p.amount_pence for p in plan.packages if getattr(p, "price_basis", None) == "provisional_sum")
        estimate = sum(p.amount_pence for p in plan.packages if getattr(p, "price_basis", None) == "estimate")
        unclassified = sum(p.amount_pence for p in plan.packages if getattr(p, "price_basis", None) is None)
        price_basis_summary = PriceBasisSummary(
            fixed_price_pence=fixed,
            provisional_sums_pence=provisional,
            estimate_pence=estimate,
            unclassified_pence=unclassified,
            fixed_price_coverage_pct=pct(fixed, base_build),
            provisional_sums_pct=pct(provisional, base_build),
        )
        # `plan_qs` was already resolved above (detailed mode, `getattr(plan,
        # "qs", None)`) for the inflation origin -- reused here rather than
        # re-fetched.
        qs = None if plan_qs is None else plan_qs.model_dump(mode="json")

    # R15b spec Sec 24.3. The latest package spend midpoint and its distance
    # from the QS base date -- printed by the flag/memo as a whole month.
    latest_midpoint = max((p.midpoint_month for p in packages), default=None)
    latest_from_base = (
        None if latest_midpoint is None or base_to_month_0 is None
        else max(0.0, base_to_month_0 + latest_midpoint)
    )
    latest_whole = None if latest_from_base is None else math.floor(latest_from_base)

    return CostPlanResult(
        mode=plan.mode,
        packages=packages,
        base_build_pence=base_build,
        contingency=contingency,
        contingency_total_pence=contingency_total,
        compliance_pence=compliance,
        construction_total_pence=construction_total,
        fees=fees,
        professional_total_pence=professional_total,
        statutory_total_pence=statutory_total,
        conversion_total_pence=construction_total + professional_total + statutory_total,
        lender_eligible_base_pence=lender_eligible_base,
        # R14 spec Sec 5. Unrounded -- the ONE rounding is on the product, in the ledger.
        lender_eligible_ratio=(
            1.0 if not detailed or base_build == 0 else lender_eligible_base / base_build
        ),
        implied_rate_pence_per_sqm=(
            money_round(base_build / area_sqm) if area_sqm > 0 else None
        ),
        inflation_total_pence=inflation_total,
        inflation_pct_of_base_build=pct(inflation_total, base_build),
        latest_midpoint_month=latest_midpoint,
        latest_midpoint_months_from_base=latest_from_base,
        latest_midpoint_whole_months_from_base=latest_whole,
        price_basis=price_basis_summary,
        qs=qs,
    )
