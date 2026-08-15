import type { AnyCalculatorInputs, MonthReceipts, MonthUses, ProgrammePackage, Schedule } from './finance-types';
import {
  calculateGdv, calculateTotalAcquisitionCost, calculateTotalConstructionCost,
} from '../conversion-calc-engine';
import { spreadByCurve } from './curves';

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
    statutory_pence: 0, lender_ancillary_fees_pence: 0,
  };
}

function emptyReceipts(): MonthReceipts {
  return { gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0 };
}

export function buildSchedule(inputs: AnyCalculatorInputs): Schedule {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const cc = inputs.conversion_costs;
  const units = inputs.unit_mix.units;

  const acquisitionTotal = calculateTotalAcquisitionCost(inputs.acquisition);
  const constructionTotal = calculateTotalConstructionCost(cc);
  // Reclassification per spec §3.5/§3.6: professional excludes statutory items.
  const professionalTotal =
    cc.architect_pence + cc.structural_engineer_pence + cc.mande_pence +
    cc.planning_consultant_pence + cc.other_professional_fees_pence;
  const priorApproval = cc.prior_approval_fee_per_dwelling_pence * Math.max(1, units.length);
  const statutorySpreadTotal = cc.cil_s106_pence + cc.building_control_pence;
  const statutoryTotal = priorApproval + statutorySpreadTotal;

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
  const grossSales = soldUnits.reduce((s, u) => s + u.estimated_value_pence, 0);
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
    },
  };
}
