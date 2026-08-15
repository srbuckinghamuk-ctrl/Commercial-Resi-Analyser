import type {
  AnyCalculatorInputs, CostToCompleteSummary, MonthlyModel, Schedule,
} from './finance-types';

/** Cost-to-complete (spec §5.10), on the straight-line schedule.
 *
 * Indexing convention: entries are labelled `m = 1..term` (`term = schedule.term_months`),
 * where label `m` reports the state as of the *completion* of ledger month `m − 1`
 * (ledger months are 0-based, `LedgerMonth.month === m − 1`) — i.e. label `m`'s "remaining"
 * figures cover ledger months `m, m+1, …, term − 1` only, excluding whatever ledger month
 * `m − 1` itself spent or drew. `m = term` is the terminal "nothing left to spend" checkpoint
 * (an empty remaining-cost slice). This gives the telescoping identity
 * `remaining_cost(m) === remaining_cost(m + 1) + cost(month m + 1)` and the boundary identity
 * `remaining_cost(1) === total cost − month-0 spend`, both pinned by worksheet tests.
 *
 * `inputs` is typed as the `AnyCalculatorInputs` union (not the narrower
 * `CalculatorInputsV3` the task brief's interface sketch used) because only `equity_sources` is
 * read here — a field common to all input versions — and `deriveMetrics` (the sole caller)
 * itself carries that same union; narrowing to V3 would not type-check at the real call site.
 */
export function computeCostToComplete(
  schedule: Schedule, model: MonthlyModel, inputs: AnyCalculatorInputs,
): CostToCompleteSummary {
  const term = schedule.term_months;
  // Spec §2: only cash-classified, non-rejected equity sources are committed funding —
  // identical filter to monthly-engine.ts's `committedEquity`, so "not yet contributed"
  // tracks exactly what the ledger itself treats as available.
  const cashEquityTotal = inputs.equity_sources
    .filter((s) => s.classification === 'cash' && s.evidence_status !== 'rejected')
    .reduce((sum, s) => sum + s.amount_pence, 0);

  let cumEquityContributed = 0;
  const months: CostToCompleteSummary['months'] = [];
  let firstShortfallMonth: number | null = null;
  let maxShortfall = 0;

  for (let m = 1; m <= term; m++) {
    let remainingCost = 0;
    for (let k = m; k < term; k++) {
      const u = schedule.uses[k];
      remainingCost +=
        u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence
        + u.lender_ancillary_fees_pence;
      const lm = model.months[k];
      remainingCost += lm.interest_accrued_pence + lm.capitalised_fees_pence;
    }

    // "That month" is ledger month m − 1 — the most recent month whose draw/contribution has
    // actually happened by the point this label describes (see the indexing note above).
    const prevLedgerMonth = model.months[m - 1];
    cumEquityContributed += prevLedgerMonth.equity_contribution_pence;
    const undrawnFacility = prevLedgerMonth.undrawn_net_facility_pence ?? 0;
    const remainingCashEquity = Math.max(0, cashEquityTotal - cumEquityContributed);
    const remainingFunding = undrawnFacility + remainingCashEquity;

    const surplus = remainingFunding - remainingCost;
    if (surplus < 0) {
      if (firstShortfallMonth === null) firstShortfallMonth = m;
      maxShortfall = Math.max(maxShortfall, -surplus);
    }

    months.push({
      month: m,
      remaining_cost_pence: remainingCost,
      remaining_funding_pence: remainingFunding,
      surplus_pence: surplus,
    });
  }

  return { first_shortfall_month: firstShortfallMonth, max_shortfall_pence: maxShortfall, months };
}
