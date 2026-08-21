import { describe, it, expect } from 'vitest';
import {
  VAT_CHARGE_CATEGORIES, DEFAULT_VAT, defaultVatTreatments,
  resolveVatTreatment, isPurchaseVatChargeable, vatReturnPeriods,
  spreadProRata, computeVat, chargeableConsiderationPence, vatBasisGate,
} from './vat';
import { runAppraisal } from './index';
import { validateInputs } from './validation';
import { computeCostPlan, defaultContingencyClasses } from './cost-plan';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { developedAreaSqm } from './areas';
import { defaultCalculatorInputsV7 } from '../conversion-defaults';
import type { CalculatorInputsV8 } from './finance-types';
import type { TogcTreatment } from './vat';

describe('VAT treatment resolution (spec §17.2)', () => {
  const vat = {
    ...DEFAULT_VAT,
    registered: true,
    treatments: defaultVatTreatments().map((t) =>
      t.category === 'construction'
        ? { ...t, rate_pct: 5, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' as const }
        : t),
  };

  it('falls back to the category row when the charge has no override', () => {
    const r = resolveVatTreatment(vat, { category: 'construction', override: null });
    expect(r.rate_pct).toBe(5);
    expect(r.recoverable_pct).toBe(100);
    expect(r.source).toBe('category');
  });

  it('prefers a line override over the category row', () => {
    const r = resolveVatTreatment(vat, {
      category: 'construction',
      override: { rate_pct: 20, recoverable_pct: 60, recovery_basis: 'partial_exemption' },
    });
    expect(r.rate_pct).toBe(20);
    expect(r.recoverable_pct).toBe(60);
    expect(r.recovery_basis).toBe('partial_exemption');
    expect(r.source).toBe('override');
  });

  it('carries the category row evidence status onto an overridden charge', () => {
    // An override states rate and recovery. It does not state evidence — the
    // adviser confirmation still belongs to the category. If this ever returns
    // 'confirmed' for an unconfirmed category, the §17.10 draft gate goes blind.
    const r = resolveVatTreatment(vat, {
      category: 'construction',
      override: { rate_pct: 20, recoverable_pct: 60, recovery_basis: 'partial_exemption' },
    });
    expect(r.evidence_status).toBe('unconfirmed');
  });

  it('yields a zero-rate resolution for every category when not registered', () => {
    const off = { ...vat, registered: false };
    for (const category of VAT_CHARGE_CATEGORIES) {
      expect(resolveVatTreatment(off, { category, override: null }).rate_pct).toBe(0);
    }
  });

  it('ignores an override when not registered', () => {
    const off = { ...vat, registered: false };
    const r = resolveVatTreatment(off, {
      category: 'construction', override: { rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' },
    });
    expect(r.rate_pct).toBe(0);
  });
});

describe('purchase VAT chargeability (spec §17.7)', () => {
  const p = (opted: boolean, togc: 'applies' | 'does_not_apply' | 'unconfirmed') =>
    ({ vendor_opted_to_tax: opted, togc_treatment: togc, evidence_status: 'unconfirmed' as const, notes: '' });

  it('charges where the vendor has opted and TOGC does not apply', () => {
    expect(isPurchaseVatChargeable(p(true, 'does_not_apply'))).toBe(true);
  });

  it('charges where the vendor has opted and TOGC is unconfirmed — the prudent case', () => {
    expect(isPurchaseVatChargeable(p(true, 'unconfirmed'))).toBe(true);
  });

  it('does not charge where TOGC applies, whatever the option to tax', () => {
    expect(isPurchaseVatChargeable(p(true, 'applies'))).toBe(false);
    expect(isPurchaseVatChargeable(p(false, 'applies'))).toBe(false);
  });

  it('does not charge where the vendor has not opted to tax', () => {
    expect(isPurchaseVatChargeable(p(false, 'does_not_apply'))).toBe(false);
    expect(isPurchaseVatChargeable(p(false, 'unconfirmed'))).toBe(false);
  });
});

describe('the treatments array is schema, not a list', () => {
  it('DEFAULT_VAT holds exactly the six categories, in declared order', () => {
    expect(DEFAULT_VAT.treatments.map((t) => t.category)).toEqual([...VAT_CHARGE_CATEGORIES]);
  });

  it('ships inert: not registered, every rate and recovery zero, every status unconfirmed', () => {
    expect(DEFAULT_VAT.registered).toBe(false);
    for (const t of DEFAULT_VAT.treatments) {
      expect(t.rate_pct).toBe(0);
      expect(t.recoverable_pct).toBe(0);
      expect(t.recovery_basis).toBe('unconfirmed');
      expect(t.evidence_status).toBe('unconfirmed');
    }
    expect(DEFAULT_VAT.purchase.vendor_opted_to_tax).toBe(false);
    expect(DEFAULT_VAT.purchase.togc_treatment).toBe('unconfirmed');
  });
});

describe('the return cycle (spec §17.4)', () => {
  const quarterly = { ...DEFAULT_VAT, registered: true, return_frequency: 'quarterly' as const,
    first_period_end_month: 2, repayment_lag_months: 1 };

  it('covers the term with contiguous periods starting at month 0', () => {
    const ps = vatReturnPeriods(quarterly, 12);
    expect(ps[0].first_month).toBe(0);
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i].first_month).toBe(ps[i - 1].last_month + 1);
    }
    expect(ps[ps.length - 1].last_month).toBeGreaterThanOrEqual(11);
  });

  it('ends the first period at first_period_end_month and quarters thereafter', () => {
    const ps = vatReturnPeriods(quarterly, 12);
    expect(ps[0]).toMatchObject({ index: 0, first_month: 0, last_month: 2, reclaim_month: 3 });
    expect(ps[1]).toMatchObject({ index: 1, first_month: 3, last_month: 5, reclaim_month: 6 });
    expect(ps[2]).toMatchObject({ index: 2, first_month: 6, last_month: 8, reclaim_month: 9 });
  });

  it('reports a reclaim falling beyond the final month as null, never clamped', () => {
    // Term 12 => final month index 11. The period ending month 11 reclaims in
    // month 12, which does not exist. Clamping it into month 11 would
    // manufacture a receipt the borrower has not had (§17.4).
    const ps = vatReturnPeriods(quarterly, 12);
    const last = ps[ps.length - 1];
    expect(last.last_month).toBe(11);
    expect(last.reclaim_month).toBeNull();
  });

  it('gives monthly registration one period per month', () => {
    const monthly = { ...quarterly, return_frequency: 'monthly' as const, first_period_end_month: 0 };
    const ps = vatReturnPeriods(monthly, 4);
    expect(ps.map((p) => [p.first_month, p.last_month, p.reclaim_month]))
      .toEqual([[0, 0, 1], [1, 1, 2], [2, 2, 3], [3, 3, null]]);
  });

  it('honours a longer repayment lag', () => {
    const ps = vatReturnPeriods({ ...quarterly, repayment_lag_months: 3 }, 12);
    expect(ps[0].reclaim_month).toBe(5);
    expect(ps[1].reclaim_month).toBe(8);
  });

  it('returns no periods when the document is not VAT registered', () => {
    expect(vatReturnPeriods({ ...quarterly, registered: false }, 12)).toEqual([]);
  });

  it('handles a first period end at or beyond the final month', () => {
    const ps = vatReturnPeriods({ ...quarterly, first_period_end_month: 20 }, 6);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ first_month: 0, last_month: 5, reclaim_month: null });
  });

  it('clamps a degenerate term to one month, matching buildSchedule', () => {
    // schedule.ts clamps `Math.max(1, Math.floor(inputs.finance.term_months))`
    // before any of this runs, and from Task 3 onward vatReturnPeriods receives
    // its term from that already-built schedule. If this returned no periods
    // for a term of 0 (or negative), a built month of uses would have no VAT
    // period covering it — so matching the clamp here is deliberate
    // consistency with an existing engine-wide convention, not an oversight.
    for (const term of [0, -1]) {
      const ps = vatReturnPeriods(quarterly, term);
      expect(ps).toHaveLength(1);
      expect(ps[0]).toMatchObject({ first_month: 0, last_month: 0 });
    }
  });

  it('clamps a negative first_period_end_month to 0', () => {
    const ps = vatReturnPeriods({ ...quarterly, first_period_end_month: -5 }, 6);
    expect(ps[0]).toMatchObject({ first_month: 0, last_month: 0, reclaim_month: 1 });
  });
});

