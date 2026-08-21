import { describe, it, expect } from 'vitest';
import {
  VAT_CHARGE_CATEGORIES, DEFAULT_VAT, defaultVatTreatments,
  resolveVatTreatment, isPurchaseVatChargeable, vatReturnPeriods,
} from './vat';

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
