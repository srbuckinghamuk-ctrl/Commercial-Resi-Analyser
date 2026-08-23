import type {
  AnyCalculatorInputs, MonitoringCategory, MonitoringLineInputs, MonthlyModel, Schedule,
} from './finance-types';
import { MONITORING_CATEGORIES } from './finance-types';
import type { CostPlanResult } from './cost-plan';

/**
 * R14 spec §20.2. One category's row of the monitoring cost-to-complete statement.
 *
 * Five of the columns are the sponsor's entered figures, echoed unchanged;
 * `original_budget_pence` comes from the inception model (§20.1's table, see
 * `originalBudgets` below); the remaining five are sums and differences of those.
 * `paid_to_date_pence` is carried and printed because the audit asks a lender to
 * reconcile certificates against payments, but it drives NO other column — the
 * statement is a cost position, not a cash position (§7, stated).
 */
export interface MonitoringStatementLine {
  category: MonitoringCategory;
  original_budget_pence: number;
  current_budget_pence: number;
  certified_to_date_pence: number;
  paid_to_date_pence: number;
  committed_to_date_pence: number;
  committed_not_certified_pence: number;
  forecast_to_complete_pence: number;
  estimated_final_cost_pence: number;
  /** Positive = overrun against the inception budget. */
  variance_vs_original_pence: number;
  variance_vs_current_pence: number;
  remaining_to_spend_pence: number;
}

/**
 * R14 spec §20.2. The statement as a whole: five lines, their column totals, the
 * funding reconciliation and the three variances against the inception plan.
 *
 * A snapshot, never a re-simulation (§20.5 limitation 4): every ledger figure read
 * here is the INCEPTION forecast, including the interest component — there is no
 * actual-interest input (§20.5 limitation 1).
 */
export interface MonitoringStatement {
  reporting_month: number;
  /** Echoed for the memo's provenance line. Printed only; drives no arithmetic in
   *  this module, and a test asserts two statements differing only in this field are
   *  otherwise deep-equal. */
  reporting_date: string;
  /** Always five, in `MONITORING_CATEGORIES` order whatever order the input listed. */
  lines: MonitoringStatementLine[];
  totals: Omit<MonitoringStatementLine, 'category'>;
  contingency_remaining_pence: number;
  undrawn_net_facility_pence: number;
  reserve_headroom_pence: number;
  remaining_cash_equity_pence: number;
  remaining_funding_pence: number;
  forecast_finance_pence: number;
  remaining_uses_pence: number;
  surplus_pence: number;
  shortfall_pence: number;
  /** Positive = ahead of (more than) plan, in all three. */
  debt_drawn_variance_pence: number;
  equity_injected_variance_pence: number;
  cost_to_date_variance_pence: number;
}

/**
 * R14 spec §20.1's table: the "original budget" column, which is never entered — it
 * is read off the inception model so the statement can measure drift against the
 * appraisal the lender actually underwrote.
 *
 * The construction/contingency split is the one place the inception model's lines and
 * the statement's lines differ: §3.4 carries contingency inside the construction line
 * and the statement pulls it out, because the audit asks for remaining contingency as
 * its own figure. `computeCostPlan` builds `construction_total_pence` as
 * `base_build + contingency_total + compliance`, so
 * `construction + contingency === Σ uses.construction_pence` exactly — asserted on
 * every corpus fixture, per §6.
 *
 * `acquisition` is read from `schedule.totals`, which `buildSchedule` assigns from the
 * same `acquisitionTotal` it puts into `uses[0]`; the spec's `Σ uses.acquisition_pence`
 * form is the identical figure, and reading the already-computed total keeps this
 * module from re-deriving a quantity the schedule owns. Likewise `professional` and
 * `statutory` come from the cost plan, which is exactly what `schedule.totals` holds
 * for those two categories (see `buildSchedule`'s totals block) — the spec's
 * `Σ uses.*` phrasing and the brief's `costPlan.*_total_pence` phrasing name one
 * number, and a fixture-wide test pins that they agree.
 */
export function originalBudgets(
  schedule: Schedule, costPlan: CostPlanResult,
): Record<MonitoringCategory, number> {
  return {
    acquisition: schedule.totals.acquisition_pence,
    construction: costPlan.base_build_pence + costPlan.compliance_pence,
    professional: costPlan.professional_total_pence,
    statutory: costPlan.statutory_total_pence,
    contingency: costPlan.contingency_total_pence,
  };
}