// ---------------------------------------------------------------------------
// Task 3 — computeVat (spec §17.5)
// ---------------------------------------------------------------------------

interface WorkedVatOpts {
  termMonths?: number;
  recoverablePct?: number;
  registered?: boolean;
  allCategoriesAt20?: boolean;
  /** §17.7: the acquisition category needs a rate before purchase VAT is
   *  anything but zero. Separate from `allCategoriesAt20` so the purchase tests
   *  keep month 0 free of every other category's VAT. */
  acquisitionAt20?: boolean;
  vendorOptedToTax?: boolean;
  togcTreatment?: TogcTreatment;
  purchasePricePence?: number;
  /** Ruling R13: the ledger charges no ancillary fee on a cash deal, so no VAT
   *  may be charged on one either. */
  cashDeal?: boolean;
  /** Ruling R20: the ledger's facility gate has a second limb — a development
   *  finance deal with no committed net facility also pays no ancillary fee.
   *  `undefined` keeps the default 500,000,000. */
  committedNetFacilityPence?: number | null;
}

/** The §17.4 worked cycle, built as a REAL document and run through the REAL
 *  `computeCostPlan` and `buildSchedule` — never a stub, because the point of
 *  these tests is that VAT reads the cost plan and the spend profile the rest
 *  of the engine produces.
 *
 *  Construction is the only thing in the document that bears VAT by default:
 *  £1,000/sqm × 1,000 sqm = £1,000,000 base build, contingency 0%, compliance
 *  0, NO fee lines, no units (so no sale and no selling costs), and an
 *  acquisition that is not opted to tax (so no purchase VAT). Every figure the
 *  tests below assert is therefore traceable to one input, and the first test
 *  asserts the constructed schedule and cost plan BEFORE it asserts anything
 *  about VAT.
 *
 *  The explicit programme is load-bearing: the AUTO window spreads construction
 *  across months 1..term-2 — five months for a term of seven — not the four the
 *  worked cycle specifies.
 *
 *  The four ancillary fee fields and the committed net facility are set so that
 *  ruling R13's `lender_ancillary` base is a real, asserted figure rather than a
 *  structural zero. They change nothing else: `buildSchedule` reads none of
 *  them, and the `lender_ancillary` rate is 0 unless `allCategoriesAt20`. */
