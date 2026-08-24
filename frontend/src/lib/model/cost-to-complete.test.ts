import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { computeCostToComplete } from './cost-to-complete';
import { runLedger } from './monthly-engine';
import { buildSchedule } from './schedule';
import { DEFAULT_FACILITY_TERMS, defaultCalculatorInputsV2 } from '../conversion-defaults';
import type {
  CalculatorInputsV2, CalculatorInputsV3, EquitySource, FacilityTerms, MonthReceipts, MonthUses, Schedule,
} from './finance-types';
import type { VatResult } from './vat';

// Self-contained helpers, deliberately duplicated from monthly-engine.test.ts (per this repo's
// "tests must be self-contained" convention) rather than imported/exported, so this fixture-B
// worksheet stays pinned to the exact schedule/ledger inputs it was hand-derived against.
function uses(partial: Partial<MonthUses>): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0, vat_pence: 0, ...partial,
  };
}
function receipts(partial: Partial<MonthReceipts>): MonthReceipts {
  return {
    gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0, vat_reclaim_pence: 0,
    net_operating_income_pence: 0, ...partial,
  };
}
// R11: no test in this file exercises VAT — an inert result of the schedule's
// own length, mirroring vat.ts's inertVat() shape exactly.
function emptyVat(termMonths: number): VatResult {
  return {
    registered: false, charges: [], periods: [],
    months: Array.from({ length: termMonths }, (_, month) => (
      { month, incurred_pence: 0, reclaimed_pence: 0, carry_pence: 0 }
    )),
    total_input_vat_pence: 0, total_recoverable_pence: 0, total_irrecoverable_pence: 0,
    total_reclaimed_pence: 0, receivable_at_maturity_pence: 0, peak_carry_pence: 0, peak_carry_month: null,
    purchase_vat_pence: 0, purchase_vat_chargeable: false, purchase_evidence_status: 'unconfirmed',
  };
}
function mkSchedule(u: MonthUses[], r: MonthReceipts[]): Schedule {
  const sum = (f: (x: MonthUses) => number) => u.reduce((a, x) => a + f(x), 0);
  const grossSales = r.reduce((a, x) => a + x.gross_sale_pence, 0);
  const selling = r.reduce((a, x) => a + x.agent_fee_pence + x.selling_legal_pence, 0);
  return {
    term_months: u.length, uses: u, receipts: r, refinance: null,
    totals: {
      acquisition_pence: sum((x) => x.acquisition_pence),
      construction_pence: sum((x) => x.construction_pence),
      professional_pence: sum((x) => x.professional_pence),
      statutory_pence: sum((x) => x.statutory_pence),
      selling_costs_pence: selling, gross_sales_pence: grossSales,
      gdv_pence: grossSales, retained_value_pence: 0,
      cost_before_finance_ex_selling_pence:
        sum((x) => x.acquisition_pence + x.construction_pence + x.professional_pence + x.statutory_pence),
      vat_pence: sum((x) => x.vat_pence),
      vat_reclaim_pence: r.reduce((a, x) => a + x.vat_reclaim_pence, 0),
      irrecoverable_vat_pence: 0,
      net_operating_income_pence: r.reduce((a, x) => a + x.net_operating_income_pence, 0),
    },
    vat: emptyVat(u.length),
    programme: null,
    investment_case: null,
    unit_sales: null,
    resolved_exit_months: { tranches: [], refinance: null },
    // R14 spec §4.2(b). 1 is the all-eligible / headline value, so these
    // hand-built schedules keep the pre-R14 cap base exactly.
    lender_eligible_ratio: 1,
  };
}

const TERMS: FacilityTerms = {
  ...DEFAULT_FACILITY_TERMS,
  funding_source: 'development_finance',
  day_one_advance_pence: 30_000_000,
  committed_net_facility_pence: 50_000_000,
  committed_gross_facility_pence: 55_000_000,
  annual_interest_rate_pct: 12,
  interest_type: 'rolled_up',
  arrangement_fee_pct: 2, arrangement_fee_basis: 'committed_net_facility',
  exit_fee_pct: 1, exit_fee_basis: 'committed_gross_facility',
  term_months: 4, equity_draw_rule: 'equity_first', sales_sweep_pct: 100,
};

