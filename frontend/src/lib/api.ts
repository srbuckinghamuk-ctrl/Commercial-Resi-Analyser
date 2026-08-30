import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  EligibilityAssessment,
  EligibilityAssessmentCreate,
  FinancialAppraisal,
  FinancialAppraisalCreate,
  ApiResponse,
  PipelineStage,
  StageTransition,
  PostcodeLookup,
  FloodRisk,
  EpcData,
  Article4Data,
  EligibilityRunResponse,
  LenderCase,
  LenderCaseEvent,
  LenderCaseTransitionBody,
  AuthUser,
  LoginResponse,
  AppraisalVersion,
  ResaveAppraisalResponse,
  StaleAppraisal,
  BenchmarkSetHeader,
  BenchmarkSetDocument,
  IndexDatasetHeader,
  IndexDatasetDocument,
} from '../types';

// --- Bearer token (R17, design §10.6) ---
//
// A module-level store rather than React state so that `request()` -- and
// every caller of it -- sends `Authorization: Bearer …` on every call without
// threading the token through each function. AuthProvider (lib/auth.tsx) is
// the only writer; it sets the token on login/restore and clears it on logout.

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token && token.length > 0 ? token : null;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** The Authorization header alone (for multipart requests, whose
 *  Content-Type the browser must set with its boundary). */
function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

/** JSON headers plus the bearer token when one is set. A function, not a
 *  constant: the token changes over the page's life. */
function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

/**
 * Thrown for any non-2xx response. `detail` carries the parsed body's
 * `detail` field when present (FastAPI's convention for 422/404 errors --
 * either a list of Pydantic error objects or a list of validation issue
 * dicts `{severity, field, message}`), otherwise the parsed/raw body.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** True when the error represents an HTTP 404 -- a missing record, not a failure. */
export function isNotFound(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 404;
  return e instanceof Error && e.message.startsWith('HTTP 404');
}

/** Renders an ApiError's `detail` (Pydantic errors, validation issues, or a
 * plain string) as human-readable, field-prefixed lines for display. */
export function formatApiErrorDetail(detail: unknown): string[] {
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (typeof rec.field === 'string' && typeof rec.message === 'string') {
          return `${rec.field}: ${rec.message}`;
        }
        if (Array.isArray(rec.loc) && typeof rec.msg === 'string') {
          return `${rec.loc.join('.')}: ${rec.msg}`;
        }
      }
      return typeof item === 'string' ? item : JSON.stringify(item);
    });
  }
  if (typeof detail === 'string' && detail.length > 0) return [detail];
  if (detail == null) return [];
  return [JSON.stringify(detail)];
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // The bearer token rides on every request, whatever headers the caller
  // supplied; a caller's explicit Authorization (none today) would win.
  const init: RequestInit = {
    ...options,
    headers: { ...authHeaders(), ...((options?.headers as Record<string, string> | undefined) ?? {}) },
  };
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    let detail: unknown;
    try {
      const parsed = JSON.parse(text);
      detail =
        parsed && typeof parsed === 'object' && 'detail' in parsed
          ? (parsed as { detail: unknown }).detail
          : parsed;
    } catch {
      detail = text || undefined;
    }
    throw new ApiError(response.status, `HTTP ${response.status}: ${text}`, detail);
  }
  if (response.status === 204) return undefined as T;
  // The SPA static-file mount can answer an unmatched API path with index.html
  // and a 200. Refuse to parse it so the failure is reported honestly rather
  // than surfacing as opaque JSON-parse noise.
  const contentType = response.headers?.get?.('content-type');
  if (contentType != null && !contentType.includes('json')) {
    throw new Error(`Unexpected non-JSON response from the API (${contentType})`);
  }
  return response.json() as Promise<T>;
}

// --- Projects ---

export async function createProject(data: ProjectCreate): Promise<Project> {
  return request<Project>('/api/v1/projects', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>('/api/v1/projects', { headers: headers() });
}

export async function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}`, { headers: headers() });
}

export async function updateProject(id: string, data: ProjectUpdate): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/v1/projects/${id}`, { method: 'DELETE', headers: headers() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
}

