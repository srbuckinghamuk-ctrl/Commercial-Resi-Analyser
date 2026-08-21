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
}

/** The §17.4 worked cycle, built as a REAL document and run through the REAL
 *  `computeCostPlan` and `buildSchedule` — never a stub, because the point of
 *  these tests is that VAT reads the cost plan and the spend profile the rest
 *  of the engine produces.
 *
 *  Construction is the only thing in the document that bears VAT:
 *  £1,000/sqm × 1,000 sqm = £1,000,000 base build, contingency 0%, compliance
 *  0, NO fee lines, no units (so no sale and no selling costs), and a default
 *  acquisition that is not opted to tax (so no purchase VAT). Every figure the
 *  tests below assert is therefore traceable to that one input, and the first
 *  test asserts the constructed schedule and cost plan BEFORE it asserts
 *  anything about VAT.
 *
 *  The explicit programme is load-bearing: the AUTO window spreads construction
 *  across months 1..term-2 — five months for a term of seven — not the four the
 *  worked cycle specifies. */
function buildWorkedVatCase(opts: WorkedVatOpts = {}) {
  const termMonths = opts.termMonths ?? 7;
  const recoverablePct = opts.recoverablePct ?? 100;
  const registered = opts.registered ?? true;
  const allCategories = opts.allCategoriesAt20 ?? false;
  const v7 = defaultCalculatorInputsV7();
  const inputs: CalculatorInputsV8 = {
    ...v7,
    inputs_version: 8,
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
    finance: { ...v7.finance, term_months: termMonths },
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
        allCategories || t.category === 'construction'
          ? {
            ...t,
            rate_pct: 20,
            recoverable_pct: allCategories ? 100 : recoverablePct,
            recovery_basis: 'zero_rated_sale' as const,
          }
          : t),
    },
  };
  const costPlan = computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length);
  const schedule = buildSchedule(inputs);
  return { inputs, costPlan, schedule };
}

/** Detailed mode, two packages, one of them carrying a `vat_override`.
 *  Base build 60,000,000 + 40,000,000; general contingency 10% → 10,000,000;
 *  construction total 110,000,000. */
function buildDetailedVatCase() {
  const v7 = defaultCalculatorInputsV7();
  const inputs: CalculatorInputsV8 = {
    ...v7,
    inputs_version: 8,
    conversion_costs: {
      ...v7.conversion_costs,
      total_construction_sqm: 1_000,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    },
    cost_plan: {
      mode: 'detailed',
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
          ? { ...t, rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' as const }
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

  it('returns all zeros when the weights sum to zero, placing nothing in month 0', () => {
    // A charge with no monthly spend cannot be placed. Silently moving it to
    // month 0 would invent a cash outflow the schedule does not show.
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
    expect(vat.total_input_vat_pence).toBe(20_000_000);
    expect(vat.total_reclaimed_pence).toBe(20_000_000);
    expect(vat.total_irrecoverable_pence).toBe(0);
    expect(vat.receivable_at_maturity_pence).toBe(0);
  });

  it('reports a reclaim falling past the term as receivable, not as cash', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ termMonths: 5 });
    const vat = computeVat(inputs, costPlan, schedule);
    expect(vat.total_reclaimed_pence).toBeLessThan(vat.total_input_vat_pence);
    expect(vat.receivable_at_maturity_pence)
      .toBe(vat.total_input_vat_pence - vat.total_reclaimed_pence);
  });

  it('splits a partly recoverable charge into recoverable and irrecoverable, residue to irrecoverable', () => {
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ recoverablePct: 33 });
    const vat = computeVat(inputs, costPlan, schedule);
    // 20,000,000p charged; 33% recoverable = 6,600,000p; irrecoverable is the
    // remainder, so charged == recoverable + irrecoverable exactly.
    expect(vat.total_recoverable_pence + vat.total_irrecoverable_pence)
      .toBe(vat.total_input_vat_pence);
    expect(vat.total_irrecoverable_pence).toBeGreaterThan(0);
  });

  it('never charges VAT on interest or on the arrangement or exit fee', () => {
    // The only finance-side charge that may appear is lender_ancillary.
    const { inputs, costPlan, schedule } = buildWorkedVatCase({ allCategoriesAt20: true });
    const vat = computeVat(inputs, costPlan, schedule);
    const financeCharges = vat.charges.filter((c) => c.category === 'lender_ancillary');
    expect(vat.charges.every((c) => VAT_CHARGE_CATEGORIES.includes(c.category))).toBe(true);
    expect(financeCharges.every((c) => c.label.toLowerCase().includes('ancillary'))).toBe(true);
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
    const vat = computeVat(inputs, costPlan, schedule);
    const constructionBase = vat.charges
      .filter((c) => c.category === 'construction')
      .reduce((s, c) => s + c.net_base_pence, 0);
    expect(constructionBase).toBe(costPlan.construction_total_pence);
  });
});
