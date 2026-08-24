import type {
  AnyCalculatorInputs, MonthReceipts, MonthUses, PhaseAnchor, ProgrammePackage, ProgrammeNetwork,
  RefinanceInputsV9, RefinanceInputsV10, SalesPhasingTrancheV9, Schedule,
} from './finance-types';
import {
  calculateGdv, calculateTotalAcquisitionCost, unitAncillaryValuePence,
} from '../conversion-calc-engine';
import { developedAreaSqm } from './areas';
import { spreadByCurve } from './curves';
import { computeCostPlan } from './cost-plan';
import { computeVat } from './vat';
import { isProgrammeNetwork, isLegacyProgramme, derivePhases } from './programme';
import { computeInvestmentCase } from './investment-case';

/** Straight-line spread in integer pence; the final month absorbs the rounding residue. */
export function spreadStraightLine(total: number, months: number): number[] {
  if (months <= 0) return [];
  const per = Math.round(total / months);
  const out: number[] = new Array(months).fill(per);
  out[months - 1] = total - per * (months - 1);
  return out;
}

/** §18.5. The ONE resolution rule, both cost modes. A line's override and the
 *  category default can never both apply. */
export function resolvedPhaseId(
  phaseId: string | null,
  category: 'construction' | 'professional' | 'statutory',
  network: ProgrammeNetwork,
): string {
  return phaseId ?? network.category_phase_ids[category];
}

function emptyUses(): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0, vat_pence: 0,
  };
}

function emptyReceipts(): MonthReceipts {
  return {
    gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0, vat_reclaim_pence: 0,
    net_operating_income_pence: 0,
  };
}