function buildWorkedVatCase(opts: WorkedVatOpts = {}) {
  const termMonths = opts.termMonths ?? 7;
  const recoverablePct = opts.recoverablePct ?? 100;
  const registered = opts.registered ?? true;
  const allCategories = opts.allCategoriesAt20 ?? false;
  const acquisitionAt20 = opts.acquisitionAt20 ?? false;
  const v7 = defaultCalculatorInputsV7();
  const rated = (c: (typeof VAT_CHARGE_CATEGORIES)[number]) =>
    allCategories || c === 'construction' || (acquisitionAt20 && c === 'acquisition');
  const inputs: CalculatorInputsV8 = {
    ...v7,
    inputs_version: 8,
    acquisition: {
      ...v7.acquisition,
      purchase_price_pence: opts.purchasePricePence ?? 0,
    },
    conversion_costs: {
      ...v7.conversion_costs,
      construction_cost_per_sqm_pence: 100_000,
      total_construction_sqm: 1_000,
      contingency_pct: 0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    },
    cost_plan: {
      mode: 'headline',
      packages: [],
      contingency: defaultContingencyClasses(0),
      fee_lines: [],
    },
    finance: {
      ...v7.finance,
      funding_source: opts.cashDeal === true ? 'cash' : v7.finance.funding_source,
      committed_net_facility_pence:
        opts.committedNetFacilityPence === undefined ? 500_000_000 : opts.committedNetFacilityPence,
      broker_fee_pence: 250_000,
      lender_legal_fee_pence: 150_000,
      valuation_fee_pence: 100_000,
      monitoring_surveyor_fee_pence: 50_000,
      term_months: termMonths,
    },
    programme: {
      anchor_month: null,
      packages: {
        construction: { start_offset: 1, duration_months: 4, curve: { kind: 'straight_line' } },
        professional: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
      },
    },
    vat: {
      ...DEFAULT_VAT,
      registered,
      treatments: defaultVatTreatments().map((t) =>
        rated(t.category)
          ? {
            ...t,
            rate_pct: 20,
            recoverable_pct: allCategories ? 100 : recoverablePct,
            recovery_basis: 'zero_rated_sale' as const,
          }
          : t),
      purchase: {
        ...DEFAULT_VAT.purchase,
        vendor_opted_to_tax: opts.vendorOptedToTax ?? false,
        togc_treatment: opts.togcTreatment ?? 'unconfirmed',
      },
    },
  };
  const costPlan = computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length);
  const schedule = buildSchedule(inputs);
  return { inputs, costPlan, schedule };
}

/** Two packages, one of them carrying a `vat_override`, and a CONFIRMED
 *  construction category row so the override line's evidence status is a
 *  falsifiable assertion rather than a coincidence.
 *
 *  detailed: base build 60,000,000 + 40,000,000; general contingency 10% →
 *  10,000,000; construction total 110,000,000.
 *  headline: packages are returned by `computeCostPlan` but NOT folded into
 *  `base_build_pence`, which is £100/sqm × 1,000 sqm = 10,000,000; contingency
 *  10% → 1,000,000; construction total 11,000,000 — LESS than the overridden
 *  package, which is what makes the mode gate load-bearing. */
function buildDetailedVatCase(opts: { mode?: 'detailed' | 'headline' } = {}) {
  const mode = opts.mode ?? 'detailed';
  const v7 = defaultCalculatorInputsV7();
  const inputs: CalculatorInputsV8 = {
    ...v7,
    inputs_version: 8,
    conversion_costs: {
      ...v7.conversion_costs,
      construction_cost_per_sqm_pence: 10_000,
      total_construction_sqm: 1_000,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    },
    cost_plan: {
      mode,
      packages: [
        {
          id: 'p1', code: 'structure', label: 'Structure', amount_pence: 60_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null,
        },
        {
          id: 'p2', code: 'envelope', label: 'Envelope', amount_pence: 40_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '',
          vat_override: { rate_pct: 5, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' },
        },
      ],
      contingency: defaultContingencyClasses(10),
      fee_lines: [],
    },
    finance: { ...v7.finance, term_months: 7 },
    programme: null,
    vat: {
      ...DEFAULT_VAT,
      registered: true,
      treatments: defaultVatTreatments().map((t) =>
        t.category === 'construction'
          ? {
            ...t,
            rate_pct: 20,
            recoverable_pct: 100,
            recovery_basis: 'zero_rated_sale' as const,
            evidence_status: 'confirmed' as const,
          }
          : t),
    },
  };
  const costPlan = computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length);
  const schedule = buildSchedule(inputs);
  return { inputs, costPlan, schedule };
}

