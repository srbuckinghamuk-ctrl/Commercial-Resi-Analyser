import type { AppraisalResultV2, ReconciliationStatus, ValidationIssue } from './lib/model';

export type UseClass =
  | 'office'
  | 'retail'
  | 'light_industrial'
  | 'restaurant_cafe'
  | 'takeaway'
  | 'amusement'
  | 'launderette'
  | 'agricultural'
  | 'sui_generis'
  | 'other'
  | 'unknown';

export type PdrClass = 'class_ma' | 'class_g' | 'class_m' | 'class_n' | 'class_q';

export type PipelineStage =
  | 'opportunity_identified'
  | 'eligibility_assessed'
  | 'financial_appraisal'
  | 'prior_approval_submitted'
  | 'approved'
  | 'in_conversion'
  | 'complete';

export type EligibilityVerdict = 'green' | 'amber' | 'red';

export type Tenure = 'freehold' | 'leasehold' | 'unknown';

export type ScrapeStatus = 'idle' | 'loading' | 'success' | 'error';

export const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'opportunity_identified', label: 'Opportunity Identified' },
  { value: 'eligibility_assessed', label: 'Eligibility Assessed' },
  { value: 'financial_appraisal', label: 'Financial Appraisal' },
  { value: 'prior_approval_submitted', label: 'Prior Approval Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_conversion', label: 'In Conversion' },
  { value: 'complete', label: 'Complete' },
] as const;

