import type { ApiResponse, DealReview, RefurbAppraisal } from '../types';

export async function scrapeUrl(url: string): Promise<ApiResponse> {
  const response = await fetch('/api/v1/scrape-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<ApiResponse>;
}

// DealReviewCreate payload shape (mirrors backend DealReviewCreate Pydantic model)
export interface DealReviewCreate {
  listing_id: string | null;
  deal_name: string;
  form_snapshot: Record<string, unknown>;
  sdlt: number;                    // pence
  total_acquisition_cost: number;  // pence
  gross_rental_yield: number;
  flip_profit: number;             // pence
  irr: number | null;              // decimal (e.g. 0.085)
  holding_period_years: number;
}

export interface DealReviewUpdate {
  deal_name?: string;
  form_snapshot?: Record<string, unknown>;
  sdlt?: number;
  total_acquisition_cost?: number;
  gross_rental_yield?: number;
  flip_profit?: number;
  irr?: number | null;
  holding_period_years?: number;
}

export async function saveDeal(payload: DealReviewCreate): Promise<DealReview> {
  const res = await fetch('/api/v1/deals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.statusText}`);
  return res.json() as Promise<DealReview>;
}

export async function updateDeal(id: string, payload: DealReviewUpdate): Promise<DealReview> {
  const res = await fetch(`/api/v1/deals/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.statusText}`);
  return res.json() as Promise<DealReview>;
}

export async function listDeals(): Promise<DealReview[]> {
  const res = await fetch('/api/v1/deals');
  if (!res.ok) throw new Error(`Failed to load deals: ${res.statusText}`);
  return res.json() as Promise<DealReview[]>;
}

export async function deleteDeal(id: string): Promise<void> {
  const res = await fetch(`/api/v1/deals/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
}

// ---- Refurb Appraisals ----

export interface RefurbAppraisalCreate {
  name: string;
  inputs_snapshot: Record<string, unknown>; // includes __summary key with RefurbProjectSummary
  net_profit: number | null;
  margin_pct: number | null;
  irr_equity: number | null;
}

export interface RefurbAppraisalUpdate {
  name?: string;
  inputs_snapshot?: Record<string, unknown>;
  net_profit?: number | null;
  margin_pct?: number | null;
  irr_equity?: number | null;
}

export async function saveAppraisal(payload: RefurbAppraisalCreate): Promise<RefurbAppraisal> {
  const res = await fetch('/api/v1/appraisals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.statusText}`);
  return res.json() as Promise<RefurbAppraisal>;
}

export async function listAppraisals(): Promise<RefurbAppraisal[]> {
  const res = await fetch('/api/v1/appraisals');
  if (!res.ok) throw new Error(`Failed to load appraisals: ${res.statusText}`);
  return res.json() as Promise<RefurbAppraisal[]>;
}

export async function updateAppraisal(id: string, payload: RefurbAppraisalUpdate): Promise<RefurbAppraisal> {
  const res = await fetch(`/api/v1/appraisals/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.statusText}`);
  return res.json() as Promise<RefurbAppraisal>;
}

export async function deleteAppraisal(id: string): Promise<void> {
  const res = await fetch(`/api/v1/appraisals/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
}