describe('spreadProRata (spec §17.5)', () => {
  it('sums exactly to the total and gives the residue to the last non-zero weight', () => {
    const out = spreadProRata(1_000, [1, 1, 1, 0]);
    expect(out.reduce((s, v) => s + v, 0)).toBe(1_000);
    expect(out[3]).toBe(0);
    expect(out[2]).toBe(1_000 - out[0] - out[1]);
  });

  it('returns all zeros when the weights sum to zero, choosing no month itself', () => {
    // This function has no month to prefer. `computeVat` owns the fallback
    // (ruling R15) and is tested on it separately.
    expect(spreadProRata(500, [0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('computeVat (spec §17.5)', () => {
  it('the worked cycle of §17.4 lands its reclaims on the cycle, not per month', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase();
    expect(schedule.uses.map((u) => u.construction_pence))
      .toEqual([0, 25_000_000, 25_000_000, 25_000_000, 25_000_000, 0, 0]);
    expect(costPlan.construction_total_pence).toBe(100_000_000);

    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.months.map((m) => m.incurred_pence))
      .toEqual([0, 5_000_000, 5_000_000, 5_000_000, 5_000_000, 0, 0]);
    // Term 7 gives two periods: months 0-2 (reclaim m3) and months 3-5 (reclaim
    // m6). Each carries 10,000,000p — the reclaims must sum to
    // total_input_vat_pence below (ruling R6).
    expect(vat.months.map((m) => m.reclaimed_pence))
      .toEqual([0, 0, 0, 10_000_000, 0, 0, 10_000_000]);
    expect(vat.months.map((m) => m.carry_pence))
      .toEqual([0, 5_000_000, 10_000_000, 5_000_000, 10_000_000, 10_000_000, 0]);
    expect(vat.peak_carry_pence).toBe(10_000_000);
    expect(vat.peak_carry_month).toBe(2);
    expect(vat.total_input_vat_pence).toBe(20_000_000);
    expect(vat.total_reclaimed_pence).toBe(20_000_000);
    expect(vat.total_irrecoverable_pence).toBe(0);
    expect(vat.receivable_at_maturity_pence).toBe(0);
    // Ruling R15's invariant: every charged penny is placed in some month, so
    // the ledger funds exactly what the charge lines disclose.
    expect(vat.months.reduce((s, m) => s + m.incurred_pence, 0))
      .toBe(vat.total_input_vat_pence);
  });

  it('places a charge whose base has no spend months in month 0 (ruling R15)', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase();
    // R2's `Pick` is what makes this expressible: a spend profile with no
    // construction months at all, against a cost plan that still says
    // 100,000,000p of construction. Without the month-0 fallback the
    // 20,000,000p of VAT is charged, disclosed and (via its irrecoverable part)
    // added to cost-before-finance while the ledger funds none of it.
    const noSpend = {
      term_months: schedule.term_months,
      uses: schedule.uses.map((u) => ({ ...u, construction_pence: 0 })),
      receipts: schedule.receipts,
    };
    const vat = computeVat(inputs, costPlan, noSpend);
    expect(vat.total_input_vat_pence).toBe(20_000_000);
    expect(vat.months[0].incurred_pence).toBe(20_000_000);
    expect(vat.months.reduce((s, m) => s + m.incurred_pence, 0))
      .toBe(vat.total_input_vat_pence);
  });

  it('reports a reclaim falling past the term as receivable, not as cash', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ termMonths: 5 });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.total_reclaimed_pence).toBeLessThan(vat.total_input_vat_pence);
    expect(vat.receivable_at_maturity_pence)
      .toBe(vat.total_input_vat_pence - vat.total_reclaimed_pence);
  });

  it('splits a partly recoverable charge into recoverable and irrecoverable', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ recoverablePct: 33 });
    const vat = computeVat(inputs, costPlan, schedule);
    // 20,000,000p charged; 33% recoverable = 6,600,000p exactly; irrecoverable
    // is the remainder. Literals, not an identity that holds by construction.
    expect(vat.total_input_vat_pence).toBe(20_000_000);
    expect(vat.total_recoverable_pence).toBe(6_600_000);
    expect(vat.total_irrecoverable_pence).toBe(13_400_000);
    // Only the recoverable part is reclaimed.
    expect(vat.total_reclaimed_pence).toBe(6_600_000);
  });

  it('gives the rounding residue to irrecoverable rather than losing it', () => {
    // 33.3333325% of 20,000,000p is 6,666,666.5p, which rounds half-up to
    // 6,666,667p. Computing irrecoverable as charged − recoverable gives
    // 13,333,333p and keeps the sum exact. Computing it INDEPENDENTLY as
    // money_round(20,000,000 × 66.6666675/100) gives 13,333,334p and invents a
    // penny — this literal is what distinguishes the two.
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ recoverablePct: 33.3333325 });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.total_input_vat_pence).toBe(20_000_000);
    expect(vat.total_recoverable_pence).toBe(6_666_667);
    expect(vat.total_irrecoverable_pence).toBe(13_333_333);
    expect(vat.total_recoverable_pence + vat.total_irrecoverable_pence)
      .toBe(vat.total_input_vat_pence);
  });

  it('charges VAT on the four lender ancillary fees and on nothing else in the finance stack', () => {
    // §17.3 / ruling R13. The base is the four ancillary fee fields summed.
    // Interest, and the arrangement and exit fees, are exempt financial
    // services: the arrangement fee alone is 2% of the 500,000,000p net
    // facility — 10,000,000p — so an implementation that swept it in would miss
    // this figure by a factor of nineteen.
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ allCategoriesAt20: true });
    const vat = computeVat(inputs, costPlan, schedule);
    const finance = vat.charges.filter((c) => c.category === 'lender_ancillary');
    expect(finance).toHaveLength(1);
    expect(finance[0].net_base_pence).toBe(
      inputs.finance.broker_fee_pence + inputs.finance.lender_legal_fee_pence
      + inputs.finance.valuation_fee_pence + inputs.finance.monitoring_surveyor_fee_pence,
    );
    expect(finance[0].net_base_pence).toBe(550_000);
    expect(finance[0].vat_pence).toBe(110_000);
    // Where the ledger puts the fees: month 0.
    expect(vat.months[0].incurred_pence).toBe(110_000);
  });

  it('charges no lender ancillary VAT on a cash deal, exactly as the ledger charges no fee', () => {
    const { inputs, costPlan, schedule } =
      buildWorkedVatCase({ allCategoriesAt20: true, cashDeal: true });
    const vat = computeVat(inputs, costPlan, schedule);
    const finance = vat.charges.filter((c) => c.category === 'lender_ancillary');
    expect(finance).toHaveLength(1);
    expect(finance[0].net_base_pence).toBe(0);
    expect(finance[0].vat_pence).toBe(0);
    expect(vat.months[0].incurred_pence).toBe(0);
  });

  it('derives the facility gate ONCE: the VAT base and the ledger fee move together (R20)', () => {
    // Ruling R20. `hasFacility` is now exported by monthly-engine.ts and called
    // by BOTH the ledger and computeVat, so this asserts the COUPLING rather
    // than either behaviour: whatever the gate decides, the `lender_ancillary`
    // VAT base and the fees the ledger actually charges must be the same
    // number, in the same document. If the gate later gains a condition, this
    // fails rather than VAT quietly charging on a fee no one pays.
    const cases: Array<{ label: string; opts: WorkedVatOpts; expected: number }> = [
      { label: 'facility', opts: {}, expected: 550_000 },
      { label: 'cash deal', opts: { cashDeal: true }, expected: 0 },
      { label: 'no committed facility', opts: { committedNetFacilityPence: null }, expected: 0 },
    ];
    for (const { label, opts, expected } of cases) {
      const { inputs, costPlan, schedule } =
        buildWorkedVatCase({ allCategoriesAt20: true, ...opts });
      const charge = computeVat(inputs, costPlan, schedule).charges
        .find((c) => c.category === 'lender_ancillary');
      const ledger = runLedger(schedule, inputs.finance, inputs.equity_sources);
      expect({
        label,
        vatBase: charge?.net_base_pence,
        ledgerFees: ledger.totals.ancillary_fees_pence,
      }).toEqual({ label, vatBase: expected, ledgerFees: expected });
    }
  });

  it('charges purchase VAT in month 0 where the vendor has opted to tax (§17.7)', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({
      acquisitionAt20: true,
      vendorOptedToTax: true,
      togcTreatment: 'does_not_apply',
      purchasePricePence: 50_000_000,
    });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.purchase_vat_pence).toBe(10_000_000);
    // Month 0 carries the purchase VAT and nothing else: construction runs
    // months 1-4 and every other category is at 0%.
    expect(vat.months[0].incurred_pence).toBe(10_000_000);
    expect(vat.total_input_vat_pence).toBe(30_000_000);
  });

  it('charges no purchase VAT where TOGC applies, whatever the option to tax', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({
      acquisitionAt20: true,
      vendorOptedToTax: true,
      togcTreatment: 'applies',
      purchasePricePence: 50_000_000,
    });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.purchase_vat_pence).toBe(0);
    expect(vat.months[0].incurred_pence).toBe(0);
    expect(vat.total_input_vat_pence).toBe(20_000_000);
  });

  it('is entirely inert when the document is not VAT registered', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ registered: false });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.charges).toEqual([]);
    expect(vat.total_input_vat_pence).toBe(0);
    expect(vat.months.every((m) => m.incurred_pence === 0 && m.reclaimed_pence === 0)).toBe(true);
  });

  it('does not double count an overridden package against its category base', () => {
    const { inputs, costPlan, schedule } = buildDetailedVatCase();
    // Assert the constructed document FIRST: both sides of the sum below come
    // from the code under test, so without this a helper that silently dropped
    // its packages would still pass.
    expect(costPlan.mode).toBe('detailed');
    expect(costPlan.packages).toHaveLength(2);
    expect(costPlan.base_build_pence).toBe(100_000_000);
    expect(costPlan.construction_total_pence).toBe(110_000_000);

    const vat = computeVat(inputs, costPlan, schedule);
    const constructionBase = vat.charges
      .filter((c) => c.category === 'construction')
      .reduce((s, c) => s + c.net_base_pence, 0);
    expect(constructionBase).toBe(costPlan.construction_total_pence);
    // The category line carries the total NET of the overridden package.
    const categoryLine = vat.charges.find((c) => c.id === 'category:construction');
    expect(categoryLine?.net_base_pence).toBe(70_000_000);
  });

  it('charges an overridden package at the override rate, keeping the category evidence', () => {
    // §17.2's central mechanism. Without this, an implementation that ignored
    // vat_override entirely passes every other test in this file.
    const { inputs, costPlan, schedule } = buildDetailedVatCase();
    const vat = computeVat(inputs, costPlan, schedule);
    const overridden = vat.charges.find((c) => c.id === 'package:p2');
    expect(overridden).toBeDefined();
    expect(overridden?.source).toBe('override');
    expect(overridden?.rate_pct).toBe(5);
    expect(overridden?.net_base_pence).toBe(40_000_000);
    // 5% of 40,000,000p, NOT the category's 20% (which would be 8,000,000p).
    expect(overridden?.vat_pence).toBe(2_000_000);
    // Evidence stays a CATEGORY fact — the override type carries no evidence
    // field at all, so an override that could claim its own would blind the
    // §17.10 draft gate. The category row here is deliberately 'confirmed'.
    expect(overridden?.evidence_status).toBe('confirmed');
  });

  it('ignores packages in headline mode, where the cost plan never counted them', () => {
    // `computeCostPlan` returns `packages` populated in either mode but folds
    // their amounts into construction_total_pence only in detailed mode
    // (cost-plan.ts:262). Subtracting unconditionally would make the category
    // base 11,000,000 − 40,000,000 = −29,000,000: negative VAT, negative months,
    // and a negative irrecoverable figure landing in cost-before-finance.
    const { inputs, costPlan, schedule } = buildDetailedVatCase({ mode: 'headline' });
    expect(costPlan.mode).toBe('headline');
    expect(costPlan.packages).toHaveLength(2);
    expect(costPlan.base_build_pence).toBe(10_000_000);
    expect(costPlan.construction_total_pence).toBe(11_000_000);

    const vat = computeVat(inputs, costPlan, schedule);
    const construction = vat.charges.filter((c) => c.category === 'construction');
    expect(construction.reduce((s, c) => s + c.net_base_pence, 0))
      .toBe(costPlan.construction_total_pence);
    expect(vat.charges.some((c) => c.id === 'package:p2')).toBe(false);
    expect(vat.charges.every((c) => c.net_base_pence >= 0)).toBe(true);
    expect(vat.charges.every((c) => c.vat_pence >= 0)).toBe(true);
    expect(vat.months.every((m) => m.incurred_pence >= 0)).toBe(true);
  });
});