function cashEquity(amount: number): EquitySource[] {
  return [{
    id: 'e1', classification: 'cash', amount_pence: amount, timing_month: 0,
    repayment_priority: 1, evidence_status: 'confirmed', notes: '',
  }];
}

// computeCostToComplete reads inputs.equity_sources and (R14, C1) inputs.finance.interest_type
// — every other field is default filler from defaultCalculatorInputsV2(), matching
// metrics.test.ts's own convention. `finance` defaults to that same default (rolled_up,
// matching TERMS) and is only passed explicitly where a test's `terms` diverges from it.
function inputsWithEquity(equitySources: EquitySource[], finance?: FacilityTerms): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.equity_sources = equitySources;
  if (finance) inputs.finance = finance;
  return inputs;
}

const USES = [
  uses({ acquisition_pence: 40_000_000 }),
  uses({ construction_pence: 15_000_000 }),
  uses({ construction_pence: 10_000_000 }),
  uses({}),
];
const SALE = [
  receipts({}), receipts({}), receipts({}),
  receipts({ gross_sale_pence: 80_000_000, agent_fee_pence: 1_600_000 }),
];

describe('computeCostToComplete — Fixture B worksheet (spec §5.10, rolled-up interest)', () => {
  // Hand-derived (docs/financial-model/test-cases.md) from monthly-engine.test.ts's Fixture B
  // pinned ledger columns: draw/capitalised-fees/interest/closing-balance/equity-contribution
  // per month, and undrawn_net_facility_pence derived from those (net facility 50,000,000 minus
  // cumulative net used). Independently cross-checked with a scratch Python script reproducing
  // this exact formula before being written here (see task-6-report.md).
  const schedule = mkSchedule(USES, SALE);
  const model = runLedger(schedule, TERMS, cashEquity(30_000_000));
  const ctc = computeCostToComplete(schedule, model, inputsWithEquity(cashEquity(30_000_000), TERMS));

  // R14 (C1, spec §5.10 rewritten): TERMS is a rolled-up facility with a real
  // 5,000,000p reserve (committed_gross 55,000,000 − committed_net 50,000,000), so
  // remaining_funding_pence and surplus_pence both gain the reserve's unconsumed part
  // (5,000,000 − cumulative interest_capitalised_pence through m − 1, i.e. 4,690,000 /
  // 4,376,900 / 4,010,669 / 3,640,776 — hand-derived in docs/financial-model/test-cases.md
  // Step 1, cross-checked against this exact computation). remaining_cost_pence is untouched.
  it('reproduces the hand-derived month series to the penny', () => {
    expect(ctc.months).toEqual([
      {
        month: 1, remaining_cost_pence: 26_049_224, remaining_funding_pence: 43_690_000,
        remaining_interest_reserve_headroom_pence: 4_690_000, surplus_pence: 17_640_776,
      },
      {
        month: 2, remaining_cost_pence: 10_736_124, remaining_funding_pence: 28_376_900,
        remaining_interest_reserve_headroom_pence: 4_376_900, surplus_pence: 17_640_776,
      },
      {
        month: 3, remaining_cost_pence: 369_893, remaining_funding_pence: 18_010_669,
        remaining_interest_reserve_headroom_pence: 4_010_669, surplus_pence: 17_640_776,
      },
      {
        month: 4, remaining_cost_pence: 0, remaining_funding_pence: 17_640_776,
        remaining_interest_reserve_headroom_pence: 3_640_776, surplus_pence: 17_640_776,
      },
    ]);
  });

  it('is fully funded throughout: no shortfall', () => {
    expect(ctc.first_shortfall_month).toBeNull();
    expect(ctc.max_shortfall_pence).toBe(0);
  });

  it('telescoping identity: remaining_cost(m) = remaining_cost(m+1) + cost(month m+1)', () => {
    // cost(label m+1) = uses[m] (0-based) + ledger.months[m].interest_accrued + capitalised_fees.
    const costOfLabel = (m: number) => {
      const u = schedule.uses[m - 1];
      const lm = model.months[m - 1];
      return u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence
        + u.lender_ancillary_fees_pence + lm.interest_accrued_pence + lm.capitalised_fees_pence;
    };
    for (let m = 1; m < ctc.months.length; m++) {
      expect(ctc.months[m - 1].remaining_cost_pence).toBe(
        ctc.months[m].remaining_cost_pence + costOfLabel(m + 1),
      );
    }
  });

  it('boundary identity: month-1 horizon equals total cost minus month-0 spend', () => {
    const totalCost = schedule.uses.reduce(
      (s, u) => s + u.acquisition_pence + u.construction_pence + u.professional_pence
        + u.statutory_pence + u.lender_ancillary_fees_pence, 0,
    ) + model.months.reduce((s, m) => s + m.interest_accrued_pence + m.capitalised_fees_pence, 0);
    const month0Spend =
      schedule.uses[0].acquisition_pence + schedule.uses[0].construction_pence
      + schedule.uses[0].professional_pence + schedule.uses[0].statutory_pence
      + schedule.uses[0].lender_ancillary_fees_pence
      + model.months[0].interest_accrued_pence + model.months[0].capitalised_fees_pence;
    expect(ctc.months[0].remaining_cost_pence).toBe(totalCost - month0Spend);
  });
});

