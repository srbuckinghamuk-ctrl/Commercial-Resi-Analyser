"""Pydantic v2 mirror of frontend/src/lib/model/finance-types.ts and the slice of
frontend/src/lib/conversion-types.ts it depends on.

Port rule (task-11-brief.md #1): one Python module per TS module, same order of
functions/types, same field names (the TS names are already snake_case, so names
match exactly). These models double as the API schema in Task 12.

Constraints (port rule #7): every ``*_pence`` field is ``ge=0`` (negatives are
rejected at the boundary); every share percentage is ``ge=0, le=100``;
``term_months`` is ``ge=1``; enums are ``Literal[...]``.
"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

FundingSource = Literal["cash", "bridging", "development_finance"]
InterestType = Literal["rolled_up", "serviced"]
ArrangementFeeBasis = Literal["committed_net_facility", "committed_gross_facility"]
ExitFeeBasis = Literal["committed_gross_facility", "peak_debt", "redemption_balance"]
EquityDrawRule = Literal["equity_first", "pari_passu", "fund_as_required"]
EvidenceStatus = Literal["confirmed", "unconfirmed", "rejected"]

EquityClassification = Literal[
    "cash", "land", "planning_uplift", "vendor_finance",
    "deferred_consideration", "other_subordinated",
]

UnitType = Literal["studio", "1bed", "2bed", "3bed"]
ExitRoute = Literal["sell_all", "retain_all", "blended"]
Likelihood = Literal["low", "medium", "high"]
Impact = Literal["low", "medium", "high"]


class Model(BaseModel):
    """Shared base: forbid unknown fields would break forward-compat merges
    performed by migrate.py, so we keep the default (ignore extra)."""

    model_config = ConfigDict(populate_by_name=True)


class FacilityTerms(Model):
    funding_source: FundingSource
    # Senior tranche drawn at acquisition. None = unknown / no separate tranche.
    day_one_advance_pence: int | None = Field(default=None, ge=0)
    day_one_market_value_pence: int | None = Field(default=None, ge=0)
    # Caps monthly development draws at this % of that month's eligible dev costs.
    development_cost_advance_pct: float = Field(ge=0, le=100)
    committed_net_facility_pence: int | None = Field(default=None, ge=0)
    # None -> derived as net + interest_reserve.
    committed_gross_facility_pence: int | None = Field(default=None, ge=0)
    annual_interest_rate_pct: float = Field(ge=0)
    interest_type: InterestType
    arrangement_fee_pct: float = Field(ge=0)
    arrangement_fee_basis: ArrangementFeeBasis
    exit_fee_pct: float = Field(ge=0)
    exit_fee_basis: ExitFeeBasis
    broker_fee_pence: int = Field(ge=0)
    lender_legal_fee_pence: int = Field(ge=0)
    valuation_fee_pence: int = Field(ge=0)
    monitoring_surveyor_fee_pence: int = Field(ge=0)
    interest_reserve_pence: int | None = Field(default=None, ge=0)
    term_months: int = Field(ge=1)
    equity_draw_rule: EquityDrawRule
    # % of net sale receipts applied to senior debt.
    sales_sweep_pct: float = Field(ge=0, le=100)
    # Migrated v1 ltv_pct, display-only; never used in calculation.
    legacy_leverage_pct: float | None = None
    # True until a user confirms migrated/unevidenced facility terms.
    requires_confirmation: bool
    # Disclosed lender cost-of-enforcement assumption (spec Sec 2, Sec 5.11).
    enforcement_cost_assumption_pence: int = Field(default=0, ge=0)


class EquitySource(Model):
    id: str
    classification: EquityClassification
    amount_pence: int = Field(ge=0)
    # Earliest month the money is available (0 = acquisition month).
    timing_month: int = Field(ge=0)
    # 1 = repaid first among subordinated capital.
    repayment_priority: int = Field(ge=1)
    evidence_status: EvidenceStatus
    notes: str


class ProposedUnit(Model):
    id: str
    type: UnitType
    floor_area_sqm: float = Field(ge=0)
    estimated_value_pence: int = Field(ge=0)
    comparable_notes: str


class AcquisitionInputs(Model):
    purchase_price_pence: int = Field(ge=0)
    legal_fees_pence: int = Field(ge=0)
    survey_cost_pence: int = Field(ge=0)
    broker_fee_pct: float = Field(ge=0)
    other_acquisition_costs_pence: int = Field(ge=0)


class UnitMixInputs(Model):
    units: list[ProposedUnit] = Field(default_factory=list)


class ConversionCostInputs(Model):
    prior_approval_fee_per_dwelling_pence: int = Field(ge=0)
    cil_s106_pence: int = Field(ge=0)
    architect_pence: int = Field(ge=0)
    structural_engineer_pence: int = Field(ge=0)
    mande_pence: int = Field(ge=0)
    planning_consultant_pence: int = Field(ge=0)
    building_control_pence: int = Field(ge=0)
    other_professional_fees_pence: int = Field(ge=0)
    construction_cost_per_sqm_pence: int = Field(ge=0)
    total_construction_sqm: float = Field(ge=0)
    contingency_pct: float = Field(ge=0)
    fire_safety_pence: int = Field(ge=0)
    sound_insulation_pence: int = Field(ge=0)
    part_l_compliance_pence: int = Field(ge=0)


class RetainedUnit(Model):
    unit_id: str
    monthly_rent_pence: int = Field(ge=0)


class ExitStrategyInputs(Model):
    route: ExitRoute
    selling_agent_fee_pct: float = Field(ge=0)
    selling_legal_fee_pence: int = Field(ge=0)
    retained_units: list[RetainedUnit] = Field(default_factory=list)


class RiskItem(Model):
    id: str
    description: str
    likelihood: Likelihood
    impact: Impact
    mitigation: str


class ScenarioOverrides(Model):
    label: str
    gdv_adjustment_pct: float
    construction_cost_adjustment_pct: float
    timeline_adjustment_months: float
    interest_rate_adjustment_pct: float


class Scenarios(Model):
    base: ScenarioOverrides
    upside: ScenarioOverrides
    downside: ScenarioOverrides
    severe: ScenarioOverrides


class DealSpiderInputs(Model):
    storeys: int
    building_height_m: float
    bsa_higher_risk: bool
    daylight_pass_pct: float = Field(ge=0, le=100)
    absorption_months: float
    exit_sell: bool
    exit_refinance: bool
    exit_hold: bool
    exit_part_sale: bool
    prior_approval_window_months: float
    programme_contingency_months: float
    cil_offset_pence: int = Field(ge=0)
    # Not bounded [0,100]: this is a target return, not a share of a whole, and
    # validation.py permits any value greater than -100 (spec Sec 3.18).
    target_profit_on_cost_pct: float
    weights: dict[str, float] = Field(default_factory=dict)


class CalculatorInputsV2(Model):
    inputs_version: Literal[2]
    project_id: str | None
    acquisition: AcquisitionInputs
    unit_mix: UnitMixInputs
    conversion_costs: ConversionCostInputs
    finance: FacilityTerms
    equity_sources: list[EquitySource]
    exit_strategy: ExitStrategyInputs
    risks: list[RiskItem]
    scenarios: Scenarios
    deal_spider: DealSpiderInputs


LenderAdjustmentBasis = Literal[
    "global_pct", "global_per_sqft", "unit_type", "per_unit", "fixed_amount",
]


class LenderValuation(Model):
    basis: LenderAdjustmentBasis
    # basis-dependent value:
    #  global_pct: percentage adjustment applied to every unit's developer value (e.g. -10)
    #  global_per_sqft: pence per sq ft applied to every unit's area (replaces unit value)
    #  fixed_amount: total lender GDV in pence (single figure, replaces the sum)
    global_value: float | None = None
    # unit_type basis: map unit type -> pct adjustment; per_unit basis: map unit id -> lender value pence
    per_key_values: dict[str, float] | None = None
    # Required provenance (spec Sec 3.2: variance displayed with reason/author/date).
    reason: str = Field(min_length=1)
    author: str = Field(min_length=1)
    date: str = Field(min_length=1)  # ISO yyyy-mm-dd


class CalculatorInputsV3(Model):
    """Mirrors CalculatorInputsV2 plus the additive lender_valuation block
    (calc 2.1.0). Kept as a separate model -- Task 2's migration owns v2/v3
    acceptance at the boundary; CalculatorInputsV2 remains untouched so every
    existing caller (schedule/engine/metrics/validation/migrate) and fixture
    keeps validating and running exactly as before."""

    inputs_version: Literal[3]
    project_id: str | None
    acquisition: AcquisitionInputs
    unit_mix: UnitMixInputs
    conversion_costs: ConversionCostInputs
    finance: FacilityTerms
    equity_sources: list[EquitySource]
    exit_strategy: ExitStrategyInputs
    risks: list[RiskItem]
    scenarios: Scenarios
    deal_spider: DealSpiderInputs
    lender_valuation: LenderValuation | None = None


# --- Release 3a (calc 2.2.0): spend curves and the v4 programme blocks --------
#
# Port deviation (documented, deliberate): in TypeScript the ``SpendCurve``
# discriminated union is declared in curves.ts and *re-exported* by
# finance-types.ts. In Python that layout is a genuine import cycle --
# curves.py needs money_round from engine.py, engine.py needs FacilityTerms
# from types.py -- so the union is declared here (the types module) and
# curves.py imports it, which is the same dependency direction the rest of
# this package already uses. The shapes are identical to curves.ts's.


class SimpleSpendCurve(Model):
    kind: Literal["straight_line", "s_curve", "back_loaded"]


class UserDefinedSpendCurve(Model):
    kind: Literal["user_defined"]
    # Length/non-negativity/sum are validated in validation.py (mirroring
    # validation.ts), NOT constrained here -- see the note on ProgrammePackage.
    # `max_length` is the same resource-exhaustion backstop as ProgrammePackage's
    # ceilings, not a spec rule: the real length rule ("one entry per window
    # month") stays in validation.py.
    weights: list[float] = Field(max_length=1200)


SpendCurve = Annotated[
    SimpleSpendCurve | UserDefinedSpendCurve, Field(discriminator="kind"),
]


class ProgrammePackage(Model):
    """Port rule #7 exception, mirroring validation.ts: ``start_offset`` and
    ``duration_months`` carry no *lower* Pydantic bounds. Spec Sec 6.1's window
    rules (duration >= 1, start >= 0, window inside the 2-month sale tail) are
    hard *validation* errors owned by validation.py exactly as they are in the TS
    engine -- constraining them here instead would surface them as a 422 parse
    failure with a Pydantic message rather than the spec-worded ValidationIssue,
    and would make the negative cases unconstructible in the validation tests.

    The ``le=1200`` upper ceilings (100 years of months) are NOT spec rules and
    do not displace validation.py: they are a boundary backstop against resource
    exhaustion (I2, final R3a review). A hostile payload with
    ``duration_months: 10**9`` would otherwise reach ``build_schedule`` and
    allocate gigabytes of per-month arrays before any rule could reject it. They
    are deliberately far above any plausible real window, so no legitimate input
    can hit them and the spec-worded message stays the UX for every realistic
    violation.
    """

    start_offset: int = Field(le=1200)
    duration_months: int = Field(le=1200)
    curve: SpendCurve


class ProgrammePackages(Model):
    construction: ProgrammePackage
    professional: ProgrammePackage
    statutory: ProgrammePackage


class ProgrammeInputs(Model):
    # Display-only calendar anchor, "YYYY-MM". None = month indices only.
    anchor_month: str | None = None
    packages: ProgrammePackages


class SalesPhasingTranche(Model):
    """Port rule #7 exception, mirroring ProgrammePackage above: ``month_offset``
    carries no lower Pydantic bound -- spec Sec 4.4.1's window rule (0 <= month <=
    term-1, strictly increasing) is a hard *validation* error owned by
    validation.py exactly as it is in the TS engine. The ``le=1200`` upper
    ceiling is the same resource-exhaustion backstop as ProgrammePackage's,
    not a spec rule (Task 9 review)."""

    month_offset: int = Field(le=1200)
    pct_of_gross_receipts: float


class SalesPhasingInputs(Model):
    # `max_length` is the same resource-exhaustion backstop as
    # UserDefinedSpendCurve.weights's -- the real "one tranche per sale, sum to
    # 100%" rules live in validation.py.
    tranches: list[SalesPhasingTranche] = Field(default_factory=list, max_length=1200)


class RefinanceInputs(Model):
    """``month_offset`` carries no lower Pydantic bound for the same reason as
    SalesPhasingTranche's above; validation.py owns the [0, term-1] window."""

    month_offset: int = Field(le=1200)
    investment_value_pence: int
    ltv_pct: float
    arrangement_fee_pence: int
    legal_costs_pence: int


