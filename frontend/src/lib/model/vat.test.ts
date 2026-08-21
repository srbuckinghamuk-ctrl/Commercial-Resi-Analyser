import { describe, it, expect } from 'vitest';
import {
  VAT_CHARGE_CATEGORIES, DEFAULT_VAT, defaultVatTreatments,
  resolveVatTreatment, isPurchaseVatChargeable,
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
