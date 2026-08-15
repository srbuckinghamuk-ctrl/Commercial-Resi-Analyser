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
  PostcodeLookup,
  FloodRisk,
  EpcData,
  Article4Data,
  EligibilityRunResponse,
} from '../types';

const HEADERS = { 'Content-Type': 'application/json' };

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
  const response = await fetch(url, options);
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
  return response.json() as Promise<T>;
}

// --- Projects ---

export async function createProject(data: ProjectCreate): Promise<Project> {
  return request<Project>('/api/v1/projects', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>('/api/v1/projects', { headers: HEADERS });
}

export async function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}`, { headers: HEADERS });
}

export async function updateProject(id: string, data: ProjectUpdate): Promise<Project> {
  return request<Project>(`/api/v1/projects/${id}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/v1/projects/${id}`, { method: 'DELETE', headers: HEADERS });
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
    headers: HEADERS,
    body: JSON.stringify({ to_stage: toStage, notes }),
  });
}

// --- Eligibility ---

export async function createEligibility(
  projectId: string,
  data: EligibilityAssessmentCreate,
): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function getEligibility(projectId: string): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    headers: HEADERS,
  });
}

export async function updateEligibility(
  projectId: string,
  data: Partial<EligibilityAssessmentCreate>,
): Promise<EligibilityAssessment> {
  return request<EligibilityAssessment>(`/api/v1/eligibility/${projectId}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

// --- Appraisals ---

export async function createAppraisal(data: FinancialAppraisalCreate): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>('/api/v1/appraisals', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function getAppraisal(projectId: string): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>(`/api/v1/appraisals/${projectId}`, {
    headers: HEADERS,
  });
}

export async function updateAppraisal(
  projectId: string,
  data: Partial<FinancialAppraisalCreate>,
): Promise<FinancialAppraisal> {
  return request<FinancialAppraisal>(`/api/v1/appraisals/${projectId}`, {
    method: 'PUT',
    headers: HEADERS,
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
    headers: HEADERS,
    body: JSON.stringify({ url }),
  });
}

// --- Lookups ---

export async function lookupPostcode(postcode: string): Promise<PostcodeLookup> {
  return request<PostcodeLookup>(
    `/api/v1/lookup/postcode/${encodeURIComponent(postcode)}`,
    { headers: HEADERS },
  );
}

export async function lookupFlood(postcode: string): Promise<FloodRisk> {
  return request<FloodRisk>(
    `/api/v1/lookup/flood/${encodeURIComponent(postcode)}`,
    { headers: HEADERS },
  );
}

export async function lookupEpc(postcode: string, address?: string): Promise<EpcData> {
  const params = address ? `?address=${encodeURIComponent(address)}` : '';
  return request<EpcData>(
    `/api/v1/lookup/epc/${encodeURIComponent(postcode)}${params}`,
    { headers: HEADERS },
  );
}

export async function lookupArticle4(lpaCode: string): Promise<Article4Data> {
  return request<Article4Data>(
    `/api/v1/lookup/article4/${encodeURIComponent(lpaCode)}`,
    { headers: HEADERS },
  );
}

// --- Eligibility Engine ---

export async function runEligibility(
  projectId: string,
  manualOverrides: Record<string, boolean | null>,
): Promise<EligibilityRunResponse> {
  return request<EligibilityRunResponse>(`/api/v1/eligibility/${projectId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ manual_overrides: manualOverrides }),
  });
}
