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

export interface PageDef { key: CalcPage; label: string; num: number }

// Task 7 keeps today's order and numbers; Task 8 regroups and renumbers.
export const PAGES: readonly PageDef[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'areas', label: 'Areas', num: 2 },
  { key: 'unit_mix', label: 'Unit Mix', num: 3 },
  { key: 'conversion_costs', label: 'Costs', num: 4 },
  { key: 'vat', label: 'VAT', num: 5 },
  { key: 'finance', label: 'Finance', num: 6 },
  { key: 'programme', label: 'Programme', num: 7 },
  { key: 'cashflow', label: 'Cashflow', num: 8 },
  { key: 'appraisal', label: 'Appraisal', num: 9 },
  { key: 'scenarios', label: 'Scenarios', num: 10 },
  { key: 'sensitivity', label: 'Sensitivity', num: 11 },
  { key: 'exit_strategy', label: 'Exit', num: 12 },
  { key: 'risk_register', label: 'Due Diligence', num: 13 },
  { key: 'deal_spider', label: 'Deal Spider', num: 14 },
  { key: 'investor_summary', label: 'Investor', num: 15 },
  { key: 'lender_case', label: 'Lender Case', num: 16 },
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
