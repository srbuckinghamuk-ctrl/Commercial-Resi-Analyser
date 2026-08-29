import type { AppraisalRun } from '../../lib/model';
import type { CalcPage } from './pages';

/**
 * R16b spec §26.5. Which validation-field ROOTS each page owns. Ownership
 * follows the editor that writes the block, not the block's name: Finance
 * edits `lender_valuation`, `monitoring` and `equity_sources`; Appraisal
 * edits `deal_spider`. Pinned exhaustively at both ends — `satisfies` here,
 * and the source-scan test that reads validation.ts.
 */
export const PAGE_OWNERSHIP = {
  acquisition: ['acquisition'],
  areas: ['areas'],
  unit_mix: ['unit_mix'],
  conversion_costs: ['conversion_costs', 'cost_plan'],
  vat: ['vat'],
  finance: ['finance', 'equity_sources', 'lender_valuation', 'monitoring'],
  programme: ['programme'],
  cashflow: [],
  exit_strategy: ['exit_strategy', 'sales_phasing', 'refinance', 'investment_case', 'unit_sales'],
  appraisal: ['deal_spider'],
  scenarios: ['scenarios'],
  sensitivity: [],
  risk_register: ['due_diligence'],
  deal_spider: [],
  investor_summary: [],
  lender_case: [],
} as const satisfies Record<CalcPage, readonly string[]>;

export interface PageStatus {
  /** Count of `severity === 'error'` issues whose field root the page owns. */
  errors: number;
  /** Due Diligence only: assessed of entered, read from the engine's totals. */
  evidence: { assessed: number; total: number } | null;
}

/** The segment before the first `.` or `[`. `equity_sources[0].amount_pence` → `equity_sources`. */
export function fieldRoot(field: string): string {
  return field.split(/[.[]/, 1)[0];
}

export function pageStatus(run: AppraisalRun): Record<CalcPage, PageStatus> {
  const errorRoots = run.validation.filter((i) => i.severity === 'error').map((i) => fieldRoot(i.field));
  const out = {} as Record<CalcPage, PageStatus>;
  for (const page of Object.keys(PAGE_OWNERSHIP) as CalcPage[]) {
    const owned: readonly string[] = PAGE_OWNERSHIP[page];
    out[page] = {
      errors: errorRoots.filter((r) => owned.includes(r)).length,
      evidence: page === 'risk_register'
        ? { assessed: run.metrics.due_diligence.totals.assessed_count, total: run.metrics.due_diligence.totals.entered_total }
        : null,
    };
  }
  return out;
}