describe('computeCostToComplete — cash-deal path (spec §5.10, undrawn facility is 0 not null-crash)', () => {
  // Same USES/SALE as Fixture B, funding_source: 'cash', equity exactly equal to total cost
  // (65,000,000) — hand-derived: every month's surplus is exactly 0 (not negative), pinning the
  // strict `surplus < 0` shortfall test (0 is not a shortfall) on a cash deal where
  // undrawn_net_facility_pence is null throughout (no facility at all, not merely undrawn).
  const schedule = mkSchedule(USES, SALE);
  const cashTerms: FacilityTerms = { ...TERMS, funding_source: 'cash' };
  const model = runLedger(schedule, cashTerms, cashEquity(65_000_000));
  const ctc = computeCostToComplete(schedule, model, inputsWithEquity(cashEquity(65_000_000), cashTerms));

  it('reproduces the hand-derived month series to the penny', () => {
    expect(ctc.months).toEqual([
      {
        month: 1, remaining_cost_pence: 25_000_000, remaining_funding_pence: 25_000_000,
        remaining_interest_reserve_headroom_pence: 0, surplus_pence: 0,
      },
      {
        month: 2, remaining_cost_pence: 10_000_000, remaining_funding_pence: 10_000_000,
        remaining_interest_reserve_headroom_pence: 0, surplus_pence: 0,
      },
      {
        month: 3, remaining_cost_pence: 0, remaining_funding_pence: 0,
        remaining_interest_reserve_headroom_pence: 0, surplus_pence: 0,
      },
      {
        month: 4, remaining_cost_pence: 0, remaining_funding_pence: 0,
        remaining_interest_reserve_headroom_pence: 0, surplus_pence: 0,
      },
    ]);
  });

  it('null undrawn_net_facility_pence contributes 0, not a crash or a shortfall', () => {
    expect(model.months.every((m) => m.undrawn_net_facility_pence === null)).toBe(true);
    // Exactly-zero surplus is not a shortfall: `< 0`, not `<= 0`.
    expect(ctc.first_shortfall_month).toBeNull();
    expect(ctc.max_shortfall_pence).toBe(0);
  });
});