/** Task 7 (spec §17.7). The brief's `vatDocument`: `buildWorkedVatCase`'s
 *  document, addressed by the four facts §17.7 turns on — whether the vendor
 *  has opted, the TOGC position, the price, and the acquisition category's
 *  rate. Nothing here is stubbed: the same real `computeCostPlan` /
 *  `buildSchedule` document the worked cycle above uses. */
function vatDocument(opts: {
  vendorOptedToTax?: boolean;
  togc?: TogcTreatment;
  purchasePricePence?: number;
  acquisitionRatePct?: number;
} = {}): CalculatorInputsV8 {
  return buildWorkedVatCase({
    vendorOptedToTax: opts.vendorOptedToTax,
    togcTreatment: opts.togc,
    purchasePricePence: opts.purchasePricePence,
    // `buildWorkedVatCase` rates the acquisition category at 20% or not at all,
    // which is the only rate §17.7's worked figures need. Asserted rather than
    // silently coerced: a future 5% case must add the option, not read as 20.
    acquisitionAt20: opts.acquisitionRatePct === 20,
  }).inputs;
}

describe('chargeable consideration (spec §17.7)', () => {
  it('equals the price where no purchase VAT is chargeable', () => {
    const inputs = vatDocument({ vendorOptedToTax: false });
    expect(Number(chargeableConsiderationPence(inputs)))
      .toBe(inputs.acquisition.purchase_price_pence);
  });

  it('includes purchase VAT where the vendor has opted and TOGC does not apply', () => {
    const inputs = vatDocument({
      vendorOptedToTax: true, togc: 'does_not_apply',
      purchasePricePence: 50_000_000, acquisitionRatePct: 20,
    });
    expect(Number(chargeableConsiderationPence(inputs))).toBe(60_000_000);
  });

  it('excludes purchase VAT where TOGC applies', () => {
    const inputs = vatDocument({
      vendorOptedToTax: true, togc: 'applies',
      purchasePricePence: 50_000_000, acquisitionRatePct: 20,
    });
    expect(Number(chargeableConsiderationPence(inputs))).toBe(50_000_000);
  });

  it('charges more acquisition tax on the VAT-inclusive consideration', () => {
    // The permanent cost the app reports as zero today. Both figures are read
    // off the RESULT, independently computed by the tax engine -- not
    // recomputed here, which would make the test agree with a bug forever.
    const withVat = runAppraisal(vatDocument({
      vendorOptedToTax: true, togc: 'does_not_apply',
      purchasePricePence: 50_000_000, acquisitionRatePct: 20,
    }));
    const without = runAppraisal(vatDocument({ vendorOptedToTax: false, purchasePricePence: 50_000_000 }));
    expect(withVat.metrics.acquisition_tax_pence)
      .toBeGreaterThan(without.metrics.acquisition_tax_pence);
    expect(withVat.metrics.chargeable_consideration_pence).toBe(60_000_000);
    expect(without.metrics.chargeable_consideration_pence).toBe(50_000_000);
  });

  it('moves the acquisition COST and the day-one debt with it, not only the reported tax', () => {
    // The tax is charged at two independent sites (metrics.ts and
    // conversion-calc-engine.ts's calculateTotalAcquisitionCost). Asserting only
    // `acquisition_tax_pence` would leave the second site free to keep charging
    // the exclusive price -- R8's exact defect shape, and the reason spec §17.7
    // names all six call sites rather than the reported one.
    const withVat = runAppraisal(vatDocument({
      vendorOptedToTax: true, togc: 'does_not_apply',
      purchasePricePence: 50_000_000, acquisitionRatePct: 20,
    }));
    const without = runAppraisal(vatDocument({ vendorOptedToTax: false, purchasePricePence: 50_000_000 }));
    const taxDelta = withVat.metrics.acquisition_tax_pence - without.metrics.acquisition_tax_pence;
    expect(taxDelta).toBeGreaterThan(0);
    expect(withVat.metrics.acquisition_cost_pence - without.metrics.acquisition_cost_pence)
      .toBe(taxDelta);
  });
});