/**
 * R14 spec §20.2. The monitoring cost-to-complete statement at `reporting_month`.
 *
 * Pure: reads the schedule, the inception ledger, the inputs and the cost plan, and
 * writes nothing. Nothing here re-runs the ledger.
 *
 * `null` exactly when the document carries no monitoring block — either because it
 * predates v11 (`monitoring` absent, read structurally like this codebase's other
 * version dispatches) or because it is a v11 document with `monitoring: null`, which
 * is every migrated document. `inputs` is the `AnyCalculatorInputs` union rather than
 * `CalculatorInputsV11` because `deriveMetrics` (Task 9's caller) carries that union.
 *
 * Rounding: none. Every input is integer pence and every column is a sum or a
 * difference of integers (§7, "Rounding").
 *
 * Validation (§20.3) is a separate concern and runs on inputs only: this engine sorts
 * the lines, it does not check them. Where a malformed block would otherwise make an
 * index undefined, the degradation is defined rather than defended: a category absent
 * from `lines` contributes its entered columns as zero (its original budget is still
 * the inception figure), a duplicated category takes its first occurrence, and a
 * `reporting_month` outside `1..term` simply moves the two loop bounds — a month past
 * the term forecasts no finance, a month at or below zero accumulates nothing. All
 * four are hard validation errors upstream and unreachable in a report-safe document.
 */
