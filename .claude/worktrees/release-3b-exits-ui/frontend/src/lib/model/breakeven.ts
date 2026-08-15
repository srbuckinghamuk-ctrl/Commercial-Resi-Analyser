import type { FacilityTerms } from './finance-types';
import { exitFeeAmount } from './monthly-engine';

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

/** Phased senior break-even (spec §5.11 phased regime). Freezes the actual run's
 * draw+capitalised-fee schedule, scales tranche receipts by a uniform factor, and
 * replays §4.4's sweep (fee-once, sales_sweep_pct, both arms) with §4's interest
 * recurrence. Excludes any planned refinance (§5.11 is the enforcement question). */
export interface PhasedSeniorBreakevenTerms {
  draws_and_fees_pence: number[];   // per month: draw_pence + capitalised_fees_pence, frozen
  monthly_rate: number;             // annual_interest_rate_pct / 100 / 12
  rolled_up: boolean;
  sales_sweep_pct: number;
  tranches: Array<{ month_offset: number; pct_of_gross_receipts: number }>;
  selling_agent_fee_pct: number;
  selling_legal_fee_pence: number;
  enforcement_cost_assumption_pence: number;
  finance: FacilityTerms;           // exit-fee basis terms
  committed_gross_facility_pence: number;
}

/** Net tranche proceeds at total gross G, split per §4.4.1 (residue absorption,
 * pro-rata costs); enforcement deducted from the first tranche. Keyed by month. */
function phasedNetByMonth(t: PhasedSeniorBreakevenTerms, totalGross: number): Map<number, number> {
  const out = new Map<number, number>();
  if (totalGross <= 0) return out;
  const agentFeeTotal = Math.round((totalGross * t.selling_agent_fee_pct) / 100);
  let grossAllocated = 0, agentAllocated = 0, legalAllocated = 0;
  t.tranches.forEach((tr, i) => {
    const last = i === t.tranches.length - 1;
    const gross = last ? totalGross - grossAllocated
      : Math.round((totalGross * tr.pct_of_gross_receipts) / 100);
    const agent = last ? agentFeeTotal - agentAllocated
      : Math.round((agentFeeTotal * gross) / totalGross);
    const legal = last ? t.selling_legal_fee_pence - legalAllocated
      : Math.round((t.selling_legal_fee_pence * gross) / totalGross);
    grossAllocated += gross; agentAllocated += agent; legalAllocated += legal;
    const enforcement = i === 0 ? t.enforcement_cost_assumption_pence : 0;
    out.set(tr.month_offset, (out.get(tr.month_offset) ?? 0) + gross - agent - legal - enforcement);
  });
  return out;
}

/** Replays the ledger recurrence at total gross G; true iff fully redeemed by term end.
 * Mirrors §4.4's sweep arms EXCEPT for one documented §5.11 modelling assumption (spec
 * §5.11 phased regime): the partial arm reserves the exit fee out of the tranche's sweep
 * before repaying principal (`repayment = max(0, sweep - fee)`), rather than the ledger's
 * own clamp (repay up to the full balance, and only fall back to `sweep - fee` when that
 * repayment would exactly equal the balance). Without the reservation, the residual balance
 * is discontinuous in G — right at the point where a tranche's sweep first reaches the
 * balance, the ledger's clamp jumps the residual from ~0 up to `fee`, so feasibility is not
 * monotone in G (it can go true → false → true as G grows) and the shared bisection can miss
 * a genuinely feasible G above the discontinuity. Reserving the fee up front makes the
 * residual continuous and (weakly) decreasing in G at every step, restoring monotonicity;
 * the cost is that principal repayment is delayed by at most `fee` per tranche relative to
 * the real ledger, so the phased break-even this produces is conservatively (slightly)
 * overstated relative to §4.4's actual clamp behaviour. Exported for the tightness test
 * only — production callers use the solver. */
export function phasedReplayRedeems(t: PhasedSeniorBreakevenTerms, totalGross: number): boolean {
  const netByMonth = phasedNetByMonth(t, totalGross);
  let balance = 0, peak = 0, redeemed = false;
  for (let m = 0; m < t.draws_and_fees_pence.length; m++) {
    const dc = t.draws_and_fees_pence[m];
    const interest = t.rolled_up ? Math.round((balance + dc) * t.monthly_rate) : 0;
    balance = balance + dc + interest;
    if (balance > peak) peak = balance;
    const net = netByMonth.get(m) ?? 0;
    if (net > 0 && balance > 0) {
      const sweepAvailable = Math.round((net * t.sales_sweep_pct) / 100);
      const fee = redeemed ? 0
        : exitFeeAmount(t.finance, t.committed_gross_facility_pence, peak, balance);
      if (sweepAvailable >= balance + fee) {
        balance = 0;
        redeemed = true;
      } else {
        balance -= Math.max(0, Math.min(sweepAvailable - fee, balance));
      }
    }
  }
  return redeemed && balance === 0;
}

export function solveSeniorBreakevenPhased(t: PhasedSeniorBreakevenTerms): number | null {
  if (t.selling_agent_fee_pct >= 100) return null;
  if (t.tranches.length === 0) return null;
  if (t.sales_sweep_pct <= 0) return null;
  const lastTranche = Math.max(...t.tranches.map((x) => x.month_offset));
  for (let m = lastTranche + 1; m < t.draws_and_fees_pence.length; m++) {
    if (t.draws_and_fees_pence[m] > 0) return null;   // structurally unsolvable
  }
  // Upper-bound seed: the zero-receipts trajectory's terminal balance + fee is a lower
  // bound on what a SINGLE full-sweep tranche would need to clear (receipts only shrink
  // balances); inflate for costs and the sweep fraction. This is only a starting seed, not
  // a proven sufficient bound — with multiple tranches, the §5.11 fee reserve (see
  // phasedReplayRedeems's doc comment) is paid out of EVERY tranche's sweep, not just the
  // last, so an early tranche with a small pct_of_gross_receipts share can need materially
  // more total G to clear the same balance than the single-tranche closed form accounts
  // for. Grown by doubling below until genuinely feasible, so correctness never depends on
  // the seed's tightness — only its cost (bisection is O(log hi), so a loose seed is cheap).
  let b0 = 0, peak0 = 0;
  for (const dc of t.draws_and_fees_pence) {
    const interest = t.rolled_up ? Math.round((b0 + dc) * t.monthly_rate) : 0;
    b0 = b0 + dc + interest;
    if (b0 > peak0) peak0 = b0;
  }
  if (b0 <= 0) return 0;
  const fee0 = exitFeeAmount(t.finance, t.committed_gross_facility_pence, peak0, b0);
  const needed = b0 + fee0 + t.selling_legal_fee_pence + t.enforcement_cost_assumption_pence;
  const sweepFrac = t.sales_sweep_pct / 100;
  let hi = Math.ceil(needed / (sweepFrac * (1 - t.selling_agent_fee_pct / 100))) + 1000;
  let growthIterations = 0;
  while (!phasedReplayRedeems(t, hi) && growthIterations < 64) {
    hi *= 2;
    growthIterations++;
  }
  return bisectMinimalFeasible(0, hi, (g) => phasedReplayRedeems(t, g));
}