describe('computeCostToComplete — serviced interest gets no reserve credit (spec §5.10, R14 C1)', () => {
  // C1 (spec §5.10, R14) credits a rolled-up facility's unconsumed interest reserve to
  // remaining funding. Serviced interest is a committed-equity use (§4.3), not rolled up,
  // so it must be unaffected: remaining_interest_reserve_headroom_pence is 0 throughout and
  // remaining_funding_pence is exactly undrawn_net_facility + remaining_cash_equity,
  // recomputed here from the ledger rather than read back off the summary (a constant added
  // to both sides of that recomputation would slip past it — the golden fixtures' unchanged
  // pins are the catch for that, per fixture reconciliation below).
  //
  // No golden fixture in fixtures/financial-model carries `interest_type: 'serviced'` — all
  // sixteen are rolled-up (verified: `grep -rl serviced fixtures/financial-model` is empty) —
  // so scanning the corpus the way the shortfall-direction test below does would vacuously
  // pass with zero cases matched. This test instead builds its own local scenarios, the same
  // way Fixture E/F above do, and asserts at least one actually ran.
  const scenarios: Array<{ label: string; terms: FacilityTerms; equityPence: number }> = [
    { label: 'Fixture B terms, serviced', terms: { ...TERMS, interest_type: 'serviced' }, equityPence: 30_000_000 },
    {
      label: 'Fixture E terms (lower net facility), serviced',
      terms: { ...TERMS, interest_type: 'serviced', committed_net_facility_pence: 35_000_000 },
      equityPence: 25_000_000,
    },
  ];
  let sawServicedCase = false;

  for (const { label, terms, equityPence } of scenarios) {
    it(`${label}: zero reserve headroom, remaining_funding excludes it`, () => {
      const schedule = mkSchedule(USES, SALE);
      const model = runLedger(schedule, terms, cashEquity(equityPence));
      const ctc = computeCostToComplete(schedule, model, inputsWithEquity(cashEquity(equityPence), terms));

      let cumEquityContributed = 0;
      for (let m = 1; m <= schedule.term_months; m++) {
        const prevLedgerMonth = model.months[m - 1];
        cumEquityContributed += prevLedgerMonth.equity_contribution_pence;
        const undrawnFacility = prevLedgerMonth.undrawn_net_facility_pence ?? 0;
        const remainingCashEquity = Math.max(0, equityPence - cumEquityContributed);
        expect(ctc.months[m - 1].remaining_interest_reserve_headroom_pence, `month ${m}`).toBe(0);
        expect(ctc.months[m - 1].remaining_funding_pence, `month ${m}`).toBe(undrawnFacility + remainingCashEquity);
      }
      sawServicedCase = true;
    });
  }

  it('at least one serviced scenario was exercised', () => {
    expect(sawServicedCase).toBe(true);
  });
});

