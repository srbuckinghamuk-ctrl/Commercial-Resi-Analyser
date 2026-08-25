"""Mirror of frontend/src/lib/model/cost-plan.ts's engine (R10, spec Sec 16).

The pydantic INPUT models live in types.py (see areas.py / AreaBridgeInputs for
the same split). This module holds the result dataclass and the one engine that
serves both cost-plan modes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .engine import money_round, pct


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

    packages = [
        CostPackageLine(
            id=p.id, code=p.code, label=p.label, amount_pence=p.amount_pence,
            contingency_class=p.contingency_class, lender_eligible=p.lender_eligible,
            # `p.phase_id` is already None on every migrated/untagged row --
            # CostPackage declares the field with that default -- so this is a
            # plain passthrough, not the TS side's `?? null` guard against an
            # absent key on an unvalidated object literal.
            phase_id=p.phase_id,
        )
        for p in plan.packages
    ]

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

    construction_total = base_build + contingency_total + compliance

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
        plan_qs = getattr(plan, "qs", None)
        qs = None if plan_qs is None else plan_qs.model_dump(mode="json")

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
        price_basis=price_basis_summary,
        qs=qs,
    )
