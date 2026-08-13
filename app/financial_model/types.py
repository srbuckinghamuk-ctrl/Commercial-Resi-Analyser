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

from typing import Literal

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


FlagCode = Literal[
    "facility_exceeded", "funding_gap", "interest_reserve_exhausted",
    "senior_outstanding_at_maturity", "additional_equity_required",
    "negative_profit", "requires_confirmation", "irr_unavailable",
    "unrealised_profit_basis", "exit_fee_not_charged",
]

CALC_VERSION = "2.0.0"
