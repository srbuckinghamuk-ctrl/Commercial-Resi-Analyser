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


# --- Release 8 (calc 2.7.0): jurisdiction, acquisition date and tax override --

JurisdictionSource = Literal["derived", "user", "migrated_default"]


class AcquisitionInputsV5(AcquisitionInputs):
    """R8 (spec Sec 14). Mirrors frontend AcquisitionInputsV5. Extends rather
    than edits AcquisitionInputs because that base shape is shared with the
    v1-v4 document shapes."""

    # Deliberately re-declared, not imported from acquisition_tax.Jurisdiction:
    # acquisition_tax.py imports engine.py (for money_round), and engine.py
    # imports this module for FacilityTerms/etc, so importing acquisition_tax
    # from types.py would be a cycle (types -> acquisition_tax -> engine ->
    # types). test_migrate_v5.py asserts the two literal value-sets stay
    # identical so they cannot silently drift apart.
    jurisdiction: Literal["england_ni", "scotland", "wales"] = "england_ni"
    jurisdiction_source: JurisdictionSource = "migrated_default"
    # Reuses the vocabulary of EquitySource.evidence_status deliberately: the
    # report handles evidence with one mechanism, not two.
    jurisdiction_evidence_status: Literal["unconfirmed", "confirmed"] = "unconfirmed"
    # Effective date of the transaction; selects the band set. None on migrated
    # documents, which then use the current set and say so.
    acquisition_date: str | None = None
    # Set only where a relief, linked transaction or other rule no band table
    # models applies. Requires a reason (validation, Task 6).
    acquisition_tax_override_pence: int | None = Field(default=None, ge=0)
    acquisition_tax_override_reason: str = ""


class CalculatorInputsV5(CalculatorInputsV4):
    """Mirrors CalculatorInputsV4 with the R8 acquisition block. Subclasses V4
    for the same reason V4 subclasses V3: the engine dispatches on it, and a
    flat re-declaration would make those isinstance checks silently False for
    v5 documents."""

    inputs_version: Literal[5] = 5  # type: ignore[assignment]
    acquisition: AcquisitionInputsV5  # type: ignore[assignment]


# --- Release 9 (calc 2.8.0): area bridge and per-unit ancillary ---

# Deliberately re-declared, not imported from areas.AreaBasis: areas.py imports
# engine.py (for pct), and engine.py imports this module, so importing areas
# from types.py would be a cycle (types -> areas -> engine -> types). This is
# the same trade-off AcquisitionInputsV5.jurisdiction makes above, and
# test_migrate_v6.py asserts the two literal value-sets stay identical so they
# cannot silently drift apart.
AreaBasis = Literal["bridge_derived", "manual"]


class AreaBridgeInputs(Model):
    """R9 (spec Sec 15.1). Every field is ENTERED; nothing derived is stored.
    Mirrors AreaBridgeInputs in areas.ts."""

    basis: AreaBasis = "manual"
    existing_gia_sqm: float = Field(default=0.0, ge=0)
    demolished_gia_sqm: float = Field(default=0.0, ge=0)
    extension_gia_sqm: float = Field(default=0.0, ge=0)
    retained_commercial_gia_sqm: float = Field(default=0.0, ge=0)
    untouched_gia_sqm: float = Field(default=0.0, ge=0)
    circulation_common_sqm: float = Field(default=0.0, ge=0)
    plant_riser_sqm: float = Field(default=0.0, ge=0)
    store_bin_cycle_sqm: float = Field(default=0.0, ge=0)
    amenity_sqm: float = Field(default=0.0, ge=0)
    # External amenity and landscape. NOT gross internal area -- carried for
    # display but never deducted from the reconciliation.
    external_amenity_sqm: float = Field(default=0.0, ge=0)


class UnitAncillary(Model):
    """R9 (spec Sec 15.5). Areas here sit outside NIA; values sit outside
    internal saleable GDV. Mirrors UnitAncillary in conversion-types.ts."""

    balcony_terrace_sqm: float = Field(default=0.0, ge=0)
    balcony_terrace_value_pence: int = Field(default=0, ge=0)
    parking_spaces: int = Field(default=0, ge=0)
    parking_value_pence: int = Field(default=0, ge=0)


