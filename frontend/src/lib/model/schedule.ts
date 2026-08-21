import type { AnyCalculatorInputs, MonthReceipts, MonthUses, ProgrammePackage, Schedule } from './finance-types';
import {
  calculateGdv, calculateTotalAcquisitionCost, unitAncillaryValuePence,
} from '../conversion-calc-engine';
import { developedAreaSqm } from './areas';
import { spreadByCurve } from './curves';
import { computeCostPlan } from './cost-plan';
import { computeVat } from './vat';

/** Straight-line spread in integer pence; the final month absorbs the rounding residue. */
export function spreadStraightLine(total: number, months: number): number[] {
  if (months <= 0) return [];
  const per = Math.round(total / months);
  const out: number[] = new Array(months).fill(per);
  out[months - 1] = total - per * (months - 1);
  return out;
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
  };
}

export function buildSchedule(inputs: AnyCalculatorInputs): Schedule {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const units = inputs.unit_mix.units;

  const acquisitionTotal = calculateTotalAcquisitionCost(inputs.acquisition);
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
  uses[0].statutory_pence += priorApproval;

  const programme = 'programme' in inputs ? inputs.programme : null;

  if (programme == null) {
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
    place(programme.packages.construction, constructionTotal, (m, v) => { uses[m].construction_pence += v; });
    place(programme.packages.professional, professionalTotal, (m, v) => { uses[m].professional_pence += v; });
    place(programme.packages.statutory, statutorySpreadTotal, (m, v) => { uses[m].statutory_pence += v; });
  }

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
        const m = Math.min(Math.max(0, Math.floor(tr.month_offset)), term - 1);
        receipts[m].gross_sale_pence += gross;
        receipts[m].agent_fee_pence += agent;
        receipts[m].selling_legal_pence += legal;
      });
    }
  }

  // spec §4.5 net refinance proceeds — wired into the ledger by the refinance task.
  const refinanceInput = 'refinance' in inputs ? inputs.refinance : null;
  const refinance = refinanceInput == null ? null : {
    month: Math.min(Math.max(0, Math.floor(refinanceInput.month_offset)), term - 1),
    net_proceeds_pence:
      Math.round((refinanceInput.investment_value_pence * refinanceInput.ltv_pct) / 100)
      - refinanceInput.arrangement_fee_pence - refinanceInput.legal_costs_pence,
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
    },
    vat,
  };
}