class CalculatorInputsV4(CalculatorInputsV3):
    """Mirrors CalculatorInputsV3 plus the three additive (nullable)
    Release 3a blocks (spec Sec 6.1, calc 2.2.0).

    Port deviation from the V2/V3 pattern, and the reason for it: V3 is a flat
    re-declaration of V2 because nothing dispatches on their relationship. V4
    *subclasses* V3 because the engine does dispatch on it -- metrics.py and
    validation.py gate the lender_valuation block on
    ``isinstance(inputs, CalculatorInputsV3)``, which is Python's stand-in for
    the TS engine's structural ``'lender_valuation' in inputs`` check. A flat
    re-declaration would make those checks silently False for v4 documents and
    null every lender metric on them -- a parity break against the TS engine.
    Subclassing keeps the structural semantics exact. The Literal override
    still makes the two mutually exclusive at parse time: a v4 dict fails
    ``CalculatorInputsV3.model_validate`` and vice versa.

    ``sales_phasing`` / ``refinance`` are schema-only until Release 3b;
    validation.py hard-rejects them when non-null (never silently ignored).
    """

    inputs_version: Literal[4]  # type: ignore[assignment]
    programme: ProgrammeInputs | None = None
    sales_phasing: SalesPhasingInputs | None = None
    refinance: RefinanceInputs | None = None


AnyCalculatorInputs = CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4


def parse_calculator_inputs(doc: dict) -> AnyCalculatorInputs:
    """Version-dispatching parse for a stored/fixture inputs document.

    The TS engine takes ``AnyCalculatorInputs`` structurally and needs no such
    helper; Python has to pick a concrete Pydantic model, and every call site
    that reads a mixed-version corpus (the golden fixtures, the API boundary)
    would otherwise re-implement the same ``inputs_version`` switch."""
    version = doc.get("inputs_version")
    if version == 4:
        return CalculatorInputsV4.model_validate(doc)
    if version == 3:
        return CalculatorInputsV3.model_validate(doc)
    return CalculatorInputsV2.model_validate(doc)


FlagCode = Literal[
    "facility_exceeded", "funding_gap", "interest_reserve_exhausted",
    "senior_outstanding_at_maturity", "additional_equity_required",
    "negative_profit", "requires_confirmation", "irr_unavailable",
    "unrealised_profit_basis", "exit_fee_not_charged",
    "senior_breakeven_unsolvable", "developer_breakeven_unsolvable",
    "breakeven_cap_exhausted", "facility_redrawn_after_redemption",
]

CALC_VERSION = "2.6.0"
