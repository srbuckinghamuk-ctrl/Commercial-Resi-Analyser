import type { AppraisalRun } from '../../lib/model';
import type { CalcPage } from './pages';

/**
 * R16b spec §26.5. Which validation-field ROOTS each page owns. Ownership
 * follows the editor that writes the block, not the block's name: Finance
 * edits `finance`, `equity_sources`, `lender_valuation` and `monitoring`;
 * Appraisal edits `deal_spider`. Pinned exhaustively at both ends —
 * `satisfies` here, and the source-scan test that reads validation.ts. That
 * scan harvests two things and unions them: every `err('literal'` /
 * `warn(\`literal\`` call's literal first argument, AND every path-shaped
 * string literal in the file (single- or back-quoted, `[a-z_]+` followed by
 * `.` or `[`) — the second harvest is what actually closes the gap, because
 * a call site like `err(field, msg)` (field computed, not literal)
 * contributes nothing to the first one; its root is only ever caught via
 * the `field = '...'` / `field = \`...\`` literal that defines it. Every
 * dynamic (non-literal-first-argument) `err`/`warn` call site is
 * additionally pinned by count, so a new one fails the test until its root
 * is confirmed reachable by the harvest.
 */
export const PAGE_OWNERSHIP = {
  acquisition: ['acquisition'],
  areas: ['areas'],
  unit_mix: ['unit_mix'],
  // R17 Task 3 (spec §27.7): the benchmark layer is applied to the cost plan
  // from this page, so its validation roots belong here.
  conversion_costs: ['conversion_costs', 'cost_plan', 'elemental_benchmark'],
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
