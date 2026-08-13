/** Senior repayment break-even (spec §5.11). Given the senior facility's redemption balance
 * and fees at disposal, plus the exit strategy's selling-cost terms, finds the minimum gross
 * sale price P (pence) that fully redeems the senior facility — i.e. the price at which
 * P covers the redemption balance, the exit fee, disposal costs computed on P itself
 * (selling agent fee is a percentage of the sale price, selling legal fee is flat), and the
 * lender's disclosed enforcement-cost assumption.
 */
export interface SeniorBreakevenTerms {
  redemption_balance_pence: number; // senior balance at disposal, pre-receipt
  exit_fee_pence: number;           // fee due on redemption at disposal
  selling_agent_fee_pct: number;
  selling_legal_fee_pence: number;
  enforcement_cost_assumption_pence: number;
}

/** Bisection on integer pence. Returns the minimum integer P satisfying
 * `P >= redemption + exit_fee + disposal_costs(P) + enforcement`, where
 * `disposal_costs(P) = round_half_up(P * selling_agent_fee_pct/100) + selling_legal_fee_pence`.
 * Returns null when the agent fee is >= 100% (unsolvable — a sale price can never outrun a
 * cost that scales at or above 100% of itself) or when the search does not converge within
 * 200 iterations (a defensive cap — never a substitute number). */
export function solveSeniorBreakeven(t: SeniorBreakevenTerms): number | null {
  const {
    redemption_balance_pence: redemption, exit_fee_pence: exitFee,
    selling_agent_fee_pct: pct, selling_legal_fee_pence: legal,
    enforcement_cost_assumption_pence: enforcement,
  } = t;

  if (pct >= 100) return null;

  const feeFloor = redemption + exitFee + enforcement + legal;
  const feasible = (p: number) => p >= feeFloor + Math.round((p * pct) / 100);

  let lo = feeFloor;
  let hi = Math.ceil(feeFloor / (1 - pct / 100)) + 100;

  let iterations = 0;
  while (lo < hi) {
    if (iterations >= 200) return null;
    iterations++;
    const mid = Math.floor((lo + hi) / 2);
    if (feasible(mid)) hi = mid; else lo = mid + 1;
  }
  return feasible(lo) ? lo : null;
}
