"""Core domain models for the Commercial-Resi Analyser."""
import uuid
from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UseClass(StrEnum):
    OFFICE = "office"
    RETAIL = "retail"
    LIGHT_INDUSTRIAL = "light_industrial"
    RESTAURANT_CAFE = "restaurant_cafe"
    TAKEAWAY = "takeaway"
    AMUSEMENT = "amusement"
    LAUNDERETTE = "launderette"
    AGRICULTURAL = "agricultural"
    SUI_GENERIS = "sui_generis"
    OTHER = "other"
    UNKNOWN = "unknown"


class PdrClass(StrEnum):
    CLASS_MA = "class_ma"
    CLASS_G = "class_g"
    CLASS_M = "class_m"
    CLASS_N = "class_n"
    CLASS_Q = "class_q"


class PipelineStage(StrEnum):
    OPPORTUNITY_IDENTIFIED = "opportunity_identified"
    ELIGIBILITY_ASSESSED = "eligibility_assessed"
    FINANCIAL_APPRAISAL = "financial_appraisal"
    PRIOR_APPROVAL_SUBMITTED = "prior_approval_submitted"
    APPROVED = "approved"
    IN_CONVERSION = "in_conversion"
    COMPLETE = "complete"


class EligibilityVerdict(StrEnum):
    GREEN = "green"
    AMBER = "amber"
    RED = "red"


class Tenure(StrEnum):
    FREEHOLD = "freehold"
    LEASEHOLD = "leasehold"
    UNKNOWN = "unknown"


class ScrapeStatus(StrEnum):
    IDLE = "idle"
    LOADING = "loading"
    SUCCESS = "success"
    ERROR = "error"


