/**
 * R16b spec §26.5. The calculator's page table, its slugs and its addresses.
 * `CalcPage` keys are unchanged from R14b; only the table's home moved so the
 * route, the nav and the badge module can share it without importing the
 * component.
 */
export type CalcPage =
  | 'acquisition' | 'areas' | 'unit_mix' | 'conversion_costs' | 'vat'
  | 'finance' | 'programme' | 'cashflow' | 'appraisal' | 'scenarios'
  | 'sensitivity' | 'exit_strategy' | 'risk_register' | 'deal_spider'
  | 'investor_summary' | 'lender_case';

export type Stage = 'Inputs' | 'Funding' | 'Exit' | 'Underwriting' | 'Output';

export const STAGES: readonly Stage[] = ['Inputs', 'Funding', 'Exit', 'Underwriting', 'Output'];

export interface PageDef { key: CalcPage; label: string; num: number; stage: Stage }

// R9/R11/R14b (spec §9, §17, §21): the three funding structures each recompute
// their own draw dates and tranches independently. The page table reordered in
// R14 Task 9 to put Appraisal (then 9) after Cashflow (then 8) for reporting
// reasons. Exit inputs now feed Appraisal, so Exit moved to 9 in R16b, pushing
// Appraisal to 10 and Scenarios/Sensitivity on, so the boundary order also
// improved: Funding's three pages feed both Appraisal and Exit (9) above them,
// Exit then feeds Appraisal below. (The Lender Valuation card on Appraisal shows
// loan-to-value, which needs the facility from Funding and the exit value from
// Exit; the Lender Valuation refinance card reads the same facility draw date
// from Funding.) Sensitivity, Due Diligence, and Output are downstream-read only.
// R16b (spec §26.5): Exit moves ahead of Appraisal — its inputs feed the appraisal — so 9–13 renumber; Due Diligence stays 13.
export const PAGES: readonly PageDef[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1, stage: 'Inputs' },
  { key: 'areas', label: 'Areas', num: 2, stage: 'Inputs' },
  { key: 'unit_mix', label: 'Unit Mix', num: 3, stage: 'Inputs' },
  { key: 'conversion_costs', label: 'Costs', num: 4, stage: 'Inputs' },
  { key: 'vat', label: 'VAT', num: 5, stage: 'Inputs' },
  { key: 'finance', label: 'Finance', num: 6, stage: 'Funding' },
  { key: 'programme', label: 'Programme', num: 7, stage: 'Funding' },
  { key: 'cashflow', label: 'Cashflow', num: 8, stage: 'Funding' },
  { key: 'exit_strategy', label: 'Exit', num: 9, stage: 'Exit' },
  { key: 'appraisal', label: 'Appraisal', num: 10, stage: 'Underwriting' },
  { key: 'scenarios', label: 'Scenarios', num: 11, stage: 'Underwriting' },
  { key: 'sensitivity', label: 'Sensitivity', num: 12, stage: 'Underwriting' },
  { key: 'risk_register', label: 'Due Diligence', num: 13, stage: 'Underwriting' },
  { key: 'deal_spider', label: 'Deal Spider', num: 14, stage: 'Output' },
  { key: 'investor_summary', label: 'Investor', num: 15, stage: 'Output' },
  { key: 'lender_case', label: 'Lender Case', num: 16, stage: 'Output' },
];

/** Pinned exhaustively: a page with no address fails `tsc`. */
export const PAGE_SLUG = {
  acquisition: 'acquisition', areas: 'areas', unit_mix: 'unit-mix', conversion_costs: 'costs',
  vat: 'vat', finance: 'finance', programme: 'programme', cashflow: 'cashflow',
  appraisal: 'appraisal', scenarios: 'scenarios', sensitivity: 'sensitivity',
  exit_strategy: 'exit', risk_register: 'due-diligence', deal_spider: 'deal-spider',
  investor_summary: 'investor', lender_case: 'lender-case',
} as const satisfies Record<CalcPage, string>;

export const FIRST_PAGE: CalcPage = 'acquisition';

/** null for an absent or unrecognised slug — the caller redirects. */
export function pageForSlug(slug: string | undefined): CalcPage | null {
  if (slug === undefined) return null;
  const hit = (Object.keys(PAGE_SLUG) as CalcPage[]).find((k) => PAGE_SLUG[k] === slug);
  return hit ?? null;
}

export function calculatorPath(projectId: string, page: CalcPage): string {
  return `/projects/${projectId}/calculator/${PAGE_SLUG[page]}`;
}