class ProposedUnitV6(ProposedUnit):
    """Extended rather than edited: ProposedUnit is shared with the v1-v5
    document shapes, the same reasoning R8 applied to AcquisitionInputsV5."""

    ancillary: UnitAncillary = Field(default_factory=UnitAncillary)


class UnitMixInputsV6(Model):
    units: list[ProposedUnitV6] = Field(default_factory=list)


class CalculatorInputsV6(CalculatorInputsV5):
    """Mirrors CalculatorInputsV5 with the R9 area bridge and ancillary blocks.
    Subclasses V5 for the same reason V5 subclasses V4: the engine dispatches on
    it, and a flat re-declaration would make those isinstance checks silently
    False for v6 documents."""

    inputs_version: Literal[6] = 6  # type: ignore[assignment]
    unit_mix: UnitMixInputsV6  # type: ignore[assignment]
    areas: AreaBridgeInputs = Field(default_factory=AreaBridgeInputs)


# --- Release 10 (calc 2.9.0): cost plan modes, contingency classes, fee bases ---

CostPlanMode = Literal["headline", "detailed"]

CostPackageCode = Literal[
    "enabling_strip_out_asbestos", "structure", "envelope", "roof_windows",
    "fire_acoustic_thermal", "mech_elec_public_health", "drainage_utilities",
    "lift", "partitions", "finishes", "common_parts", "externals", "other",
]

COST_PACKAGE_CODES: tuple[str, ...] = (
    "enabling_strip_out_asbestos", "structure", "envelope", "roof_windows",
    "fire_acoustic_thermal", "mech_elec_public_health", "drainage_utilities",
    "lift", "partitions", "finishes", "common_parts", "externals", "other",
)

ContingencyClassName = Literal["general", "existing_building", "abnormal"]

CONTINGENCY_CLASS_NAMES: tuple[str, ...] = ("general", "existing_building", "abnormal")

FeeBasis = Literal["fixed", "pct_of_base_build", "pct_of_construction_total"]

FeeCode = Literal[
    "architect", "structural_engineer", "mande", "planning_consultant",
    "other_professional", "prior_approval", "cil_s106", "building_control", "other",
]

FeeCategory = Literal["professional", "statutory"]

# Spec Sec 3.4. FIXED, not a user choice. `building_control` reads like a
# consultant fee and sits inside the professional block of ConversionCostInputs,
# but schedule.py counts it in the STATUTORY total (Sec 3.6). Misclassifying it
# moves money between two separately-reported, separately-spread lines while
# every grand total stays correct -- invisible to any totals-based test.
FEE_CODE_CATEGORY: dict[str, str] = {
    "architect": "professional",
    "structural_engineer": "professional",
    "mande": "professional",
    "planning_consultant": "professional",
    "other_professional": "professional",
    "prior_approval": "statutory",
    "cil_s106": "statutory",
    "building_control": "statutory",
}


# R11 spec Sec 17.3. Defined here, ahead of the R10 block, because CostPackage
# and FeeLine below carry a `vat_override: VatOverride | None` field: pydantic
# builds a model's core schema at class-definition time (this module uses
# `from __future__ import annotations`, so forward refs resolve against the
# module's globals at first use), and CostPlanInputs -- which contains
# CostPackage/FeeLine -- is instantiated immediately below (DEFAULT_COST_PLAN),
# well before the rest of the R11 VAT block. The remaining VAT types are
# declared in their natural place after the R10 cost-plan block.
RecoveryBasis = Literal["zero_rated_sale", "partial_exemption", "blocked", "unconfirmed"]


class VatOverride(Model):
    rate_pct: float = Field(default=0.0, ge=0)
    recoverable_pct: float = Field(default=0.0, ge=0)
    recovery_basis: RecoveryBasis = "unconfirmed"


