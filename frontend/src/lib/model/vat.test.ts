import { describe, it, expect } from 'vitest';
import {
  VAT_CHARGE_CATEGORIES, DEFAULT_VAT, defaultVatTreatments,
  resolveVatTreatment, isPurchaseVatChargeable, vatReturnPeriods,
  spreadProRata, computeVat,
} from './vat';
import { computeCostPlan, defaultContingencyClasses } from './cost-plan';
import { buildSchedule } from './schedule';
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
      committed_net_facility_pence: 500_000_000,
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
