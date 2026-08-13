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

/** Developer profit break-even (spec §5.12, Release 2b Task 5). Lender/debt-independent:
 * finds the minimum gross sale price P (pence) that covers the whole total development cost
 * excluding selling costs, regardless of any facility or redemption balance — selling costs
 * are re-solved at P itself, same as the senior solver's disposal costs.
 */
export interface DeveloperBreakevenTerms {
  tdc_ex_selling_pence: number; // total development cost, excluding selling costs
  selling_agent_fee_pct: number;
  selling_legal_fee_pence: number;
}

/** Bisection on integer pence, shared by every break-even solver in this module. Returns
 * the minimum integer P in [lo, hi] for which `feasible(P)` holds. Returns null when the
 * search does not converge within 200 iterations (a defensive cap — never a substitute
 * number) or when P is still infeasible once the search space is exhausted. */
function bisectMinimalFeasible(lo: number, hi: number, feasible: (p: number) => boolean): number | null {
  let iterations = 0;
  while (lo < hi) {
    if (iterations >= 200) return null;
    iterations++;
    const mid = Math.floor((lo + hi) / 2);
    if (feasible(mid)) hi = mid; else lo = mid + 1;
  }
  return feasible(lo) ? lo : null;
}

/** Returns the minimum integer P satisfying
 * `P >= redemption + exit_fee + disposal_costs(P) + enforcement`, where
 * `disposal_costs(P) = round_half_up(P * selling_agent_fee_pct/100) + selling_legal_fee_pence`.
 * Returns null when the agent fee is >= 100% (unsolvable — a sale price can never outrun a
 * cost that scales at or above 100% of itself), or per `bisectMinimalFeasible`'s
 * iteration-cap guard. */
export function solveSeniorBreakeven(t: SeniorBreakevenTerms): number | null {
  const {
    redemption_balance_pence: redemption, exit_fee_pence: exitFee,
    selling_agent_fee_pct: pct, selling_legal_fee_pence: legal,
    enforcement_cost_assumption_pence: enforcement,
  } = t;

  if (pct >= 100) return null;

  const feeFloor = redemption + exitFee + enforcement + legal;
  const feasible = (p: number) => p >= feeFloor + Math.round((p * pct) / 100);

  const lo = feeFloor;
  const hi = Math.ceil(feeFloor / (1 - pct / 100)) + 100;
  return bisectMinimalFeasible(lo, hi, feasible);
}

/** Returns the minimum integer P satisfying
 * `P >= tdc_ex_selling + round_half_up(P * selling_agent_fee_pct/100) + selling_legal_fee_pence`
 * (profit = P − selling costs − tdc_ex_selling >= 0, selling costs re-solved at P per spec
 * §5.12). Returns null when the agent fee is >= 100% (unsolvable), or per
 * `bisectMinimalFeasible`'s iteration-cap guard. */
export function solveDeveloperBreakeven(t: DeveloperBreakevenTerms): number | null {
  const {
    tdc_ex_selling_pence: tdcExSelling, selling_agent_fee_pct: pct,
    selling_legal_fee_pence: legal,
  } = t;

  if (pct >= 100) return null;

  const feeFloor = tdcExSelling + legal;
  const feasible = (p: number) => p >= feeFloor + Math.round((p * pct) / 100);

  const lo = feeFloor;
  const hi = Math.ceil(feeFloor / (1 - pct / 100)) + 100;
  return bisectMinimalFeasible(lo, hi, feasible);
}