describe('the object-side laundering hole is closed by the type (ruling R28)', () => {
  it('rejects a bare { acquisition } at COMPILE time, not at review', () => {
    // The whole assertion is the `@ts-expect-error` below: it fails `tsc -b` if
    // the line ever STOPS being an error, which is exactly what an optional
    // `vat?:` member would do. A caller holding a real v8 document could then
    // write this and receive a branded EXCLUSIVE price -- laundering through an
    // intermediate OBJECT, invisible to the brand and to the Python scan alike,
    // and reading like correct accessor use.
    //
    // Runtime is not the point here; the line is never evaluated.
    const rejected = () =>
      // @ts-expect-error ruling R28: `vat` is required-but-nullable. Writing
      // `vat: undefined` is a declaration that no VAT block exists; omitting it
      // is an absence that could equally be an oversight.
      chargeableConsiderationPence({ acquisition: { purchase_price_pence: 1 } });
    expect(typeof rejected).toBe('function');
  });

  it('accepts the same document when it declares vat: undefined', () => {
    expect(Number(chargeableConsiderationPence({
      acquisition: { purchase_price_pence: 50_000_000 }, vat: undefined,
    }))).toBe(50_000_000);
  });
});

describe('the unregistered buyer (spec §17.7, ruling R27)', () => {
  /** The colliding state: the vendor has opted, TOGC does not apply, and the
   *  engine is switched off. Chargeability says VAT is due; the inert resolver
   *  says the rate is 0. */
  const colliding = () => vatDocument({
    vendorOptedToTax: true, togc: 'does_not_apply',
    purchasePricePence: 50_000_000, acquisitionRatePct: 20,
  });

  it('is a hard validation ERROR, not a silent approximation', () => {
    const inputs = { ...colliding(), vat: { ...colliding().vat, registered: false } };
    const issues = validateInputs(inputs).filter(
      (i) => i.severity === 'error' && i.field === 'vat.registered',
    );
    expect(issues).toHaveLength(1);
  });

  it("names the correct modelling: registered, the rate, recoverable_pct 0, basis 'blocked'", () => {
    // A hard error that does not say what to do instead gets softened to a
    // warning by the next person who hits it. The message has to carry the fix.
    const inputs = { ...colliding(), vat: { ...colliding().vat, registered: false } };
    const issue = validateInputs(inputs).find((i) => i.field === 'vat.registered')!;
    expect(issue.message).toMatch(/registered/);
    expect(issue.message).toMatch(/recoverable_pct/);
    expect(issue.message).toMatch(/blocked/);
    expect(issue.message).toMatch(/acquisition/);
  });

  it('does not fire where the vendor has not opted to tax', () => {
    // registered: false is the migration default and the inert switch. It is a
    // statement about the ENGINE, never about the buyer, so on its own it must
    // never be an error -- otherwise every migrated document fails validation.
    const inputs = vatDocument({ vendorOptedToTax: false, purchasePricePence: 50_000_000 });
    const off = { ...inputs, vat: { ...inputs.vat, registered: false } };
    // Filtered to the ERROR severity, not the field alone: R11 Task 9 adds a
    // WARNING on this same field ("registered: false with non-zero
    // construction cost", spec §17.9) that legitimately fires here too --
    // buildWorkedVatCase's default document prices a non-zero construction
    // base build. That warning does not contradict this test's claim, which is
    // specifically that the state is never a hard ERROR on its own.
    expect(validateInputs(off).filter((i) => i.severity === 'error' && i.field === 'vat.registered')).toEqual([]);
  });

  it('does not fire where TOGC applies, whatever the option to tax', () => {
    const inputs = vatDocument({
      vendorOptedToTax: true, togc: 'applies', purchasePricePence: 50_000_000,
    });
    const off = { ...inputs, vat: { ...inputs.vat, registered: false } };
    expect(validateInputs(off).filter((i) => i.severity === 'error' && i.field === 'vat.registered')).toEqual([]);
  });

  it('fires on an UNCONFIRMED TOGC too — the prudent case is still chargeable', () => {
    const inputs = vatDocument({
      vendorOptedToTax: true, togc: 'unconfirmed', purchasePricePence: 50_000_000,
    });
    const off = { ...inputs, vat: { ...inputs.vat, registered: false } };
    expect(off.vat.purchase.togc_treatment).toBe('unconfirmed');
    expect(validateInputs(off).filter(
      (i) => i.severity === 'error' && i.field === 'vat.registered',
    )).toHaveLength(1);
  });

  it('models the real position EXACTLY, with nothing new in the schema', () => {
    // §17.7's answer to the rejected alternative: registered, the applicable
    // acquisition rate, recoverable_pct 0, recovery_basis 'blocked'. VAT
    // charged, none recovered, the consideration VAT-inclusive, acquisition tax
    // on that inclusive base, and the whole amount irrecoverable.
    const base = vatDocument({
      vendorOptedToTax: true, togc: 'does_not_apply',
      purchasePricePence: 50_000_000, acquisitionRatePct: 20,
    });
    const blocked: CalculatorInputsV8 = {
      ...base,
      vat: {
        ...base.vat,
        registered: true,
        treatments: base.vat.treatments.map((t) => (t.category === 'acquisition'
          ? { ...t, rate_pct: 20, recoverable_pct: 0, recovery_basis: 'blocked' as const }
          : t)),
      },
    };
    expect(validateInputs(blocked).filter((i) => i.field === 'vat.registered')).toEqual([]);

    const run = runAppraisal(blocked);
    // VAT charged, and none of it comes back.
    const acquisitionVat = run.schedule.vat.charges.find((c) => c.id === 'category:acquisition')!;
    expect(acquisitionVat.vat_pence).toBe(10_000_000);
    expect(acquisitionVat.recoverable_pence).toBe(0);
    expect(acquisitionVat.irrecoverable_pence).toBe(10_000_000);
    expect(run.schedule.vat.purchase_vat_pence).toBe(10_000_000);
    // The consideration is VAT-inclusive, and the tax is charged on it.
    expect(run.metrics.chargeable_consideration_pence).toBe(60_000_000);
    // Strictly more tax than the same document without purchase VAT.
    const without = runAppraisal(vatDocument({
      vendorOptedToTax: false, purchasePricePence: 50_000_000,
    }));
    expect(run.metrics.acquisition_tax_pence)
      .toBeGreaterThan(without.metrics.acquisition_tax_pence);
    // The whole amount lands in the irrecoverable total.
    expect(run.schedule.vat.total_irrecoverable_pence)
      .toBeGreaterThanOrEqual(10_000_000);
  });
});