export function buildSchedule(inputs: AnyCalculatorInputs): Schedule {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const units = inputs.unit_mix.units;

  const acquisitionTotal = calculateTotalAcquisitionCost(inputs);
  // R10 spec §16. The cost stack is computed once, by the one engine that serves
  // both modes, and this is the only place the schedule learns the three totals.
  const costPlan = computeCostPlan(inputs, developedAreaSqm(inputs), units.length);
  const constructionTotal = costPlan.construction_total_pence;
  const professionalTotal = costPlan.professional_total_pence;
  // §3.4: prior approval lands in month 0; every other statutory line spreads with
  // the professional curve. Keyed on the fee CODE, preserving the pre-R10 split
  // that was keyed on a hard-coded field name. R12 generalises fee timing.
  const priorApproval = costPlan.fees
    .filter((f) => f.code === 'prior_approval')
    .reduce((s, f) => s + f.amount_pence, 0);
  const statutorySpreadTotal = costPlan.statutory_total_pence - priorApproval;
  const statutoryTotal = costPlan.statutory_total_pence;

  const uses: MonthUses[] = Array.from({ length: term }, emptyUses);
  const receipts: MonthReceipts[] = Array.from({ length: term }, emptyReceipts);

  uses[0].acquisition_pence = acquisitionTotal;

  // R12 (spec §18.1): `programme` is a two-state INPUT field across the version
  // union — the legacy `{ packages: {...} }` shape (v4-v8) or a v9 precedence
  // network (`{ phases: [...] }`). Task 11 wires the network arm (spec §18.5).
  const rawProgramme = 'programme' in inputs ? inputs.programme : null;
  const network = rawProgramme != null && isProgrammeNetwork(rawProgramme) ? rawProgramme : null;
  const legacyProgramme = rawProgramme != null && isLegacyProgramme(rawProgramme) ? rawProgramme : null;

  let programmeResult: Schedule['programme'] = null;

  if (network != null) {
    // §18.5 (amended, fix round 1 Finding 1). The ONE resolution rule places
    // every resolved amount into a BUCKET keyed by (resolved phase, category);
    // each bucket's TOTAL spreads once over that phase's window with that
    // phase's curve. Two lines resolving to the same phase in the same
    // category are one spread of their combined total, not two spreads
    // summed — summed spreads round independently and can disagree with a
    // single spread of the sum by a few pence, which breaks the v8->v9
    // migration identity gate on any document whose amounts don't happen to
    // divide evenly. When every line resolves to its category default —
    // exactly what migration produces, since it writes no per-line phase_id —
    // the bucket total IS the category total and this is bit-identical to
    // the legacy arm's single `spreadByCurve(categoryTotal, …)` call.
    //
    // The auto/legacy arms' month-0 lump (`uses[0].statutory_pence +=
    // priorApproval`, below) is deliberately NOT applied here — §18.5's
    // second surviving anchor is a placement decision, not a rounding one,
    // and stays keyed per LINE: an untagged prior_approval fee is pinned to
    // month 0 and never enters a bucket; a tagged one joins its phase's
    // bucket like any other line. A category-level lump can't tell those two
    // cases apart.
    const derivation = derivePhases(network);
    const phaseById = new Map(network.phases.map((p) => [p.id, p]));
    // Defensive, mirroring the legacy arm's belt-and-braces clamp below:
    // unreachable for any document that passes validation — a cycle, or a
    // phase_id / category_phase_ids entry naming an absent phase, are hard
    // validation errors owned by validation.ts, not this file. Degrades to a
    // defined month-0, ONE-month placement instead of crashing an
    // unvalidated caller — `Math.max(1, …)`, not a bare `?? 1`, because a
    // resolvable milestone (duration_months === 0, itself only reachable pre-
    // validation) is not nullish and would otherwise pass 0 through, and
    // `spreadByCurve` returns `[]` for a non-positive duration, silently
    // dropping the money instead of degrading to a defined placement.
    const placeInPhase = (total: number, phaseId: string, add: (m: number, v: number) => void) => {
      const phase = phaseById.get(phaseId);
      const derived = !('cycle' in derivation) ? derivation.byId[phaseId] : undefined;
      const start = derived?.start_month ?? 0;
      const duration = Math.max(1, derived?.duration_months ?? 1);
      const curve = phase?.curve ?? { kind: 'straight_line' as const };
      spreadByCurve(total, duration, curve)
        .forEach((v, i) => add(Math.min(Math.max(0, Math.floor(start + i)), term - 1), v));
    };

    const addToBucket = (bucket: Map<string, number>, phaseId: string, amount: number) => {
      bucket.set(phaseId, (bucket.get(phaseId) ?? 0) + amount);
    };

    // Construction: each package's own amount joins its resolved phase's
    // bucket. The remainder — contingency and compliance, or a headline
    // document's WHOLE total, since headline mode carries no package rows at
    // all — is not itself a "line" and always resolves through the category
    // default, joining whichever bucket that is.
    const constructionBuckets = new Map<string, number>();
    let constructionRemainder = constructionTotal;
    costPlan.packages.forEach((pkg) => {
      const id = resolvedPhaseId(pkg.phase_id, 'construction', network);
      addToBucket(constructionBuckets, id, pkg.amount_pence);
      constructionRemainder -= pkg.amount_pence;
    });
    addToBucket(constructionBuckets, resolvedPhaseId(null, 'construction', network), constructionRemainder);

    // Professional and statutory: every fee line (other than an untagged
    // prior_approval, carved out per line above) joins its resolved phase's
    // bucket in its own category. The buckets across both categories sum to
    // computeCostPlan's own professional/statutory totals exactly, since
    // every fee line is accounted for exactly once — either the month-0
    // carve-out or a bucket.
    const professionalBuckets = new Map<string, number>();
    const statutoryBuckets = new Map<string, number>();
    costPlan.fees.forEach((fee) => {
      if (fee.code === 'prior_approval' && fee.phase_id == null) {
        uses[0].statutory_pence += fee.amount_pence;
        return;
      }
      const bucket = fee.category === 'professional' ? professionalBuckets : statutoryBuckets;
      addToBucket(bucket, resolvedPhaseId(fee.phase_id, fee.category, network), fee.amount_pence);
    });

    constructionBuckets.forEach((total, id) => {
      placeInPhase(total, id, (m, v) => { uses[m].construction_pence += v; });
    });
    professionalBuckets.forEach((total, id) => {
      placeInPhase(total, id, (m, v) => { uses[m].professional_pence += v; });
    });
    statutoryBuckets.forEach((total, id) => {
      placeInPhase(total, id, (m, v) => { uses[m].statutory_pence += v; });
    });

    // §18.10: a derived block is only ever produced for a document that
    // asked for one. A cycle has no dates to report — validation.ts hard-
    // errors it, so `programme` stays null rather than publishing a
    // half-formed derivation to an unvalidated caller.
    if (!('cycle' in derivation)) {
      programmeResult = {
        finish_month: derivation.finish_month,
        critical_path: derivation.critical_path,
        phases: derivation.phases,
      };
    }
  } else {
    uses[0].statutory_pence += priorApproval;

    if (legacyProgramme == null) {
      // auto windows — calc 2.1.0 behaviour, byte-identical (spec §6)
      if (term === 1) {
        uses[0].construction_pence = constructionTotal;
        uses[0].professional_pence = professionalTotal;
        uses[0].statutory_pence += statutorySpreadTotal;
      } else {
        const constructionWindow = Math.max(1, term - 2); // months 1..constructionWindow
        const professionalWindow = Math.max(1, Math.ceil(constructionWindow / 2));
        const constructionSpread = spreadStraightLine(constructionTotal, constructionWindow);
        const professionalSpread = spreadStraightLine(professionalTotal, professionalWindow);
        const statutorySpread = spreadStraightLine(statutorySpreadTotal, professionalWindow);
        constructionSpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].construction_pence += v; });
        professionalSpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].professional_pence += v; });
        statutorySpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].statutory_pence += v; });
      }
    } else {
      // explicit programme (spec §6.1); windows validated in validation.ts —
      // the clamp is belt-and-braces, mirroring the auto path. The lower
      // Math.max(0, …) mirrors schedule.py's documented lower clamp (CRITICAL 1c):
      // an unvalidated negative start_offset must not reach `uses[-1]`, which in
      // JS is `undefined` and throws on the very next property access (unlike
      // Python's negative indexing, which would silently wrap to the end of the
      // list). validation.ts hard-rejects start_offset < 0, so this is
      // unreachable for any document that passes validation; it exists so the
      // unvalidated path degrades to a defined, in-range placement instead of a
      // crash.
      const place = (pkg: ProgrammePackage, total: number, add: (m: number, v: number) => void) => {
        spreadByCurve(total, pkg.duration_months, pkg.curve)
          .forEach((v, i) => add(Math.min(Math.max(0, Math.floor(pkg.start_offset + i)), term - 1), v));
      };
      place(legacyProgramme.packages.construction, constructionTotal, (m, v) => { uses[m].construction_pence += v; });
      place(legacyProgramme.packages.professional, professionalTotal, (m, v) => { uses[m].professional_pence += v; });
      place(legacyProgramme.packages.statutory, statutorySpreadTotal, (m, v) => { uses[m].statutory_pence += v; });
    }
  }

  // R12 spec §18.6. `resolveAnchorMonth` is the single resolution rule for
  // sales_phasing tranches and refinance: an anchor resolves against the
  // phase's derived start; `anchor: null` (the migration default) keeps
  // `month_offset` exactly as before, so every stored document's receipts
  // land where they land today. Recomputed here — rather than threaded out
  // of the network branch above — because `derivePhases` is pure and cheap
  // over a handful of phases, and this keeps that branch untouched.
  const exitTimingDerivation = network != null ? derivePhases(network) : null;
  const resolveAnchorMonth = (anchor: PhaseAnchor | null, monthOffset: number): number => {
    if (anchor == null) return monthOffset;
    // Defensive, mirroring the placement clamps above: unreachable for any
    // document that passes validation — an anchor naming an absent phase, or
    // a cyclic network, are hard validation errors owned by validation.ts.
    // Degrades to the entered `month_offset` rather than crashing an
    // unvalidated caller.
    if (exitTimingDerivation == null || 'cycle' in exitTimingDerivation) return monthOffset;
    const dp = exitTimingDerivation.byId[anchor.phase_id];
    return dp ? dp.start_month + anchor.offset_months : monthOffset;
  };

  // Exit: which units sell?
  const route = inputs.exit_strategy.route;
  const retainedIds = new Set(inputs.exit_strategy.retained_units.map((r) => r.unit_id));
  const soldUnits =
    route === 'retain_all' ? [] :
    route === 'sell_all' ? units :
    units.filter((u) => !retainedIds.has(u.id));
  // R9 spec §15.5: ancillary sells with its unit. Summing internal value alone
  // here would make GDV and gross receipts disagree by the ancillary total.
  const grossSales = soldUnits.reduce(
    (s, u) => s + u.estimated_value_pence + unitAncillaryValuePence(u), 0,
  );
  const gdv = calculateGdv(units);
  const retainedValue = gdv - grossSales;

  const agentFee = Math.round((grossSales * inputs.exit_strategy.selling_agent_fee_pct) / 100);
  const sellingLegal = soldUnits.length > 0 ? inputs.exit_strategy.selling_legal_fee_pence : 0;
  const salesPhasing = 'sales_phasing' in inputs ? inputs.sales_phasing : null;
  if (grossSales > 0) {
    if (salesPhasing == null) {
      // calc 2.2.0 behaviour, byte-identical: single disposal in the final month (spec §4.4)
      receipts[term - 1] = {
        gross_sale_pence: grossSales,
        agent_fee_pence: agentFee,
        selling_legal_pence: sellingLegal,
        vat_reclaim_pence: 0,
        net_operating_income_pence: 0,
      };
    } else {
      // spec §4.4.1: tranche split with final-tranche residue absorption; selling
      // costs apportioned pro-rata by tranche gross, final tranche absorbs.
      // Month clamps are belt-and-braces — validation.ts owns the real rules.
      const trs = salesPhasing.tranches;
      let grossAllocated = 0, agentAllocated = 0, legalAllocated = 0;
      trs.forEach((tr, i) => {
        const last = i === trs.length - 1;
        const gross = last ? grossSales - grossAllocated
          : Math.round((grossSales * tr.pct_of_gross_receipts) / 100);
        const agent = last ? agentFee - agentAllocated
          : Math.round((agentFee * gross) / grossSales);
        const legal = last ? sellingLegal - legalAllocated
          : Math.round((sellingLegal * gross) / grossSales);
        grossAllocated += gross; agentAllocated += agent; legalAllocated += legal;
        const anchor = 'anchor' in tr ? (tr as SalesPhasingTrancheV9).anchor : null;
        const m = Math.min(Math.max(0, Math.floor(resolveAnchorMonth(anchor, tr.month_offset))), term - 1);
        receipts[m].gross_sale_pence += gross;
        receipts[m].agent_fee_pence += agent;
        receipts[m].selling_legal_pence += legal;
      });
    }
  }

  // R13 spec §19.6. Computed here — after `resolveAnchorMonth` exists and
  // after receipts are fully built by the exit/sales section above — because
  // §19's whole point is that it runs in ONE direction: it must not see a
  // ledger balance, and nothing downstream may feed a figure back into it.
  // Placed AFTER the exit/sales section deliberately: that section's
  // single-disposal arm does a full `receipts[term - 1] = {...}` object
  // replace, which would silently wipe an NOI figure written before it.
  const investmentCase = computeInvestmentCase(inputs, term, resolveAnchorMonth);
  if (investmentCase != null) {
    investmentCase.months.forEach((mo, m) => {
      receipts[m].net_operating_income_pence = mo.noi_pence;
    });
  }

  // spec §4.5 net refinance proceeds — wired into the ledger by the refinance task.
  const refinanceInput = 'refinance' in inputs ? inputs.refinance : null;
  const refinance = refinanceInput == null ? null : {
    month: Math.min(Math.max(0, Math.floor(resolveAnchorMonth(
      'anchor' in refinanceInput ? (refinanceInput as RefinanceInputsV9).anchor : null,
      refinanceInput.month_offset,
    ))), term - 1),
    // R13 spec §19.4/§19.5. A non-null investment case SUPERSEDES the explicit
    // pair: the advance is the sized quantum, and the arrangement fee may be a
    // percentage of it. `investment_value_pence`/`ltv_pct` are null on that path
    // (§19.7 rule 5), which is why this branches rather than multiplying.
    net_proceeds_pence: (() => {
      const legal = refinanceInput.legal_costs_pence;
      if (investmentCase != null) {
        const q = investmentCase.takeout.quantum_pence;
        const basis = (refinanceInput as RefinanceInputsV10).arrangement_fee_basis ?? 'fixed_pence';
        const fee = basis === 'pct_of_quantum'
          ? Math.round((q * (refinanceInput as RefinanceInputsV10).arrangement_fee_pct) / 100)
          : refinanceInput.arrangement_fee_pence;
        return q - fee - legal;
      }
      return Math.round(
        ((refinanceInput.investment_value_pence ?? 0) * (refinanceInput.ltv_pct ?? 0)) / 100,
      ) - refinanceInput.arrangement_fee_pence - legal;
    })(),
  };

  const sellingCosts = grossSales > 0 ? agentFee + sellingLegal : 0;

  // R11 spec §17.6. VAT is computed from the finished spend profile and written
  // back onto it. One pass, and strictly one-directional: nothing above this line
  // reads VAT, so a VAT figure can never feed a base that feeds VAT (§17.5).
  // `cost_before_finance_ex_selling_pence` below must NOT gain VAT — irrecoverable
  // VAT enters cost-before-finance in Task 8, at the metrics layer, on its own line.
  const vat = computeVat(inputs, costPlan, { term_months: term, uses, receipts });
  vat.months.forEach((mo, m) => {
    uses[m].vat_pence = mo.incurred_pence;
    receipts[m].vat_reclaim_pence = mo.reclaimed_pence;
  });

  return {
    term_months: term,
    uses,
    receipts,
    refinance,
    totals: {
      acquisition_pence: acquisitionTotal,
      construction_pence: constructionTotal,
      professional_pence: professionalTotal,
      statutory_pence: statutoryTotal,
      selling_costs_pence: sellingCosts,
      gross_sales_pence: grossSales,
      gdv_pence: gdv,
      retained_value_pence: retainedValue,
      cost_before_finance_ex_selling_pence:
        acquisitionTotal + constructionTotal + professionalTotal + statutoryTotal,
      vat_pence: vat.total_input_vat_pence,
      vat_reclaim_pence: vat.total_reclaimed_pence,
      irrecoverable_vat_pence: vat.total_irrecoverable_pence,
      // R13 spec §19.5/§19.6. Republished from `investmentCase.totals.noi_pence`
      // — the schedule-wide sum already computed once inside
      // `computeInvestmentCase` — never re-summed here. 0 on the null path.
      net_operating_income_pence: investmentCase?.totals.noi_pence ?? 0,
    },
    vat,
    // R12 spec §18.10/§18.5. null on the auto-window and legacy-explicit-
    // programme paths, exactly as their input is (decision 6); the derived
    // `{finish_month, critical_path, phases}` block for a v9 network,
    // computed above and null-only if that network contains a cycle
    // (unreachable post-validation).
    programme: programmeResult,
    // R13 spec §19.6. null exactly when the INPUT `investment_case` is null —
    // no block is synthesised for a document that never asked for one. The
    // result block is computed once, here, and republished (never
    // recomputed) onto `AppraisalResultV2` by Task 11.
    investment_case: investmentCase,
    // R13 spec §19.6, closing §18.10 limitation 9. The memo and CashflowPage
    // print a tranche's month; before this field existed they printed the RAW
    // `month_offset` while the ledger used the resolved one, so an anchored
    // tranche on a slipped programme was reported at a month the ledger never
    // used. They read this instead.
    resolved_exit_months: {
      tranches: salesPhasing == null ? [] : salesPhasing.tranches.map((tr) => Math.min(
        Math.max(0, Math.floor(resolveAnchorMonth(
          'anchor' in tr ? (tr as SalesPhasingTrancheV9).anchor : null, tr.month_offset,
        ))), term - 1,
      )),
      refinance: refinance == null ? null : refinance.month,
    },
    // R14 spec §4.2(b). Computed once on the cost plan, republished here so the
    // ledger reads one figure and never re-derives it.
    lender_eligible_ratio: costPlan.lender_eligible_ratio,
  };
}