class SourceHealth(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    PAUSED = "paused"


# --- Sub-models ---


class Address(BaseModel):
    raw: str
    line1: str | None = None
    line2: str | None = None
    town: str | None = None
    county: str | None = None
    postcode: str | None = None
    postcode_district: str | None = None


class PriceInfo(BaseModel):
    amount: int  # pence
    currency: str = "GBP"
    qualifier: str | None = None


class AuctionInfo(BaseModel):
    house: str | None = None
    lot_number: str | None = None
    date: str | None = None
    venue: str | None = None
    online_bidding: bool | None = None


# --- Commercial Listing ---


class CommercialListing(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    address: Address
    price: PriceInfo
    use_class: UseClass
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str
    source_name: str
    auction: AuctionInfo | None = None
    image_urls: list[str] = Field(default_factory=list)
    description: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# --- API models ---


class ScrapeUrlRequest(BaseModel):
    url: str


class ApiResponse(BaseModel):
    listing: CommercialListing | None = None
    error: str | None = None


# --- Lookup responses ---


class PostcodeLookupResponse(BaseModel):
    postcode: str
    latitude: float
    longitude: float
    lpa_name: str
    lpa_code: str
    region: str
    country: str
    admin_district: str


class FloodRiskResponse(BaseModel):
    """Flood information for a postcode.

    Flood *zone* data is not available from the live EA warnings feed, so the
    zone fields are always unknown/None — only live warning/alert status is
    reported. Check the EA Flood Map for Planning for the flood zone.
    """

    postcode: str
    flood_zone: str
    flood_zone_numeric: int | None = None
    in_flood_zone_2_or_3: bool | None = None
    has_active_warnings: bool = False
    warning_count: int = 0
    source: str


class EpcResponse(BaseModel):
    address: str
    postcode: str
    rating: str
    score: int
    certificate_date: str
    certificate_url: str
    property_type: str
    floor_area_sqm: float | None = None
    matched_address: bool = False


class Article4DirectionResponse(BaseModel):
    name: str
    pdr_classes_restricted: list[str]
    date_made: str | None = None
    coverage: str = ""


class Article4Response(BaseModel):
    lpa_code: str
    lpa_name: str
    lpa_in_dataset: bool = False
    has_article4: bool
    directions: list[Article4DirectionResponse] = Field(default_factory=list)
    note: str = ""


class EligibilityRunRequest(BaseModel):
    manual_overrides: dict[str, bool | None] = Field(default_factory=dict)


class EligibilityRunResponse(BaseModel):
    assessment: "EligibilityAssessment"
    auto_checks_performed: list[str] = Field(default_factory=list)
    manual_checks_pending: list[str] = Field(default_factory=list)


# --- Project ---


class ProjectCreate(BaseModel):
    address_raw: str
    address_line1: str | None = None
    address_line2: str | None = None
    address_town: str | None = None
    address_county: str | None = None
    address_postcode: str | None = None
    address_postcode_district: str | None = None
    price_pence: int
    price_qualifier: str | None = None
    use_class: UseClass
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    description: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    stage: PipelineStage = PipelineStage.OPPORTUNITY_IDENTIFIED
    pa_submitted_date: date | None = None
    pa_decision_date: date | None = None


class ProjectUpdate(BaseModel):
    address_raw: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_town: str | None = None
    address_county: str | None = None
    address_postcode: str | None = None
    address_postcode_district: str | None = None
    price_pence: int | None = None
    price_qualifier: str | None = None
    use_class: UseClass | None = None
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure | None = None
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    description: str | None = None
    image_urls: list[str] | None = None
    stage: PipelineStage | None = None
    pa_submitted_date: date | None = None
    pa_decision_date: date | None = None


class Project(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    address_raw: str
    address_line1: str | None = None
    address_line2: str | None = None
    address_town: str | None = None
    address_county: str | None = None
    address_postcode: str | None = None
    address_postcode_district: str | None = None
    price_pence: int
    price_qualifier: str | None = None
    use_class: UseClass
    floor_area_sqft: float | None = None
    floor_area_sqm: float | None = None
    floors: int | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_years_remaining: int | None = None
    current_use_description: str | None = None
    epc_rating: str | None = None
    is_vacant: bool | None = None
    vacancy_date: str | None = None
    source_url: str | None = None
    source_name: str | None = None
    description: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    stage: PipelineStage
    pa_submitted_date: date | None = None
    pa_decision_date: date | None = None
    created_at: datetime
    updated_at: datetime


# --- Eligibility ---


class EligibilityCriterion(BaseModel):
    key: str
    label: str
    passed: bool | None = None
    source: str | None = None
    auto_checked: bool = False
    value: str | None = None
    risk_flag: str | None = None
    # "statutory": failing means the PDR route is not available.
    # "prior_approval": failing is an approvability risk the LPA weighs at
    # prior-approval stage, not loss of the right.
    # Defaults to "statutory" for back-compat with stored assessments.
    category: str = "statutory"


class EligibilityAssessmentCreate(BaseModel):
    project_id: uuid.UUID
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = Field(default_factory=list)
    notes: str | None = None
    ruleset_version: str | None = None


class EligibilityAssessmentUpdate(BaseModel):
    pdr_class: PdrClass | None = None
    criteria: list[EligibilityCriterion] | None = None
    verdict: EligibilityVerdict | None = None
    suggested_next_steps: list[str] | None = None
    notes: str | None = None
    ruleset_version: str | None = None


class EligibilityAssessment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = Field(default_factory=list)
    notes: str | None = None
    ruleset_version: str | None = None
    created_at: datetime
    updated_at: datetime


# --- Financial Appraisal ---


class FinancialAppraisalCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    # Deliberately untyped here (validated/migrated in the endpoint via
    # migrate_inputs_to_v16, not by this schema) -- may be any of v1 through
    # v16 (a v13 document adds the R15 top-level `due_diligence` block and
    # `cost_plan.qs`/`price_basis`, defined on `DueDiligenceInputs` /
    # `CalculatorInputsV13`; a v14 document (R15b, spec Sec 24.8) adds
    # `cost_plan.qs.inflation`, defined on `QsProvenance` / `CalculatorInputsV14`
    # in the same module; a v15 document (R16, spec Sec 25.1) adds the four
    # stress-pack lever fields to every `ScenarioOverrides` --
    # `saleable_area_adjustment_pct`, `abnormal_cost_adjustment_pct`,
    # `programme_slip_months`, `refi_ltv_adjustment_pct` -- all written at their
    # identity zero, defined on `ScenarioOverrides` / `CalculatorInputsV15` in
    # the same module). A v5+ document's `acquisition` block carries the R8 fields
    # (`jurisdiction`, `jurisdiction_source`, `jurisdiction_evidence_status`,
    # `acquisition_date`, `acquisition_tax_override_pence`,
    # `acquisition_tax_override_reason`) defined on
    # `app.financial_model.types.AcquisitionInputsV5`; a v6 document adds the R9
    # `areas` block and a per-unit `ancillary` block, defined on
    # `AreaBridgeInputs` / `UnitAncillary` in the same module; a v7 document
    # adds the R10 `cost_plan` block (mode, package schedule, three
    # contingency classes, fee lines), defined on `CostPlanInputs` in the same
    # module; a v8 document adds the R11 `vat` block (registered, return
    # cycle, six per-category treatment rows, the purchase/TOGC block, and an
    # optional `vat_override` on each cost package and fee line), defined on
    # `VatInputs` in the same module; a v9 document replaces the three-package
    # `programme` with a precedence network (phases, dependencies, derived
    # windows) and adds the per-line `phase_id`, the per-scenario
    # `phase_slip` lever and the per-tranche/per-refinance `anchor`, defined
    # on `ProgrammeNetwork` / `CalculatorInputsV9` in the same module; a v10
    # document (R13, spec Sec 19) adds the top-level, two-state
    # `investment_case` block (null = calc 2.11.0's explicit
    # investment_value_pence x ltv_pct path; non-null = the derived case) and
    # narrows `refinance.investment_value_pence`/`ltv_pct` to nullable,
    # defined on `InvestmentCaseInputs` / `RefinanceInputsV10` /
    # `CalculatorInputsV10` in the same module; a v11 document (R14, spec Sec
    # 20) adds the top-level nullable `monitoring` block, defined on
    # `MonitoringInputs` / `CalculatorInputsV11`; a v12 document (R13b, spec
    # Sec 22) adds the top-level nullable `unit_sales` block -- a per-unit
    # sales ledger recording each unit's disposal month and price, defined on
    # `UnitSalesInputs` / `CalculatorInputsV12` in the same module; a v16
    # document (R16b, spec Sec 26.1) REMOVES conversion_costs.contingency_pct
    # and the eight legacy fee fields, defined on `ConversionCostInputsV16` /
    # `CalculatorInputsV16` in the same module. Those are the typed schemas
    # the fields are actually enforced against.
    inputs_snapshot: dict
    # optional client-computed values, used ONLY for mismatch recording -- the
    # server always recalculates and never trusts these for persistence:
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None


class FinancialAppraisalUpdate(FinancialAppraisalCreate):
    project_id: uuid.UUID | None = None
    name: str | None = None
    inputs_snapshot: dict | None = None


class FinancialAppraisal(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict
    outputs: dict | None = None            # authoritative AppraisalResultV2 + reconciliation
    validation: dict | None = None         # {issues, client_mismatches}
    calc_version: str | None = None
    inputs_version: int = 1
    status: str = "draft"                  # draft | reconciled | legacy_unreconciled
    input_hash: str | None = None
    outputs_hash: str | None = None
    audit_hash: str | None = None          # spec Sec 13.2
    created_at: datetime
    updated_at: datetime


# --- Appraisal versions and the governed resave (R17, spec Sec 11) ---


class AppraisalVersion(BaseModel):
    """One pre-save state of a financial_appraisals row (appraisal_versions).
    Written by every ordinary save (`reason: 'save'`) and by the governed
    resave (`reason: 'governed_resave'`); the snapshot is stored as it was,
    byte for byte, never migrated."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    appraisal_id: uuid.UUID
    reason: str
    inputs_snapshot: dict
    outputs: dict | None = None
    validation: dict | None = None
    calc_version: str | None = None
    inputs_version: int | None = None
    status: str | None = None
    input_hash: str | None = None
    outputs_hash: str | None = None
    audit_hash: str | None = None
    superseded_at: datetime
    superseded_by_user_id: uuid.UUID | None = None
    superseded_by: str | None = None


class AppraisalResaveResponse(FinancialAppraisal):
    """The resaved row plus the id of the appraisal_versions row that holds
    the state it replaced."""

    previous_version_id: uuid.UUID


class StaleAppraisal(BaseModel):
    """A stored appraisal whose inputs_version or calc_version is behind the
    server's (spec Sec 11, `GET /appraisals/stale`)."""

    project_id: uuid.UUID
    project_address: str
    appraisal_id: uuid.UUID
    name: str
    inputs_version: int
    calc_version: str | None = None
    status: str | None = None
    updated_at: datetime
    current_inputs_version: int
    current_calc_version: str


# --- Lender Case (R14b, spec Sec 21) ---


class LenderCaseCreate(BaseModel):
    # R17 (spec Sec 21.1 amended, design Sec 10.2): the actor is the
    # authenticated user, never a client-supplied name. A sent `created_by`
    # is a 422 -- extra='forbid' -- rather than silently ignored, so a client
    # still on the R14b shape learns it is wrong instead of believing its name
    # was recorded.
    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID


def _idempotency_key_no_separator(v: str) -> str:
    if "|" in v or any(ord(c) < 32 for c in v):
        raise ValueError("idempotency_key may not contain '|' or control characters")
    return v


class LenderCaseTransition(BaseModel):
    # R17 (spec Sec 21.5 amended, design Sec 10.2/10.4). `actor` is gone: the
    # server writes the authenticated user's display name. A sent `actor` is
    # a 422 (extra='forbid'), for the same reason as LenderCaseCreate.
    model_config = ConfigDict(extra="forbid")

    to_status: str
    note: str | None = Field(default=None, max_length=10_000)
    # Required for approved_with_conditions, forbidden otherwise (Sec 21.2).
    conditions: str | None = Field(default=None, max_length=10_000)
    # Free-text reason for the change log (Sec 21.5); never on the case.
    reason: str | None = Field(default=None, max_length=10_000)
    # Optimistic concurrency (Sec 21.5): the version and case_hash the client
    # last read. Either differing from the row is a 409.
    expected_version: int = Field(ge=1)
    expected_case_hash: str = Field(min_length=64, max_length=64)
    # Client-minted per confirmation; a repeat with the same to_status is a
    # no-op 200, with a different one a 409.
    idempotency_key: str = Field(min_length=1, max_length=64)

    @field_validator("idempotency_key")
    @classmethod
    def _key_no_separator(cls, v: str) -> str:
        return _idempotency_key_no_separator(v)


class LenderCase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    status: str
    locked_inputs_snapshot: dict
    locked_calc_version: str
    locked_inputs_version: int
    locked_input_hash: str
    locked_outputs_hash: str
    locked_audit_hash: str
    case_hash: str                         # spec Sec 21.4
    created_by: str
    submitted_by: str | None = None
    reviewer: str | None = None
    decided_by: str | None = None
    conditions: str | None = None
    submitted_at: datetime | None = None
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    # --- R17 (spec Sec 21.1 amended): the version counter and the user id
    # behind each display name. The names stay (case_hash components); the
    # ids are nullable because pre-R17 rows have none (a "legacy case").
    version: int = 1
    created_by_user_id: uuid.UUID | None = None
    submitted_by_user_id: uuid.UUID | None = None
    reviewer_user_id: uuid.UUID | None = None
    decided_by_user_id: uuid.UUID | None = None


class LenderCaseRead(LenderCase):
    """The API read shape: the stored case plus the derived staleness --
    computed at read time against the live appraisal row, never stored
    (spec Sec 21.3)."""

    stale: bool


class LenderCaseEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_id: uuid.UUID
    from_status: str | None = None
    to_status: str
    actor: str
    note: str | None = None
    occurred_at: datetime
    # --- R17 (spec Sec 21.5 amended): who, why, and the state the write
    # left behind. Nullable: pre-R17 events carry none of these.
    actor_user_id: uuid.UUID | None = None
    idempotency_key: str | None = None
    reason: str | None = None
    input_snapshot_hash: str | None = None
    outputs_hash: str | None = None
    case_hash_after: str | None = None
    case_version_after: int | None = None


# --- Stage Transition ---


class StageTransitionCreate(BaseModel):
    project_id: uuid.UUID
    from_stage: PipelineStage | None = None
    to_stage: PipelineStage
    notes: str | None = None


class StageTransition(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    from_stage: PipelineStage | None = None
    to_stage: PipelineStage
    notes: str | None = None
    transitioned_at: datetime


class StageTransitionResponse(BaseModel):
    """API shape for GET /projects/{id}/transitions (created_at = transitioned_at)."""

    id: uuid.UUID
    project_id: uuid.UUID
    from_stage: PipelineStage | None = None
    to_stage: PipelineStage
    notes: str | None = None
    created_at: datetime