export function computeMonitoringStatement(
  schedule: Schedule,
  model: MonthlyModel,
  inputs: AnyCalculatorInputs,
  costPlan: CostPlanResult,
): MonitoringStatement | null {
  const monitoring = 'monitoring' in inputs ? inputs.monitoring : null;
  if (monitoring == null) return null;

  const m = monitoring.reporting_month;
  const term = schedule.term_months;
  const originals = originalBudgets(schedule, costPlan);

  // First occurrence wins; validation forbids duplicates upstream.
  const entered = new Map<MonitoringCategory, MonitoringLineInputs>();
  for (const line of monitoring.lines) {
    if (!entered.has(line.category)) entered.set(line.category, line);
  }

  const lines: MonitoringStatementLine[] = MONITORING_CATEGORIES.map((category) => {
    const input = entered.get(category);
    const currentBudget = input?.current_budget_pence ?? 0;
    const certified = input?.certified_to_date_pence ?? 0;
    const paid = input?.paid_to_date_pence ?? 0;
    const committed = input?.committed_to_date_pence ?? 0;
    const forecast = input?.forecast_to_complete_pence ?? 0;
    const original = originals[category];
    const committedNotCertified = committed - certified;
    const estimatedFinal = committed + forecast;
    return {
      category,
      original_budget_pence: original,
      current_budget_pence: currentBudget,
      certified_to_date_pence: certified,
      paid_to_date_pence: paid,
      committed_to_date_pence: committed,
      committed_not_certified_pence: committedNotCertified,
      forecast_to_complete_pence: forecast,
      estimated_final_cost_pence: estimatedFinal,
      variance_vs_original_pence: estimatedFinal - original,
      variance_vs_current_pence: estimatedFinal - currentBudget,
      // Identically `committedNotCertified + forecast`; §7 gives both forms.
      remaining_to_spend_pence: estimatedFinal - certified,
    };
  });

  const column = (pick: (line: MonitoringStatementLine) => number) =>
    lines.reduce((sum, line) => sum + pick(line), 0);
  const totals: Omit<MonitoringStatementLine, 'category'> = {
    original_budget_pence: column((l) => l.original_budget_pence),
    current_budget_pence: column((l) => l.current_budget_pence),
    certified_to_date_pence: column((l) => l.certified_to_date_pence),
    paid_to_date_pence: column((l) => l.paid_to_date_pence),
    committed_to_date_pence: column((l) => l.committed_to_date_pence),
    committed_not_certified_pence: column((l) => l.committed_not_certified_pence),
    forecast_to_complete_pence: column((l) => l.forecast_to_complete_pence),
    estimated_final_cost_pence: column((l) => l.estimated_final_cost_pence),
    variance_vs_original_pence: column((l) => l.variance_vs_original_pence),
    variance_vs_current_pence: column((l) => l.variance_vs_current_pence),
    remaining_to_spend_pence: column((l) => l.remaining_to_spend_pence),
  };

  const contingency = lines.find((l) => l.category === 'contingency');
  const contingencyRemaining = Math.max(
    0, (contingency?.current_budget_pence ?? 0) - (contingency?.certified_to_date_pence ?? 0),
  );

  // Ledger months 0..m−1 are the months that have HAPPENED by label m — §5.10's
  // indexing convention, shared with `computeCostToComplete`.
  let cumInterestCapitalised = 0;
  let cumDrawnAndCapitalisedFees = 0;
  let cumEquityContributed = 0;
  const lastElapsed = Math.max(0, Math.min(m, model.months.length));
  for (let k = 0; k < lastElapsed; k++) {
    const lm = model.months[k];
    cumInterestCapitalised += lm.interest_capitalised_pence;
    cumDrawnAndCapitalisedFees += lm.draw_pence + lm.capitalised_fees_pence;
    cumEquityContributed += lm.equity_contribution_pence;
  }
  let cumPlannedCost = 0;
  const lastElapsedUses = Math.max(0, Math.min(m, schedule.uses.length));
  for (let k = 0; k < lastElapsedUses; k++) {
    const u = schedule.uses[k];
    cumPlannedCost +=
      u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence;
  }

  // §7 uses side: the inception ledger's finance forecast from month m onward.
  let forecastFinance = 0;
  for (let k = Math.max(0, m); k < Math.min(term, model.months.length); k++) {
    forecastFinance += model.months[k].interest_accrued_pence + model.months[k].capitalised_fees_pence;
  }

  // §7 funding side. This is the §5.10 reserve-headroom formula evaluated at ONE month
  // rather than swept across the term; it is deliberately restated here rather than
  // extracted into a shared helper, because the shared part is a single max-of-a-
  // difference and the two callers differ in the expensive half — `computeCostToComplete`
  // accumulates `cumInterestCapitalised` as it walks every label, while the statement
  // needs it at one. A helper taking the already-accumulated sum would dedupe one
  // expression and add a cross-module dependency the Python twin must mirror as well.
  // If the formula ever changes, it changes in cost-to-complete.ts and here.
  const rolledUp = inputs.finance.interest_type === 'rolled_up';
  const reserveHeadroom = rolledUp
    ? Math.max(
      0,
      model.committed_gross_facility_pence - model.committed_net_facility_pence
      - cumInterestCapitalised,
    )
    : 0;
  // `committed_net_facility_pence` is already 0 for a cash deal (the ledger zeroes it),
  // so this needs no `funding_source` branch of its own.
  const undrawnNetFacility = Math.max(
    0, model.committed_net_facility_pence - monitoring.debt_drawn_to_date_pence,
  );
  // §5.10's filter, unchanged: cash-classified and not rejected is what the ledger
  // itself treats as available funding.
  const cashEquityTotal = inputs.equity_sources
    .filter((s) => s.classification === 'cash' && s.evidence_status !== 'rejected')
    .reduce((sum, s) => sum + s.amount_pence, 0);
  const remainingCashEquity = Math.max(
    0, cashEquityTotal - monitoring.cash_equity_injected_to_date_pence,
  );
  const remainingFunding = undrawnNetFacility + reserveHeadroom + remainingCashEquity;

  const remainingUses = totals.remaining_to_spend_pence + forecastFinance;
  const surplus = remainingFunding - remainingUses;

  return {
    reporting_month: m,
    reporting_date: monitoring.reporting_date,
    lines,
    totals,
    contingency_remaining_pence: contingencyRemaining,
    undrawn_net_facility_pence: undrawnNetFacility,
    reserve_headroom_pence: reserveHeadroom,
    remaining_cash_equity_pence: remainingCashEquity,
    remaining_funding_pence: remainingFunding,
    forecast_finance_pence: forecastFinance,
    remaining_uses_pence: remainingUses,
    surplus_pence: surplus,
    shortfall_pence: Math.max(0, -surplus),
    debt_drawn_variance_pence:
      monitoring.debt_drawn_to_date_pence - cumDrawnAndCapitalisedFees,
    equity_injected_variance_pence:
      monitoring.cash_equity_injected_to_date_pence - cumEquityContributed,
    cost_to_date_variance_pence: totals.certified_to_date_pence - cumPlannedCost,
  };
}