class CostPackage(Model):
    """Mirrors CostPackage in cost-plan.ts, field for field and in order."""

    id: str
    code: CostPackageCode
    label: str = ""
    amount_pence: int = Field(default=0, ge=0)
    # Recorded but NOT live in R10 (spec Sec 16.9): neither engine reads this
    # field when resolving a contingency class's base. Scoping is driven solely
    # by each ContingencyClass's own basis / package_ids -- set nowhere in the
    # product today, so every class currently applies to all_packages. Do not
    # wire this in without reading Sec 16.9 first; it changes contingency base
    # resolution.
    contingency_class: ContingencyClassName = "general"
    # R10 records this; the ledger's draw cap does NOT read it. R14 wires it.
    lender_eligible: bool = True
    notes: str = ""
    # R11 spec Sec 17.1. Detailed mode only -- hard-rejected in headline mode
    # (validation, Task 9). None on every migrated line and on every line the
    # user has not overridden. Read ONLY through resolve_vat_treatment().
    vat_override: VatOverride | None = None


class ContingencyClass(Model):
    name: ContingencyClassName
    pct: float = Field(default=0.0, ge=0)
    basis: Literal["all_packages", "selected_packages"] = "all_packages"
    package_ids: list[str] = Field(default_factory=list)


class FeeLine(Model):
    id: str
    code: FeeCode
    category: FeeCategory
    label: str = ""
    basis: FeeBasis = "fixed"
    amount_pence: int = Field(default=0, ge=0)
    pct: float = Field(default=0.0, ge=0)
    per_dwelling: bool = False
    # R11 spec Sec 17.1. Detailed mode only -- hard-rejected in headline mode
    # (validation, Task 9). None on every migrated line and on every line the
    # user has not overridden. Read ONLY through resolve_vat_treatment().
    vat_override: VatOverride | None = None


class CostPlanInputs(Model):
    mode: CostPlanMode = "headline"
    packages: list[CostPackage] = Field(default_factory=list)
    contingency: list[ContingencyClass] = Field(default_factory=list)
    fee_lines: list[FeeLine] = Field(default_factory=list)


def default_contingency_classes(general_pct: float) -> list[ContingencyClass]:
    return [
        ContingencyClass(
            name=name,  # type: ignore[arg-type]
            pct=general_pct if name == "general" else 0.0,
            basis="all_packages",
            package_ids=[],
        )
        for name in CONTINGENCY_CLASS_NAMES
    ]


DEFAULT_COST_PLAN = CostPlanInputs(
    mode="headline",
    packages=[],
    contingency=default_contingency_classes(10.0),
    fee_lines=[],
)


def cost_plan_from_legacy_costs(cc) -> CostPlanInputs:
    """Spec Sec 4. Builds a cost plan from a pre-v7 document's flat cost fields.

    Used in TWO places and it must be the SAME construction in both: the v6->v7
    migration (Task 6), and the engine's fallback for a document with no
    cost_plan block (Task 4). DEFAULT_COST_PLAN must NOT be used as that
    fallback -- it carries no fee lines and a hardcoded 10% contingency, so
    every unmigrated document would report zero professional fees and zero
    statutory costs once schedule.py reads its totals from here.

    No package schedule is synthesised: splitting a headline figure into
    invented packages would be inventing evidence.
    """

    def fee(code: str, label: str, amount: int, per_dwelling: bool = False) -> FeeLine:
        return FeeLine(
            id=f"fee-{code}",
            code=code,  # type: ignore[arg-type]
            category=FEE_CODE_CATEGORY[code],  # type: ignore[arg-type]
            label=label,
            basis="fixed",
            amount_pence=amount,
            pct=0.0,
            per_dwelling=per_dwelling,
        )

    return CostPlanInputs(
        mode="headline",
        packages=[],
        contingency=default_contingency_classes(cc.contingency_pct),
        fee_lines=[
            fee("architect", "Architect", cc.architect_pence),
            fee("structural_engineer", "Structural engineer", cc.structural_engineer_pence),
            fee("mande", "M&E", cc.mande_pence),
            fee("planning_consultant", "Planning consultant", cc.planning_consultant_pence),
            fee("other_professional", "Other professional fees", cc.other_professional_fees_pence),
            fee("prior_approval", "Prior approval fee",
                cc.prior_approval_fee_per_dwelling_pence, True),
            fee("cil_s106", "CIL / S106", cc.cil_s106_pence),
            fee("building_control", "Building control", cc.building_control_pence),
        ],
    )