describe('computeCostToComplete — shortfall direction against funding_gap_pence (spec §5.10 note)', () => {
  it('Fixture E (real funding gap): the series also reports a genuine shortfall', () => {
    // monthly-engine.test.ts's Fixture E: committed_net_facility_pence lowered to 35,000,000,
    // equity lowered to 25,000,000 — a real, pinned funding_gap_pence of 5,700,000 at month 2.
    // R14 (C1): monthly-engine.test.ts's Fixture E leaves committed_gross_facility_pence at
    // TERMS' 55,000,000 while only cutting the net facility, so its reserve balloons to
    // 20,000,000 — four times TERMS' own 5,000,000 reserve and far more than this schedule's
    // total interest. Once the reserve is credited (this task), that oversized, unrealistic
    // reserve swallows the whole shortfall, which would prove nothing about a genuine gap. This
    // test keeps TERMS' 5,000,000 reserve proportion (committed_gross = net + 5,000,000) so the
    // facility stays a plausible one and the gap the ledger reports is still genuinely unfunded.
    const terms: FacilityTerms = {
      ...TERMS, committed_net_facility_pence: 35_000_000, committed_gross_facility_pence: 40_000_000,
    };
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, terms, cashEquity(25_000_000));
    const ctc = computeCostToComplete(schedule, model, inputsWithEquity(cashEquity(25_000_000), terms));
    expect(model.totals.funding_gap_pence).toBeGreaterThan(0);
    expect(ctc.first_shortfall_month).not.toBeNull();
    expect(ctc.max_shortfall_pence).toBeGreaterThan(0);
  });

  it('Fixture F-grosscap: a real funding_gap can exist with NO cost-to-complete shortfall ' +
    '— proves the full iff cannot be asserted, only shortfall ⇒ gap', () => {
    // monthly-engine.test.ts's "Fixture F — draws are capped by gross facility headroom" has a
    // real, pinned funding_gap_pence of 484,487 (month 2's draw is throttled below what's
    // needed by the gross-headroom cap, spec §4.2(c)). computeCostToComplete's snapshot-based
    // remaining_funding does not re-simulate that future throttling — it just reads the actual
    // (already-computed) undrawn_net_facility_pence at each past month boundary — so it never
    // sees the month-2 shortfall coming: this is the documented, deliberate scope limit (spec
    // §5.10 "Known limitation"), not a bug.
    const terms: FacilityTerms = { ...TERMS, committed_gross_facility_pence: 36_500_000 };
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, terms, cashEquity(30_000_000));
    const ctc = computeCostToComplete(schedule, model, inputsWithEquity(cashEquity(30_000_000), terms));
    expect(model.totals.funding_gap_pence).toBe(484_487); // pinned in monthly-engine.test.ts
    expect(ctc.first_shortfall_month).toBeNull();
    expect(ctc.max_shortfall_pence).toBe(0);
  });

  // R9 Task 12 found fixture P a natural counter-example to the remaining direction: a
  // rolled-up facility structured the way a real one is (net sized to costs, reserve
  // carved out of gross) reported a phantom shortfall because §5.10 charged rolled-up
  // interest against the net facility alone. R14 closed that defect (C1, spec §5.10
  // rewritten, calc 2.13.0) by crediting the unconsumed reserve to remaining funding, so
  // fixture P's series now clears at every month and the list below is empty. It stays
  // empty ON PURPOSE, not deleted: a future fixture that reproduces "shortfall with no
  // gap" has a declared home here and must be listed deliberately rather than silently
  // passing as a new positive case. Mirrors the Python twin.
  const SHORTFALL_WITHOUT_GAP_STEMS: string[] = [];

  it('holds across every golden fixture: shortfall ⇒ some ledger month has funding_gap_pence > 0', () => {
    const fixtureDir = resolve(__dirname, '../../../../fixtures/financial-model');
    const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
    let sawPositiveCase = false;
    for (const f of files) {
      const fx = JSON.parse(readFileSync(join(fixtureDir, f), 'utf-8')) as {
        kind: string; inputs: CalculatorInputsV3;
      };
      // Release 4a: Fixture K (kind 'sensitivity', spec §12) carries no `inputs` of its
      // own — it names a `base_fixture` instead (model-governance.md §2.1) — so it has no
      // ledger of its own to check this implication against.
      if (fx.kind === 'sensitivity') continue;
      const schedule = buildSchedule(fx.inputs);
      const model = runLedger(schedule, fx.inputs.finance, fx.inputs.equity_sources);
      const ctc = computeCostToComplete(schedule, model, fx.inputs);
      if (SHORTFALL_WITHOUT_GAP_STEMS.includes(f)) {
        // Asserted, not merely skipped: if a future change made the metric agree with the
        // ledger here, this fixture must be taken off the list deliberately rather than
        // drift off it in silence.
        expect(ctc.first_shortfall_month, f).not.toBeNull();
        expect(model.totals.funding_gap_pence, f).toBe(0);
        continue;
      }
      if (ctc.first_shortfall_month !== null) {
        expect(model.totals.funding_gap_pence, f).toBeGreaterThan(0);
        sawPositiveCase = true;
      }
    }
    // Guards against the implication holding only vacuously across the corpus.
    expect(sawPositiveCase).toBe(true);
  });
});
