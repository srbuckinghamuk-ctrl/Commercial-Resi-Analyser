"""Core domain models for the Commercial-Resi Analyser."""
import uuid
from datetime import datetime
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
    postcode: str
    flood_zone: str
    flood_zone_numeric: int
    in_flood_zone_2_or_3: bool
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


class Article4DirectionResponse(BaseModel):
    name: str
    pdr_classes_restricted: list[str]
    date_made: str | None = None
    coverage: str = ""


class Article4Response(BaseModel):
    lpa_code: str
    lpa_name: str
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


class EligibilityAssessmentCreate(BaseModel):
    project_id: uuid.UUID
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = Field(default_factory=list)
    notes: str | None = None


class EligibilityAssessmentUpdate(BaseModel):
    criteria: list[EligibilityCriterion] | None = None
    verdict: EligibilityVerdict | None = None
    suggested_next_steps: list[str] | None = None
    notes: str | None = None


class EligibilityAssessment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = Field(default_factory=list)
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


# --- Financial Appraisal ---


class FinancialAppraisalCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None


class FinancialAppraisalUpdate(BaseModel):
    name: str | None = None
    inputs_snapshot: dict | None = None
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None


class FinancialAppraisal(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict
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
