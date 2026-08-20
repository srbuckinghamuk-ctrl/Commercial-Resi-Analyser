"""Core domain models for the Commercial-Resi Analyser."""
import uuid
from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


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
    # migrate_inputs_to_v7, not by this schema) -- may be any of v1 through
    # v7. A v5+ document's `acquisition` block carries the R8 fields
    # (`jurisdiction`, `jurisdiction_source`, `jurisdiction_evidence_status`,
    # `acquisition_date`, `acquisition_tax_override_pence`,
    # `acquisition_tax_override_reason`) defined on
    # `app.financial_model.types.AcquisitionInputsV5`; a v6 document adds the R9
    # `areas` block and a per-unit `ancillary` block, defined on
    # `AreaBridgeInputs` / `UnitAncillary` in the same module; a v7 document
    # adds the R10 `cost_plan` block (mode, package schedule, three
    # contingency classes, fee lines), defined on `CostPlanInputs` in the same
    # module. Those are the typed schemas the fields are actually enforced
    # against.
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
    # legacy columns retained for backward-compat, now always server-computed:
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None
    created_at: datetime
    updated_at: datetime


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