// ---------------------------------------------------------------------------
// Task 12 — vatBasisGate (spec §17.10, ruling R5)
//
// The draft gate itself (draftReason) stays pure and lives in
// report-provenance.ts; this is the ONE place that turns a VatResult into the
// gate's boolean. "Material" means the category actually bears VAT: a
// treatment row marked unconfirmed that charges nothing gates nothing, and an
// unregistered document — no charge lines at all — can never gate.
// ---------------------------------------------------------------------------
describe('vatBasisGate (spec §17.10, ruling R5)', () => {
  it('gates on an unconfirmed row that actually bears VAT', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ acquisitionAt20: false });
    // buildWorkedVatCase's default construction row is 'unconfirmed' — see
    // defaultVatTreatments — and construction is rated (100,000,000p base),
    // so its charge line is non-zero.
    const vat = computeVat(inputs, costPlan, schedule);
    const constructionLine = vat.charges.find((c) => c.id === 'category:construction')!;
    expect(constructionLine.evidence_status).toBe('unconfirmed');
    expect(constructionLine.vat_pence).toBeGreaterThan(0);
    expect(vatBasisGate(vat).vatBasisConfirmed).toBe(false);
  });

  it('does not gate on an unconfirmed row that charges nothing', () => {
    // Registered, but every category rated 0% (buildWorkedVatCase's default
    // for every category except construction, which is rated but confirmed
    // here) — every OTHER category is 'unconfirmed' by defaultVatTreatments
    // and charges zero, so none of them may gate.
    const { inputs, costPlan, schedule } = buildWorkedVatCase();
    const confirmed = {
      ...inputs,
      vat: {
        ...inputs.vat,
        treatments: inputs.vat.treatments.map((t) => (t.category === 'construction'
          ? { ...t, evidence_status: 'confirmed' as const }
          : t)),
      },
    };
    const vat = computeVat(confirmed, costPlan, schedule);
    const unconfirmedZeroCharge = vat.charges.filter(
      (c) => c.category !== 'construction' && c.evidence_status === 'unconfirmed',
    );
    expect(unconfirmedZeroCharge.length).toBeGreaterThan(0);
    expect(unconfirmedZeroCharge.every((c) => c.vat_pence === 0)).toBe(true);
    expect(vatBasisGate(vat).vatBasisConfirmed).toBe(true);
  });

  it('never gates an unregistered document — there are no charge lines to be unconfirmed', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ registered: false });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.charges).toEqual([]);
    expect(vatBasisGate(vat).vatBasisConfirmed).toBe(true);
  });

  it('does not gate once the bearing row is confirmed', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase();
    const confirmed = {
      ...inputs,
      vat: {
        ...inputs.vat,
        treatments: inputs.vat.treatments.map((t) => (t.category === 'construction'
          ? { ...t, evidence_status: 'confirmed' as const }
          : t)),
      },
    };
    const vat = computeVat(confirmed, costPlan, schedule);
    expect(vatBasisGate(vat).vatBasisConfirmed).toBe(true);
  });
});