export const USE_CLASS_OPTIONS: { value: UseClass; label: string }[] = [
  { value: 'office', label: 'Office (E(a))' },
  { value: 'retail', label: 'Retail (E(a))' },
  { value: 'light_industrial', label: 'Light Industrial (E(g))' },
  { value: 'restaurant_cafe', label: 'Restaurant/Café (E(b))' },
  { value: 'takeaway', label: 'Takeaway (sui generis)' },
  { value: 'amusement', label: 'Amusement (sui generis)' },
  { value: 'launderette', label: 'Launderette (sui generis)' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'sui_generis', label: 'Sui Generis (other)' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export const TENURE_OPTIONS: { value: Tenure; label: string }[] = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export interface Project {
  id: string;
  address_raw: string;
  address_line1: string | null;
  address_line2: string | null;
  address_town: string | null;
  address_county: string | null;
  address_postcode: string | null;
  address_postcode_district: string | null;
  price_pence: number;
  price_qualifier: string | null;
  use_class: UseClass;
  floor_area_sqft: number | null;
  floor_area_sqm: number | null;
  floors: number | null;
  tenure: Tenure;
  lease_years_remaining: number | null;
  current_use_description: string | null;
  epc_rating: string | null;
  is_vacant: boolean | null;
  vacancy_date: string | null;
  source_url: string | null;
  source_name: string | null;
  description: string | null;
  image_urls: string[];
  stage: PipelineStage;
  /** ISO date the prior approval application was submitted (starts the 56-day clock). */
  pa_submitted_date: string | null;
  /** ISO date prior approval was granted (starts the 3-year completion window). */
  pa_decision_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  address_raw: string;
  address_line1?: string;
  address_line2?: string;
  address_town?: string;
  address_county?: string;
  address_postcode?: string;
  address_postcode_district?: string;
  price_pence: number;
  price_qualifier?: string;
  use_class: UseClass;
  floor_area_sqft?: number;
  floor_area_sqm?: number;
  floors?: number;
  tenure?: Tenure;
  lease_years_remaining?: number;
  current_use_description?: string;
  epc_rating?: string;
  is_vacant?: boolean;
  vacancy_date?: string;
  source_url?: string;
  source_name?: string;
  description?: string;
  image_urls?: string[];
}

export interface ProjectUpdate {
  [key: string]: unknown;
}

export interface EligibilityCriterion {
  key: string;
  label: string;
  passed: boolean | null;
  source: string | null;
  auto_checked: boolean;
  value: string | null;
  risk_flag: string | null;
  /** "statutory" = failing removes the PDR route; "prior_approval" = approvability risk. */
  category?: 'statutory' | 'prior_approval';
}

export interface EligibilityAssessment {
  id: string;
  project_id: string;
  pdr_class: PdrClass;
  criteria: EligibilityCriterion[];
  verdict: EligibilityVerdict;
  suggested_next_steps: string[];
  notes: string | null;
  /** Version of the eligibility ruleset that produced this assessment. */
  ruleset_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface EligibilityAssessmentCreate {
  project_id: string;
  pdr_class: PdrClass;
  criteria: EligibilityCriterion[];
  verdict: EligibilityVerdict;
  suggested_next_steps?: string[];
  notes?: string;
}

export type AppraisalStatus = 'draft' | 'reconciled' | 'legacy_unreconciled';

export interface AppraisalClientMismatch {
  field: string;
  client: number | null;
  server: number | null;
}

export interface AppraisalOutputs {
  metrics: AppraisalResultV2;
  reconciliation: ReconciliationStatus;
}

export interface AppraisalValidation {
  issues: ValidationIssue[];
  client_mismatches: AppraisalClientMismatch[];
}

export interface FinancialAppraisal {
  id: string;
  project_id: string;
  name: string;
  inputs_snapshot: Record<string, unknown>;
  // authoritative server outputs (Task 12) -- null only for pre-migration
  // records that predate server-side recalculation:
  outputs?: AppraisalOutputs | null;
  validation?: AppraisalValidation | null;
  calc_version?: string | null;
  inputs_version?: number;
  status?: AppraisalStatus;
  input_hash?: string | null;
  outputs_hash?: string | null;
  // legacy columns retained for backward-compat; server-computed even when
  // `outputs` is present -- prefer `outputs.metrics` for display:
  gdv_pence: number | null;
  total_cost_pence: number | null;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  return_on_equity_pct: number | null;
  irr: number | null;
  rlv_pence: number | null;
  created_at: string;
  updated_at: string;
}

export interface FinancialAppraisalCreate {
  project_id: string;
  name: string;
  inputs_snapshot: Record<string, unknown>;
  gdv_pence?: number;
  total_cost_pence?: number;
  profit_on_cost_pct?: number;
  profit_on_gdv_pct?: number;
  return_on_equity_pct?: number;
  irr?: number | null;
  rlv_pence?: number;
}

export interface StageTransition {
  id: string;
  project_id: string;
  from_stage: PipelineStage | null;
  to_stage: PipelineStage;
  notes: string | null;
  created_at: string;
}

export interface CommercialListing {
  id: string;
  address: {
    raw: string;
    line1: string | null;
    line2: string | null;
    town: string | null;
    county: string | null;
    postcode: string | null;
    postcode_district: string | null;
  };
  price: {
    amount: number;
    currency: string;
    qualifier: string | null;
  };
  use_class: UseClass;
  floor_area_sqft: number | null;
  floor_area_sqm: number | null;
  floors: number | null;
  tenure: Tenure;
  lease_years_remaining: number | null;
  current_use_description: string | null;
  epc_rating: string | null;
  is_vacant: boolean | null;
  vacancy_date: string | null;
  source_url: string;
  source_name: string;
  auction: {
    house: string | null;
    lot_number: string | null;
    date: string | null;
    venue: string | null;
    online_bidding: boolean | null;
  } | null;
  image_urls: string[];
  description: string | null;
  created_at: string;
}

export interface ApiResponse {
  listing: CommercialListing | null;
  error: string | null;
}

export interface PostcodeLookup {
  postcode: string;
  latitude: number;
  longitude: number;
  lpa_name: string;
  lpa_code: string;
  region: string;
  country: string;
  admin_district: string;
}

export interface FloodRisk {
  postcode: string;
  flood_zone: string;
  flood_zone_numeric: number;
  in_flood_zone_2_or_3: boolean;
  source: string;
}

export interface EpcData {
  address: string;
  postcode: string;
  rating: string;
  score: number;
  certificate_date: string;
  certificate_url: string;
  property_type: string;
  floor_area_sqm: number | null;
}

export interface Article4DirectionItem {
  name: string;
  pdr_classes_restricted: string[];
  date_made: string | null;
  coverage: string;
}

export interface Article4Data {
  lpa_code: string;
  lpa_name: string;
  has_article4: boolean;
  directions: Article4DirectionItem[];
  note: string;
}

export interface EligibilityRunRequest {
  manual_overrides: Record<string, boolean | null>;
}

export interface EligibilityRunResponse {
  assessment: EligibilityAssessment;
  auto_checks_performed: string[];
  manual_checks_pending: string[];
}
