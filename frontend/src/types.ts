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
  /** Spec Sec 13.2 -- binds the stored result to its inputs, model version and
   *  governance status. Null on rows saved before the field existed. */
  audit_hash?: string | null;
  created_at: string;
  updated_at: string;
}

/** Where a lender case has reached (R14b, spec §21). Canonical here;
 *  report-provenance.ts re-exports it so existing importers are unmoved. */
export type LenderCaseStatus =
  | 'draft' | 'submitted' | 'under_review' | 'information_required'
  | 'credit_approved' | 'approved_with_conditions' | 'declined' | 'superseded';

/** A lender case as the API returns it: the locked snapshot, its hashes, the
 *  governance fields, and `stale` — derived server-side on every read (spec
 *  §21.3), never stored. */
export interface LenderCase {
  id: string;
  project_id: string;
  status: LenderCaseStatus;
  locked_inputs_snapshot: Record<string, unknown>;
  locked_calc_version: string;
  locked_inputs_version: number;
  locked_input_hash: string;
  locked_outputs_hash: string;
  locked_audit_hash: string;
  case_hash: string;
  created_by: string;
  submitted_by: string | null;
  reviewer: string | null;
  decided_by: string | null;
  conditions: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  stale: boolean;
  created_at: string;
  updated_at: string;
  /** R17 (spec §21.1 amended, design §10.2): the optimistic-concurrency
   *  counter (starts at 1, +1 per write) and the user id behind each display
   *  name. The server always sends `version`; it is optional here only so
   *  pre-R17 fixtures still type-check. The ids are null on legacy rows. */
  version?: number;
  created_by_user_id?: string | null;
  submitted_by_user_id?: string | null;
  reviewer_user_id?: string | null;
  decided_by_user_id?: string | null;
}

/** One row of the append-only change log (spec §21.5). Integer id — the
 *  server's deterministic newest-first order key. */
export interface LenderCaseEvent {
  id: number;
  case_id: string;
  from_status: LenderCaseStatus | null;
  to_status: LenderCaseStatus;
  actor: string;
  note: string | null;
  occurred_at: string;
  /** R17 (spec §21.5 amended): who, why, and the state the write left
   *  behind. Null on pre-R17 events. */
  actor_user_id?: string | null;
  idempotency_key?: string | null;
  reason?: string | null;
  input_snapshot_hash?: string | null;
  outputs_hash?: string | null;
  case_hash_after?: string | null;
  case_version_after?: number | null;
}

/** R17 (design §10.2): the transition request. `actor` is gone -- the server
 *  writes the authenticated user's name; `expected_version` and
 *  `expected_case_hash` are the values of the last GET; `idempotency_key` is
 *  minted per confirmation and reused on a retry of that same confirmation. */
export interface LenderCaseTransitionBody {
  to_status: LenderCaseStatus;
  note?: string;
  conditions?: string;
  reason?: string;
  expected_version: number;
  expected_case_hash: string;
  idempotency_key: string;
}

// --- Authentication (R17, design §10.1) ---

export type UserRole = 'developer' | 'broker' | 'underwriter' | 'credit_approver' | 'administrator';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// --- Appraisal versions (R17, design §11) ---

/** A pre-save or pre-resave copy of a stored appraisal. */
export interface AppraisalVersion {
  id: string;
  appraisal_id?: string;
  project_id: string;
  reason: 'save' | 'governed_resave' | string;
  inputs_snapshot?: Record<string, unknown>;
  calc_version?: string | null;
  inputs_version?: number | null;
  outputs?: AppraisalOutputs | null;
  input_hash?: string | null;
  outputs_hash?: string | null;
  audit_hash?: string | null;
  superseded_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

/** `POST /appraisals/{project_id}/resave`: the new row plus the id of the
 *  version row that holds its previous state. */
export type ResaveAppraisalResponse = FinancialAppraisal & { previous_version_id: string | null };

/** `GET /appraisals/stale`: a stored row whose versions are behind the server's. */
export interface StaleAppraisal {
  id?: string;
  project_id: string;
  calc_version?: string | null;
  inputs_version?: number | null;
  [key: string]: unknown;
}

// --- Benchmark sets and index datasets (R17, spec §27.6) ---

/** The header of an elemental benchmark set as `GET /benchmark-sets` lists it
 *  (everything but `rates`). The document adds `rates` and, when the derived
 *  read was asked for, `currentised`. Kept loose: the server owns the shape. */
export interface BenchmarkSetHeader {
  id: string;
  provider_type: string;
  dataset_version: string;
  content_hash?: string | null;
  imported_by?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface BenchmarkSetDocument extends BenchmarkSetHeader {
  rates: Record<string, unknown>[];
  currentised?: unknown;
}

export interface IndexDatasetHeader {
  id: string;
  publisher: string;
  series_code: string;
  series_name: string | null;
  dataset_version: string;
  source_url: string | null;
  licence: string | null;
  publication_date: string | null;
  retrieved_at: string | null;
  base_period: string | null;
  source_file_sha256: string | null;
  content_hash: string | null;
  imported_by: string | null;
  imported_by_user_id: string | null;
  notes: string | null;
  created_at: string | null;
  observation_count: number;
  first_period: string | null;
  last_period: string | null;
}

export interface IndexObservation { period: string; value: number }

export interface IndexDatasetDocument extends IndexDatasetHeader {
  observations: IndexObservation[];
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
