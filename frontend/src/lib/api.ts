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
} from '../types';

const HEADERS = { 'Content-Type': 'application/json' };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
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

// --- Scrape ---

export async function scrapeUrl(url: string): Promise<ApiResponse> {
  return request<ApiResponse>('/api/v1/scrape-url', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ url }),
  });
}