export async function changeStage(
  id: string,
  toStage: PipelineStage,
  notes?: string,
): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}/stage`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ to_stage: toStage, notes }),
  });
}

export async function listTransitions(projectId: string): Promise<StageTransition[]> {
  return request<StageTransition[]>(`/api/v1/projects/${projectId}/transitions`, {
    headers: headers(),
  });
}

// --- Eligibility ---

export async function createEligibility(
  projectId: string,
  data: EligibilityAssessmentCreate,
): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

export async function getEligibility(projectId: string): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    headers: headers(),
  });
}

export async function updateEligibility(
  projectId: string,
  data: Partial<EligibilityAssessmentCreate>,
): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

// --- Appraisals ---

export async function createAppraisal(data: FinancialAppraisalCreate): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>('/api/v1/appraisals', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

export async function getAppraisal(projectId: string): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>(`/api/v1/appraisals/${projectId}`, {
    headers: headers(),
  });
}

export async function updateAppraisal(
  projectId: string,
  data: Partial<FinancialAppraisalCreate>,
): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>(`/api/v1/appraisals/${projectId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

/**
 * Save flow entry point: creates the project's first appraisal (POST) or
 * migrates/recalculates the existing one (PUT) when `existingId` is set.
 * Either path returns the full server-authoritative record -- outputs,
 * validation, status, and hashes are always recomputed server-side (Task 12).
 */
export async function saveAppraisal(
  projectId: string,
  data: FinancialAppraisalCreate,
  existingId?: string | null,
): Promise<FinancialAppraisal> {
  return existingId ? updateAppraisal(projectId, data) : createAppraisal(data);
}

// --- Scrape ---

export async function scrapeUrl(url: string): Promise<ApiResponse> {
  return request<ApiResponse>('/api/v1/scrape-url', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ url }),
  });
}

// --- Lookups ---

export async function lookupPostcode(postcode: string): Promise<PostcodeLookup> {
  return request<PostcodeLookup>(
    `/api/v1/lookup/postcode/${encodeURIComponent(postcode)}`,
    { headers: headers() },
  );
}

export async function lookupFlood(postcode: string): Promise<FloodRisk> {
  return request<FloodRisk>(
    `/api/v1/lookup/flood/${encodeURIComponent(postcode)}`,
    { headers: headers() },
  );
}

export async function lookupEpc(postcode: string, address?: string): Promise<EpcData> {
  const params = address ? `?address=${encodeURIComponent(address)}` : '';
  return request<EpcData>(
    `/api/v1/lookup/epc/${encodeURIComponent(postcode)}${params}`,
    { headers: headers() },
  );
}

export async function lookupArticle4(lpaCode: string): Promise<Article4Data> {
  return request<Article4Data>(
    `/api/v1/lookup/article4/${encodeURIComponent(lpaCode)}`,
    { headers: headers() },
  );
}

// --- Eligibility Engine ---

export async function runEligibility(
  projectId: string,
  manualOverrides: Record<string, boolean | null>,
): Promise<EligibilityRunResponse> {
  return request<EligibilityRunResponse>(`/api/v1/eligibility/${projectId}/run`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ manual_overrides: manualOverrides }),
  });
}

// --- Lender Cases (R14b, spec §21) ---

export async function getLenderCase(projectId: string): Promise<LenderCase | null> {
  return request<LenderCase | null>(`/api/v1/lender-cases/${projectId}`, { headers: headers() });
}

/** R17 (design §10.2): `{project_id}` only -- the actor is the bearer
 *  token's user. A `created_by` would be a 422. */
export async function createLenderCase(projectId: string): Promise<LenderCase> {
  return request<LenderCase>('/api/v1/lender-cases', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ project_id: projectId }),
  });
}

/** R17 (design §10.2/10.4): the body carries the concurrency comparands and
 *  the per-confirmation idempotency key; no `actor`. Undefined optional
 *  fields are dropped by JSON.stringify, so `note`/`conditions`/`reason` are
 *  only sent when given. */
export async function transitionLenderCase(
  projectId: string,
  data: LenderCaseTransitionBody,
): Promise<LenderCase> {
  return request<LenderCase>(`/api/v1/lender-cases/${projectId}/transition`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(data),
  });
}

export async function listLenderCaseHistory(projectId: string): Promise<LenderCase[]> {
  return request<LenderCase[]>(`/api/v1/lender-cases/${projectId}/history`, { headers: headers() });
}

export async function listLenderCaseEvents(projectId: string): Promise<LenderCaseEvent[]> {
  return request<LenderCaseEvent[]>(`/api/v1/lender-cases/${projectId}/events`, { headers: headers() });
}

// --- Authentication (R17, design §10.1) ---

export async function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password }),
  });
}

/** The bearer token's user; 401 (ApiError) when there is no valid token. */
export async function me(): Promise<AuthUser> {
  return request<AuthUser>('/api/v1/auth/me', { headers: headers() });
}

