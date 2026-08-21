import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runLedger } from './monthly-engine';
import { buildSchedule } from './schedule';
import { reconcile } from './validation';
import { DEFAULT_FACILITY_TERMS, defaultCalculatorInputsV2 } from '../conversion-defaults';
import type {
  CalculatorInputsV3, EquitySource, FacilityTerms, MonthReceipts, MonthUses, Schedule,
} from './finance-types';
import type { VatResult } from './vat';

function uses(partial: Partial<MonthUses>): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0, vat_pence: 0, ...partial,
  };
}
function receipts(partial: Partial<MonthReceipts>): MonthReceipts {
  return {
    gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0, vat_reclaim_pence: 0, ...partial,
  };
}
// R11: the VAT block itself is never read by the ledger — the ledger reads only
// `uses[m].vat_pence` and `receipts[m].vat_reclaim_pence`, which the VAT engine
// writes back. So every schedule built here carries an inert result of the
// schedule's own length, mirroring vat.ts's inertVat() shape exactly.
function emptyVat(termMonths: number): VatResult {
  return {
    registered: false, charges: [], periods: [],
    months: Array.from({ length: termMonths }, (_, month) => (
      { month, incurred_pence: 0, reclaimed_pence: 0, carry_pence: 0 }
    )),
    total_input_vat_pence: 0, total_recoverable_pence: 0, total_irrecoverable_pence: 0,
    total_reclaimed_pence: 0, receivable_at_maturity_pence: 0, peak_carry_pence: 0, peak_carry_month: null,
    purchase_vat_pence: 0,
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
    },
    vat: emptyVat(u.length),
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

function equity(amount: number): EquitySource[] {
  return [{
    id: 'e1', classification: 'cash', amount_pence: amount, timing_month: 0,
    repayment_priority: 1, evidence_status: 'confirmed', notes: '',
  }];
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
const NO_SALE = [receipts({}), receipts({}), receipts({}), receipts({})];

describe('Fixture B — rolled-up interest (spec §8)', () => {
  const model = () => runLedger(mkSchedule(USES, SALE), TERMS, equity(30_000_000));

  it('reproduces the hand-computed ledger to the penny', () => {
    const m = model();
    expect(m.months[0].draw_pence).toBe(30_000_000);
    expect(m.months[0].capitalised_fees_pence).toBe(1_000_000);
    expect(m.months[0].interest_accrued_pence).toBe(310_000);
    expect(m.months[0].closing_balance_pence).toBe(31_310_000);
    expect(m.months[0].equity_contribution_pence).toBe(10_000_000);
    expect(m.months[1].interest_accrued_pence).toBe(313_100);
    expect(m.months[1].closing_balance_pence).toBe(31_623_100);
    expect(m.months[2].draw_pence).toBe(5_000_000);
    expect(m.months[2].equity_contribution_pence).toBe(5_000_000);
    expect(m.months[2].interest_accrued_pence).toBe(366_231);
    expect(m.months[2].closing_balance_pence).toBe(36_989_331);
    expect(m.months[3].interest_accrued_pence).toBe(369_893);
    expect(m.months[3].exit_fee_pence).toBe(550_000);
    expect(m.months[3].repayment_pence).toBe(37_359_224);
    expect(m.months[3].closing_balance_pence).toBe(0);
    expect(m.months[3].distribution_pence).toBe(40_490_776);
  });

  it('reports peak debt, totals and equity flows correctly', () => {
    const m = model();
    expect(m.peak_debt_pence).toBe(37_359_224);
    expect(m.peak_debt_month).toBe(3);
    expect(m.day_one_advance_pence).toBe(30_000_000);
    expect(m.totals.interest_pence).toBe(1_359_224);
    expect(m.totals.finance_costs_pence).toBe(1_359_224 + 1_000_000 + 550_000);
    expect(m.equity_cashflows_pence).toEqual([-10_000_000, -15_000_000, -5_000_000, 40_490_776]);
    expect(m.senior_outstanding_at_maturity_pence).toBe(0);
  });

  it('debt roll-forward reconciles every month', () => {
    for (const mo of model().months) {
      expect(mo.closing_balance_pence).toBe(
        mo.opening_balance_pence + mo.draw_pence + mo.capitalised_fees_pence
        + mo.interest_capitalised_pence - mo.repayment_pence,
      );
      expect(mo.closing_balance_pence).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Fixture C — serviced interest differs from rolled-up', () => {
  const terms: FacilityTerms = { ...TERMS, interest_type: 'serviced' };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(32_000_000));

  it('keeps the balance flat and funds interest from equity', () => {
    const m = model();
    expect(m.months[0].interest_serviced_pence).toBe(310_000);
    expect(m.months[0].interest_capitalised_pence).toBe(0);
    expect(m.months[0].closing_balance_pence).toBe(31_000_000);
    expect(m.months[0].equity_contribution_pence).toBe(10_310_000);
    expect(m.months[1].closing_balance_pence).toBe(31_000_000);
    // m2: committed equity remaining 6,380,000 → costs part-funded, draw 3,620,000
    expect(m.months[2].equity_contribution_pence).toBe(6_380_000);
    expect(m.months[2].draw_pence).toBe(3_620_000);
    expect(m.months[2].interest_serviced_pence).toBe(346_200);
    expect(m.months[2].additional_equity_pence).toBe(346_200);
    expect(m.months[3].additional_equity_pence).toBe(346_200);
  });

  it('produces materially different peak debt and interest from rolled-up', () => {
    const m = model();
    expect(m.peak_debt_pence).toBe(34_620_000);
    expect(m.totals.interest_pence).toBe(1_312_400);
    expect(m.totals.additional_equity_pence).toBe(692_400);
    expect(m.flags.some((f) => f.code === 'additional_equity_required')).toBe(true);
    expect(m.months[3].distribution_pence).toBe(43_230_000);
    // profit identity: Σ equity flows = 80,000,000 − TDC(69,462,400) = 10,537,600
    expect(m.equity_cashflows_pence.reduce((a, b) => a + b, 0)).toBe(10_537_600);
  });
});

describe('Fixture D — retain_all books no receipts and flags outstanding debt', () => {
  const model = () => runLedger(mkSchedule(USES, NO_SALE), TERMS, equity(30_000_000));

  it('leaves the senior balance outstanding at maturity with no distributions', () => {
    const m = model();
    expect(m.months[3].repayment_pence).toBe(0);
    expect(m.months[3].closing_balance_pence).toBe(37_359_224);
    expect(m.senior_outstanding_at_maturity_pence).toBe(37_359_224);
    expect(m.totals.exit_fee_pence).toBe(0);
    expect(m.totals.distributions_pence).toBe(0);
    expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity' && f.severity === 'red')).toBe(true);
    expect(m.equity_cashflows_pence).toEqual([-10_000_000, -15_000_000, -5_000_000, 0]);
  });
});

describe('Fixture E — funding gap: overruns never create facility', () => {
  const terms: FacilityTerms = { ...TERMS, committed_net_facility_pence: 35_000_000 };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(25_000_000));

  it('caps the draw at undrawn net facility and records the gap', () => {
    const m = model();
    // Arrangement fee recomputes from its basis: 2% × committed net facility (£350,000) = £7,000.
    expect(m.months[0].capitalised_fees_pence).toBe(700_000);
    expect(m.months[2].draw_pence).toBe(4_300_000);
    expect(m.months[2].funding_gap_pence).toBe(5_700_000);
    expect(m.totals.funding_gap_pence).toBe(5_700_000);
    const gap = m.flags.find((f) => f.code === 'funding_gap');
    expect(gap?.severity).toBe('red');
    expect(gap?.month).toBe(2);
    expect(m.months[2].closing_balance_pence).toBe(35_973_241);
    expect(m.months[3].repayment_pence).toBe(36_332_973);
    expect(m.months[3].distribution_pence).toBe(41_517_027);
  });
});

describe('Fixture F — draws are capped by gross facility headroom after projected interest (spec §4.2c)', () => {
  const terms: FacilityTerms = { ...TERMS, committed_gross_facility_pence: 36_500_000 };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(30_000_000));

  it('caps the month-2 draw so the closing balance cannot exceed committed gross facility', () => {
    const m = model();
    // Months 0-1 identical to Fixture B: gross headroom does not bind while balances are low.
    expect(m.months[1].closing_balance_pence).toBe(31_623_100);
    // m2: needed draw 5,000,000, but grossHeadroomCap = floor(36,500,000/1.01) − 31,623,100
    // = 36,138,613 − 31,623,100 = 4,515,513.
    expect(m.months[2].draw_pence).toBe(4_515_513);
    expect(m.months[2].equity_contribution_pence).toBe(5_000_000);
    expect(m.months[2].funding_gap_pence).toBe(484_487);
    expect(m.months[2].interest_accrued_pence).toBe(361_386);
    expect(m.months[2].closing_balance_pence).toBe(36_499_999);
    const gap = m.flags.find((f) => f.code === 'funding_gap');
    expect(gap).toBeDefined();
    for (const mo of m.months) {
      expect(mo.closing_balance_pence).toBeLessThanOrEqual(36_500_000);
    }
  });
});

describe('Fixture B variant — exit-fee vanishing band (spec §4.4, I2)', () => {
  // Fixture B's month-3 pre-repayment balance is 37,359,224 and its exit fee is
  // 550,000 (basis = committed_gross_facility, so the fee doesn't depend on the
  // receipt amount). agent_fee/selling_legal are zeroed here so net_receipt ==
  // gross_sale_pence == sweepAvailable at sales_sweep_pct 100, letting the
  // receipt be tuned to land exactly in/at the edge of the [balance, balance+fee)
  // band that used to zero the balance while silently dropping the fee.
  const BALANCE = 37_359_224;
  const FEE = 550_000;

  function saleOf(grossSale: number): MonthReceipts[] {
    return [receipts({}), receipts({}), receipts({}), receipts({ gross_sale_pence: grossSale })];
  }

  it('band case (sweep = balance + fee − 1p): balance carries, no exit fee, discharge withheld', () => {
    const schedule = mkSchedule(USES, saleOf(BALANCE + FEE - 1));
    const m = runLedger(schedule, TERMS, equity(30_000_000));
    expect(m.months[3].exit_fee_pence).toBe(0);
    expect(m.months[3].closing_balance_pence).toBe(1);
    expect(m.senior_outstanding_at_maturity_pence).toBe(1);
    expect(m.totals.exit_fee_pence).toBe(0);
    expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity' && f.severity === 'red')).toBe(true);

    // senior_repaid is false (debt outstanding); this is a warning-level issue
    // (spec: senior debt not repaid), so it does not by itself flip report_safe —
    // matching how retain_all's undischarged balance is treated (§4.4).
    const rec = reconcile(defaultCalculatorInputsV2(), schedule, m);
    expect(rec.senior_repaid).toBe(false);
    expect(rec.funding_complete).toBe(true);
    expect(rec.sources_equal_uses).toBe(true);
    expect(rec.debt_rollforward_ok).toBe(true);
  });

  it('boundary case (sweep = balance + fee exactly): full discharge with fee charged', () => {
    const schedule = mkSchedule(USES, saleOf(BALANCE + FEE));
    const m = runLedger(schedule, TERMS, equity(30_000_000));
    expect(m.months[3].exit_fee_pence).toBe(FEE);
    expect(m.months[3].closing_balance_pence).toBe(0);
    expect(m.senior_outstanding_at_maturity_pence).toBe(0);
    expect(m.totals.exit_fee_pence).toBe(FEE);
    expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity')).toBe(false);

    const rec = reconcile(defaultCalculatorInputsV2(), schedule, m);
    expect(rec.senior_repaid).toBe(true);
    expect(rec.funding_complete).toBe(true);
  });
});

describe('Fixture G — non-cash equity does not fund the waterfall (spec §2, C1)', () => {
  // The review's exploit: an unconfirmed planning_uplift source large enough to
  // cover every cost must not be treated as committed equity. Only
  // classification === 'cash' counts — evidence_status is irrelevant to a
  // non-cash source, since it was never eligible to fund in the first place.
  const nonCashEquity: EquitySource[] = [{
    id: 'e-uplift', classification: 'planning_uplift', amount_pence: 100_000_000,
    timing_month: 0, repayment_priority: 1, evidence_status: 'unconfirmed', notes: '',
  }];

  it('treats committed equity as zero, producing a funding gap from month 0', () => {
    const m = runLedger(mkSchedule(USES, SALE), TERMS, nonCashEquity);
    expect(m.months[0].equity_contribution_pence).toBe(0);
    expect(m.totals.funding_gap_pence).toBeGreaterThan(0);
    expect(m.flags.some((f) => f.code === 'funding_gap' && f.severity === 'red')).toBe(true);
  });

  it('does not fund costs even mixed with a rejected cash source', () => {
    const mixed: EquitySource[] = [
      ...nonCashEquity,
      { id: 'e-cash-rejected', classification: 'cash', amount_pence: 100_000_000, timing_month: 0, repayment_priority: 1, evidence_status: 'rejected', notes: '' },
    ];
    const m = runLedger(mkSchedule(USES, SALE), TERMS, mixed);
    expect(m.totals.funding_gap_pence).toBeGreaterThan(0);
  });
});

describe('Cash funding produces exactly zero debt cost', () => {
  it('has no draws, interest, or fees under cash', () => {
    const terms: FacilityTerms = { ...TERMS, funding_source: 'cash' };
    const m = runLedger(mkSchedule(USES, SALE), terms, equity(65_000_000));
    expect(m.totals.draws_pence).toBe(0);
    expect(m.totals.finance_costs_pence).toBe(0);
    expect(m.peak_debt_pence).toBe(0);
    expect(m.months.every((mo) => mo.closing_balance_pence === 0)).toBe(true);
    expect(m.totals.equity_contributed_pence).toBe(65_000_000);
  });
});

describe('redemption_balance_at_disposal_pence (spec §5.11, Release 2b Task 4)', () => {
  it('captures Fixture B\'s month-3 pre-repayment balance, matching peak debt and the repayment amount', () => {
    // Fixture B (§8): the only month with a sale (month 3) is also the peak-debt month, so
    // the pre-receipt balance equals both peak_debt_pence and repayment_pence — a useful
    // cross-check that the capture point sits exactly before the repayment block mutates
    // `balance`, not after.
    const m = runLedger(mkSchedule(USES, SALE), TERMS, equity(30_000_000));
    expect(m.redemption_balance_at_disposal_pence).toBe(37_359_224);
    expect(m.redemption_balance_at_disposal_pence).toBe(m.peak_debt_pence);
    expect(m.redemption_balance_at_disposal_pence).toBe(m.months[3].repayment_pence);
  });

  it('is null for cash funding (no senior facility to redeem)', () => {
    const terms: FacilityTerms = { ...TERMS, funding_source: 'cash' };
    const m = runLedger(mkSchedule(USES, SALE), terms, equity(65_000_000));
    expect(m.redemption_balance_at_disposal_pence).toBeNull();
  });

  it('is null when nothing is sold (no disposal month)', () => {
    const m = runLedger(mkSchedule(USES, NO_SALE), TERMS, equity(30_000_000));
    expect(m.redemption_balance_at_disposal_pence).toBeNull();
  });

  it('golden fixture F (12-month term): matches its pinned peak_debt_pence of 58,604,953p at ' +
    'month 11, and the pinned committed_gross_facility_pence (66,000,000, explicitly set — not ' +
    'derived from net + reserve) drives an exit fee of 660,000p, confirmed against the ledger\'s ' +
    'own totals.exit_fee_pence rather than assumed (Task 4 Step 1 verification)', () => {
    const fx = JSON.parse(readFileSync(
      resolve(__dirname, '../../../../fixtures/financial-model/f-dev-finance-12mo.json'), 'utf-8',
    )) as { inputs: CalculatorInputsV3 };
    const schedule = buildSchedule(fx.inputs);
    const m = runLedger(schedule, fx.inputs.finance, fx.inputs.equity_sources);
    expect(m.redemption_balance_at_disposal_pence).toBe(58_604_953);
    expect(m.redemption_balance_at_disposal_pence).toBe(m.peak_debt_pence);
    expect(m.months[11].exit_fee_pence).toBe(660_000);
    expect(m.totals.exit_fee_pence).toBe(660_000);
  });
});

describe('phased sweep mechanics (spec §4.4.1)', () => {
  // Facility comfortably covers the toy's month-0 construction draw with headroom to
  // spare, so behaviour below is driven purely by the sweep/redemption mechanics under
  // test, not by facility caps.
  const TERMS_ROLLED_UP_NO_CAPS: FacilityTerms = {
    ...TERMS,
    day_one_advance_pence: 15_000_000,
    committed_net_facility_pence: 20_000_000,
    committed_gross_facility_pence: 25_000_000,
  };

  // 4-month toy: uses only in month 0, receipts in months 2 and 3.
  const schedule = (r2: MonthReceipts, r3: MonthReceipts): Schedule => mkSchedule(
    [uses({ construction_pence: 10_000_000 }), uses({}), uses({}), uses({})],
    [receipts({}), receipts({}), r2, r3],
  );

  it('captures a declining redemption schedule, one entry per disposal month', () => {
    const m = runLedger(schedule(
      receipts({ gross_sale_pence: 6_000_000 }),
      receipts({ gross_sale_pence: 6_000_000 }),
    ), TERMS_ROLLED_UP_NO_CAPS, []);
    expect(m.redemption_schedule.map((e) => e.month)).toEqual([2, 3]);
    expect(m.redemption_schedule[0].balance_pence).toBeGreaterThan(m.redemption_schedule[1].balance_pence);
    expect(m.redemption_balance_at_disposal_pence).toBe(m.redemption_schedule[1].balance_pence);
  });

  it('charges the exit fee once, at first full redemption, and never again', () => {
    const m = runLedger(schedule(
      receipts({ gross_sale_pence: 50_000_000 }), // clears everything
      receipts({ gross_sale_pence: 1_000_000 }),
    ), TERMS_ROLLED_UP_NO_CAPS, []);
    expect(m.months[2].exit_fee_pence).toBeGreaterThan(0);
    expect(m.months[3].exit_fee_pence).toBe(0);
    expect(m.totals.exit_fee_pence).toBe(m.months[2].exit_fee_pence);
    expect(m.months[3].distribution_pence).toBe(1_000_000);   // post-redemption tranche distributes whole
  });

  it('flags a facility re-drawn after full redemption (amber, once)', () => {
    const s = schedule(receipts({ gross_sale_pence: 50_000_000 }), receipts({}));
    s.uses[3] = uses({ construction_pence: 2_000_000 });  // spend after redemption
    const m = runLedger(s, TERMS_ROLLED_UP_NO_CAPS, []);
    const f = m.flags.filter((x) => x.code === 'facility_redrawn_after_redemption');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('amber');
    expect(f[0].month).toBe(3);
  });

  describe('refinance event (spec §4.5)', () => {
    const withRefi = (
      net: number, month: number, receipts2: MonthReceipts = receipts({}),
    ): Schedule => ({
      ...mkSchedule(
        [uses({ construction_pence: 10_000_000 }), uses({}), uses({}), uses({})],
        [receipts({}), receipts({}), receipts2, receipts({})],
      ),
      refinance: { month, net_proceeds_pence: net },
    });

    it('surplus refinance redeems the facility and distributes the excess', () => {
      const m = runLedger(withRefi(50_000_000, 3), TERMS_ROLLED_UP_NO_CAPS, []);
      const last = m.months[3];
      expect(last.closing_balance_pence).toBe(0);
      expect(last.exit_fee_pence).toBeGreaterThan(0);                    // fee charged at refinance redemption
      expect(last.refinance_proceeds_pence).toBe(50_000_000);
      expect(last.distribution_pence)
        .toBe(50_000_000 - last.repayment_pence - last.exit_fee_pence);
      expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity')).toBe(false);
      expect(m.equity_cashflows_pence[3]).toBe(last.distribution_pence); // IRR terminal flow
    });

    it('shortfall is absorbed by additional equity and red-flagged', () => {
      const m = runLedger(withRefi(1_000_000, 3), TERMS_ROLLED_UP_NO_CAPS, []);
      const last = m.months[3];
      expect(last.closing_balance_pence).toBe(0);                        // still fully redeemed
      expect(last.additional_equity_pence)
        .toBe(last.repayment_pence + last.exit_fee_pence - 1_000_000);
      expect(last.distribution_pence).toBe(0);
      expect(m.flags.some((f) => f.code === 'additional_equity_required')).toBe(true);
    });

    it('same-month ordering: the sales sweep runs first, then the refinance', () => {
      const sale: MonthReceipts = receipts({ gross_sale_pence: 4_000_000 });
      const m = runLedger(withRefi(50_000_000, 2, sale), TERMS_ROLLED_UP_NO_CAPS, []);
      const mm = m.months[2];
      // sweep repaid 4,000,000 first (partial), refinance repaid the rest — total repayment
      // exceeds the sweep alone and the redemption_schedule entry is the PRE-receipts balance.
      expect(mm.repayment_pence).toBeGreaterThan(4_000_000);
      expect(m.redemption_schedule[0].balance_pence).toBeGreaterThan(mm.repayment_pence - 4_000_000);
      expect(mm.closing_balance_pence).toBe(0);
    });

    it('negative net proceeds are funded by additional equity; nothing distributes', () => {
      const m = runLedger(withRefi(-500_000, 3), TERMS_ROLLED_UP_NO_CAPS, []);
      const last = m.months[3];
      expect(last.refinance_proceeds_pence).toBe(0);
      expect(last.additional_equity_pence)
        .toBe(500_000 + last.repayment_pence + last.exit_fee_pence);
    });
  });
});

// ---------------------------------------------------------------------------
// R11 spec §17.6 — VAT in the ledger: funding, sweep and redemption.
// ---------------------------------------------------------------------------

interface VatDocOpts {
  /** `development_cost_advance_pct`. 100 makes the cap's *eligible base* the
   *  only thing that can stop the draw — which is what makes the guard below
   *  falsifiable. */
  advancePct?: number;
  /** Ruling R7: the advance-cap guard is built on ZERO committed equity. The
   *  engine funds equity first, so an equity-rich document simply pays the VAT
   *  out of equity and proves nothing about eligibility. */
  committedEquityPence?: number;
  salesSweepPct?: number;
  /** true: the month-3 reclaim (30,000,000) covers the balance AND the exit
   *  fee, so the reclaim redeems. false: a partial reclaim (10,000,000), and
   *  the month-4 sale redeems instead. Both documents redeem exactly once, on
   *  the same `committed_gross_facility` fee basis, so their total exit fees
   *  are comparable. */
  reclaimClearsBalance?: boolean;
  /** Puts the 60,000,000 sale in month 3 alongside the reclaim instead of in
   *  month 4, so the two compete for the same balance in the same month. */
  sameMonthSaleAndReclaim?: boolean;
  cash?: boolean;
}

/** A five-month VAT document, deliberately stripped of everything that is not
 *  under test: 0% interest, no arrangement fee, no ancillary fees, no day-one
 *  advance and nothing at all in month 0. What is left is
 *
 *    m1  25,000,000 construction + 5,000,000 VAT     (the funding question)
 *    m3  a VAT reclaim                               (the sweep question)
 *    m4  a 60,000,000 sale                           (the redemption question)
 *
 *  The eligible base for the development-cost advance is construction +
 *  professional + statutory = 25,000,000, so at 100% the cap stops the draw at
 *  the build and the 5,000,000 of VAT must come from equity or from a visible
 *  gap. The exit fee is 1% of the 100,000,000 committed gross facility =
 *  1,000,000, independent of which month redeems and of the balance then
 *  outstanding. */
function vatDocument(opts: VatDocOpts = {}) {
  const reclaimClears = opts.reclaimClearsBalance ?? false;
  const committedEquityPence = opts.committedEquityPence ?? 5_000_000;
  const terms: FacilityTerms = {
    ...DEFAULT_FACILITY_TERMS,
    funding_source: opts.cash === true ? 'cash' : 'development_finance',
    day_one_advance_pence: 0,
    development_cost_advance_pct: opts.advancePct ?? 100,
    committed_net_facility_pence: 100_000_000,
    committed_gross_facility_pence: 100_000_000,
    annual_interest_rate_pct: 0,
    interest_type: 'rolled_up',
    arrangement_fee_pct: 0,
    exit_fee_pct: 1, exit_fee_basis: 'committed_gross_facility',
    term_months: 5, equity_draw_rule: 'equity_first',
    sales_sweep_pct: opts.salesSweepPct ?? 100,
  };
  const schedule = mkSchedule(
    [
      uses({}),
      uses({ construction_pence: 25_000_000, vat_pence: 5_000_000 }),
      uses({}), uses({}), uses({}),
    ],
    [
      receipts({}), receipts({}), receipts({}),
      receipts({
        vat_reclaim_pence: reclaimClears ? 30_000_000 : 10_000_000,
        gross_sale_pence: opts.sameMonthSaleAndReclaim === true ? 60_000_000 : 0,
      }),
      receipts({ gross_sale_pence: opts.sameMonthSaleAndReclaim === true ? 0 : 60_000_000 }),
    ],
  );
  return {
    schedule, terms,
    equitySources: committedEquityPence > 0 ? equity(committedEquityPence) : [],
  };
}

function runVatLedger(opts: VatDocOpts = {}) {
  const d = vatDocument(opts);
  return runLedger(d.schedule, d.terms, d.equitySources);
}

describe('VAT funding: ineligible for the development-cost advance (spec §17.6)', () => {
  it('funds the build but never advances against the VAT', () => {
    // THE GUARD (spec §17.6). Advance pct 100, zero committed equity. `eligible`
    // is construction + professional + statutory = 25,000,000, so the cap stops
    // the draw at the build and the VAT falls through to a visible gap.
    //
    // Add u.vat_pence to `eligible` in monthly-engine.ts and the cap becomes
    // 30,000,000, the draw covers everything and the gap disappears — this
    // assertion MUST break. Watched failing; see the task report.
    const model = runVatLedger({ advancePct: 100, committedEquityPence: 0 });
    const m1 = model.months[1];
    expect(m1.uses_total_pence).toBe(30_000_000);   // 25,000,000 build + 5,000,000 VAT
    expect(m1.draw_pence).toBe(25_000_000);         // the build only
    expect(m1.funding_gap_pence).toBe(5_000_000);   // exactly the VAT
  });

  it('raises vat_funding_gap when neither equity nor headroom can fund the VAT', () => {
    const model = runVatLedger({ advancePct: 100, committedEquityPence: 0 });
    const flag = model.flags.find((f) => f.code === 'vat_funding_gap');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('red');
    expect(flag?.month).toBe(1);
    expect(flag?.amount_pence).toBe(5_000_000);
    // The generic gap flag still fires alongside it; the VAT one narrows it.
    expect(model.flags.some((f) => f.code === 'funding_gap')).toBe(true);
  });

  it('funds the VAT from equity where equity is available', () => {
    // The same document with equity committed: no gap, and the draw is still
    // capped at the build. This is the narrative case; the guard above is the
    // one that fails when eligibility is widened.
    const model = runVatLedger({ advancePct: 100, committedEquityPence: 5_000_000 });
    expect(model.months[1].funding_gap_pence).toBe(0);
    expect(model.months[1].draw_pence).toBe(25_000_000);
    expect(model.months[1].equity_contribution_pence).toBe(5_000_000);
    expect(model.totals.equity_contributed_pence).toBeGreaterThan(0);
    expect(model.flags.some((f) => f.code === 'vat_funding_gap')).toBe(false);
  });

  it('discloses the gross VAT cycle on the ledger totals', () => {
    const model = runVatLedger();
    expect(model.totals.vat_pence).toBe(5_000_000);
    expect(model.totals.vat_reclaim_pence).toBe(10_000_000);
  });
});

describe('VAT reclaims: sweep and redemption (spec §17.6)', () => {
  it('applies a reclaim wholly to senior debt, ignoring sales_sweep_pct', () => {
    const model = runVatLedger({ salesSweepPct: 50 });
    const reclaimMonth = model.months[3];
    expect(reclaimMonth.vat_reclaim_pence).toBe(10_000_000);
    expect(reclaimMonth.repayment_pence).toBe(10_000_000);   // not 5,000,000
    expect(reclaimMonth.gross_receipts_pence).toBe(0);       // never a sale receipt
    expect(reclaimMonth.closing_balance_pence).toBe(15_000_000);
  });

  it('charges the exit fee exactly once when a reclaim clears the balance', () => {
    // The trap (§17.6): the ledger charges the exit fee inside
    // `if (balance > 0 && !isCash)` at the sales sweep. A reclaim that zeroes the
    // balance without redeeming leaves the sale with nothing to do, and the fee
    // is never charged and never carried — lost, with every total reconciling.
    const clearedByReclaim = runVatLedger({ reclaimClearsBalance: true });
    const clearedBySale = runVatLedger({ reclaimClearsBalance: false });
    // Genuinely two different documents: the reclaim redeems in month 3 in one,
    // the sale redeems in month 4 in the other.
    expect(clearedByReclaim.months[3].closing_balance_pence).toBe(0);
    expect(clearedBySale.months[3].closing_balance_pence).toBe(15_000_000);
    expect(clearedByReclaim.months[3].exit_fee_pence).toBe(1_000_000);
    expect(clearedBySale.months[4].exit_fee_pence).toBe(1_000_000);

    expect(clearedByReclaim.totals.exit_fee_pence).toBeGreaterThan(0);
    expect(clearedByReclaim.totals.exit_fee_pence).toBe(clearedBySale.totals.exit_fee_pence);
    // Charged once, not twice: the month-4 sale finds the facility redeemed.
    expect(clearedByReclaim.months[4].exit_fee_pence).toBe(0);
    // Surplus over balance + fee distributes: 30,000,000 − 25,000,000 − 1,000,000.
    expect(clearedByReclaim.months[3].distribution_pence).toBe(4_000_000);
  });

  it('does not redeem on a partial reclaim', () => {
    const model = runVatLedger({ reclaimClearsBalance: false });
    const reclaimMonth = model.months[3];
    expect(reclaimMonth.exit_fee_pence).toBe(0);
    expect(reclaimMonth.distribution_pence).toBe(0);
    expect(model.flags.some((f) => f.code === 'facility_redrawn_after_redemption')).toBe(false);
  });

  it('withholds discharge when a reclaim lands in the [balance, balance + fee) band', () => {
    // Spec §17.6: a partial reclaim behaves "exactly like a partial sales
    // sweep", and the sweep's §4.4 clamp exists precisely so a repayment that
    // cannot also cover the fee never zeroes the balance. Balance 25,000,000,
    // fee 1,000,000: a 25,500,000 reclaim must leave 500,000 outstanding rather
    // than clear the facility with the fee uncharged.
    const d = vatDocument();
    d.schedule.receipts[3] = receipts({ vat_reclaim_pence: 25_500_000 });
    const model = runLedger(d.schedule, d.terms, d.equitySources);
    expect(model.months[3].exit_fee_pence).toBe(0);
    expect(model.months[3].repayment_pence).toBe(24_500_000);
    expect(model.months[3].closing_balance_pence).toBe(500_000);
    expect(model.months[3].distribution_pence).toBe(1_000_000);   // the withheld residue
    // The month-4 sale then redeems properly, and the fee is charged there.
    expect(model.months[4].exit_fee_pence).toBe(1_000_000);
    expect(model.totals.exit_fee_pence).toBe(1_000_000);
  });

  it('distributes the whole reclaim and repays nothing when the fee exceeds the balance', () => {
    // The clamp's degenerate case: balance <= vatReclaim < fee, so
    // `max(0, vatReclaim - fee)` is 0 -- nothing is repaid, the whole reclaim
    // distributes, and the debt stays outstanding. This mirrors the pre-existing
    // §4.4 sales-sweep clamp exactly and deliberately: a repayment that cannot
    // also cover the exit fee must not discharge the facility, and the ledger
    // would rather hand the cash to the developer than clear principal it cannot
    // properly redeem. Documented here because neither clamp has ever had a test
    // for this corner.
    //
    // Balance 500,000, exit fee 1,000,000 (1% of the committed gross facility,
    // which does not shrink with the balance), reclaim 600,000.
    const d = vatDocument({ committedEquityPence: 0 });
    const schedule = mkSchedule(
      [uses({}), uses({ construction_pence: 500_000 }), uses({}), uses({}), uses({})],
      [
        receipts({}), receipts({}), receipts({}),
        receipts({ vat_reclaim_pence: 600_000 }),
        receipts({ gross_sale_pence: 60_000_000 }),
      ],
    );
    const model = runLedger(schedule, d.terms, d.equitySources);
    expect(model.months[1].closing_balance_pence).toBe(500_000);
    expect(model.months[3].repayment_pence).toBe(0);
    expect(model.months[3].exit_fee_pence).toBe(0);
    expect(model.months[3].distribution_pence).toBe(600_000);   // the whole reclaim
    expect(model.months[3].closing_balance_pence).toBe(500_000);
    // The month-4 sale redeems properly and charges the fee once.
    expect(model.months[4].exit_fee_pence).toBe(1_000_000);
    expect(model.months[4].repayment_pence).toBe(500_000);
    expect(model.totals.exit_fee_pence).toBe(1_000_000);
    expect(model.senior_outstanding_at_maturity_pence).toBe(0);
  });

  it('applies the reclaim before the sale, reducing the balance the sale must clear', () => {
    // Ordering, not arithmetic: the same 10,000,000 arriving as a reclaim in
    // month 3 leaves the month-4 sale only 15,000,000 to redeem.
    const model = runVatLedger();
    expect(model.months[4].repayment_pence).toBe(15_000_000);
    expect(model.months[4].distribution_pence).toBe(60_000_000 - 15_000_000 - 1_000_000);
    expect(model.senior_outstanding_at_maturity_pence).toBe(0);
  });

  it('captures the redemption balance AFTER the reclaim when both land in one month', () => {
    // Ordering consequence worth pinning (spec §5.11 + §17.6): the reclaim is
    // applied first, so the balance the disposal actually has to redeem — and
    // therefore redemption_balance_at_disposal_pence and the §4.4.1 redemption
    // schedule — is the post-reclaim 15,000,000, not the pre-reclaim 25,000,000.
    // The field's own doc comment says "immediately before sale receipts are
    // applied", and a reclaim is not a sale receipt.
    const model = runVatLedger({ sameMonthSaleAndReclaim: true });
    expect(model.months[3].vat_reclaim_pence).toBe(10_000_000);
    expect(model.redemption_balance_at_disposal_pence).toBe(15_000_000);
    expect(model.redemption_schedule).toEqual([{ month: 3, balance_pence: 15_000_000 }]);
    // Reclaim 10,000,000 + sale repayment 15,000,000, one exit fee.
    expect(model.months[3].repayment_pence).toBe(25_000_000);
    expect(model.months[3].exit_fee_pence).toBe(1_000_000);
    expect(model.months[3].closing_balance_pence).toBe(0);
  });

  it('distributes a reclaim to equity on a cash deal', () => {
    const model = runVatLedger({ cash: true, committedEquityPence: 30_000_000 });
    expect(model.months[3].distribution_pence).toBe(10_000_000);
    expect(model.equity_cashflows_pence[3]).toBeGreaterThan(0);
    expect(model.equity_cashflows_pence[3]).toBe(10_000_000);
    expect(model.totals.finance_costs_pence).toBe(0);
  });

  it('keeps sources equal to uses to the penny with VAT live', () => {
    // All three funding shapes: equity-funded VAT, a VAT funding gap, and a
    // reclaim that redeems. The reclaim appears on neither side of the §7
    // identity, exactly as sale-proceeds repayments do.
    const shapes: VatDocOpts[] = [{}, { committedEquityPence: 0 }, { reclaimClearsBalance: true }];
    for (const opts of shapes) {
      const d = vatDocument(opts);
      const model = runLedger(d.schedule, d.terms, d.equitySources);
      const rec = reconcile(defaultCalculatorInputsV2(), d.schedule, model);
      expect(rec.sources_equal_uses).toBe(true);
      expect(rec.debt_rollforward_ok).toBe(true);
    }
  });
});