class CalculatorInputsV7(CalculatorInputsV6):
    """Mirrors CalculatorInputsV6 with the R10 cost plan. Subclasses V6 for the
    same reason V6 subclasses V5: the engine dispatches on it, and a flat
    re-declaration would make those isinstance checks silently False for v7
    documents."""

    inputs_version: Literal[7] = 7  # type: ignore[assignment]
    cost_plan: CostPlanInputs = Field(
        default_factory=lambda: DEFAULT_COST_PLAN.model_copy(deep=True)
    )


# --- Release 11 (calc 2.10.0): VAT and TOGC ---

VatChargeCategory = Literal[
    "acquisition", "construction", "professional",
    "statutory", "selling", "lender_ancillary",
]

VAT_CHARGE_CATEGORIES: tuple[str, ...] = (
    "acquisition", "construction", "professional",
    "statutory", "selling", "lender_ancillary",
)

TogcTreatment = Literal["applies", "does_not_apply", "unconfirmed"]


class VatTreatment(Model):
    """Mirrors VatTreatment in vat.ts, field for field and in order."""

    category: VatChargeCategory
    rate_pct: float = Field(default=0.0, ge=0)
    recoverable_pct: float = Field(default=0.0, ge=0)
    recovery_basis: RecoveryBasis = "unconfirmed"
    evidence_status: EvidenceStatus = "unconfirmed"
    notes: str = ""


class PurchaseVatInputs(Model):
    vendor_opted_to_tax: bool = False
    togc_treatment: TogcTreatment = "unconfirmed"
    evidence_status: EvidenceStatus = "unconfirmed"
    notes: str = ""


class VatInputs(Model):
    registered: bool = False
    return_frequency: Literal["monthly", "quarterly"] = "quarterly"
    first_period_end_month: int = Field(default=2, ge=0)
    repayment_lag_months: int = Field(default=1, ge=0)
    treatments: list[VatTreatment] = Field(default_factory=list)
    purchase: PurchaseVatInputs = Field(default_factory=PurchaseVatInputs)


def default_vat_treatments() -> list[VatTreatment]:
    return [
        VatTreatment(category=c)  # type: ignore[arg-type]
        for c in VAT_CHARGE_CATEGORIES
    ]


DEFAULT_VAT = VatInputs(treatments=default_vat_treatments())


class CalculatorInputsV8(CalculatorInputsV7):
    """Mirrors CalculatorInputsV7 with the R11 VAT block. Subclasses V7 for the
    same reason V7 subclasses V6: the engine dispatches on it, and a flat
    re-declaration would make those isinstance checks silently False for v8
    documents."""

    inputs_version: Literal[8] = 8  # type: ignore[assignment]
    vat: VatInputs = Field(default_factory=lambda: DEFAULT_VAT.model_copy(deep=True))


AnyCalculatorInputs = (
    CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4
    | CalculatorInputsV5 | CalculatorInputsV6 | CalculatorInputsV7 | CalculatorInputsV8
)


def parse_calculator_inputs(doc: dict) -> AnyCalculatorInputs:
    """Version-dispatching parse for a stored/fixture inputs document.

    The TS engine takes ``AnyCalculatorInputs`` structurally and needs no such
    helper; Python has to pick a concrete Pydantic model, and every call site
    that reads a mixed-version corpus (the golden fixtures, the API boundary)
    would otherwise re-implement the same ``inputs_version`` switch."""
    version = doc.get("inputs_version")
    if version == 7:
        return CalculatorInputsV7.model_validate(doc)
    if version == 6:
        return CalculatorInputsV6.model_validate(doc)
    if version == 5:
        return CalculatorInputsV5.model_validate(doc)
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

CALC_VERSION = "2.9.0"