/** 204 -- tokens are stateless; the client drops its copy (design §10.1). */
export async function logout(): Promise<void> {
  return request<void>('/api/v1/auth/logout', { method: 'POST', headers: headers() });
}

// --- Appraisal versions and the governed resave (R17, design §11) ---

/** Authenticated, any role: migrates the stored row to the current inputs
 *  version, recalculates, and keeps the previous state as a version row. */
export async function resaveAppraisal(projectId: string): Promise<ResaveAppraisalResponse> {
  return request<ResaveAppraisalResponse>(`/api/v1/appraisals/${projectId}/resave`, {
    method: 'POST',
    headers: headers(),
  });
}

export async function listAppraisalVersions(projectId: string): Promise<AppraisalVersion[]> {
  return request<AppraisalVersion[]>(`/api/v1/appraisals/${projectId}/versions`, { headers: headers() });
}

/** Every stored row whose inputs_version or calc_version is behind the server's. */
export async function listStaleAppraisals(): Promise<StaleAppraisal[]> {
  return request<StaleAppraisal[]>('/api/v1/appraisals/stale', { headers: headers() });
}

// --- Benchmark sets and index datasets (R17, spec §27.6; app/benchmarks/router.py) ---
//
// Every route is authenticated; imports need administrator or underwriter.
// There is no PUT or DELETE: sets and dataset versions are immutable.

export async function listBenchmarkSets(): Promise<BenchmarkSetHeader[]> {
  return request<BenchmarkSetHeader[]>('/api/v1/benchmark-sets', { headers: headers() });
}

/** The set document; with BOTH `currentisationDate` (ISO date) and
 *  `currentIndexValue` the server adds `currentised` -- a derived read that
 *  writes nothing. One without the other is a 422 from the server. */
export async function getBenchmarkSet(
  id: string,
  opts: { currentisationDate?: string; currentIndexValue?: number } = {},
): Promise<BenchmarkSetDocument> {
  const params = new URLSearchParams();
  if (opts.currentisationDate != null) params.set('currentisation_date', opts.currentisationDate);
  if (opts.currentIndexValue != null) params.set('current_index_value', String(opts.currentIndexValue));
  const query = params.toString();
  return request<BenchmarkSetDocument>(
    `/api/v1/benchmark-sets/${encodeURIComponent(id)}${query ? `?${query}` : ''}`,
    { headers: headers() },
  );
}

/** JSON import: an ElementalBenchmarkSet document without id/created_at/content_hash. */
export async function importBenchmarkSet(doc: Record<string, unknown>): Promise<BenchmarkSetDocument> {
  return request<BenchmarkSetDocument>('/api/v1/benchmark-sets', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(doc),
  });
}

/** Multipart import: the template-column CSV plus the header fields as a
 *  JSON object in the `header` form field. No Content-Type header: the
 *  browser sets multipart/form-data with its boundary. */
export async function importBenchmarkSetCsv(
  file: File | Blob,
  header: Record<string, unknown>,
): Promise<BenchmarkSetDocument> {
  const form = new FormData();
  form.append('file', file);
  form.append('header', JSON.stringify(header));
  return request<BenchmarkSetDocument>('/api/v1/benchmark-sets/import-csv', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
}

/** The import template's path. The route is authenticated, so a bare
 *  `<a href>` will 401 -- fetch it with `fetchBenchmarkTemplate` and hand the
 *  text to the user instead. */
export const benchmarkTemplateUrl = '/api/v1/benchmark-sets/template.csv';

export async function fetchBenchmarkTemplate(): Promise<string> {
  const response = await fetch(benchmarkTemplateUrl, { headers: authHeaders() });
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}: ${text}`, text || undefined);
  return text;
}

export async function listIndexDatasets(): Promise<IndexDatasetHeader[]> {
  return request<IndexDatasetHeader[]>('/api/v1/index-datasets', { headers: headers() });
}

export async function getIndexDataset(id: string): Promise<IndexDatasetDocument> {
  return request<IndexDatasetDocument>(`/api/v1/index-datasets/${encodeURIComponent(id)}`, { headers: headers() });
}

/** JSON `{publisher, series_code, series_name?, dataset_version, source_url,
 *  licence, publication_date?, retrieved_at, base_period, notes?,
 *  observations: [{period, value}]}`. */
export async function importIndexDataset(doc: Record<string, unknown>): Promise<IndexDatasetDocument> {
  return request<IndexDatasetDocument>('/api/v1/index-datasets', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(doc),
  });
}
