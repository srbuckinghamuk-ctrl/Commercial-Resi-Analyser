import { describe, it, expect } from 'vitest';
import {
  defaultCalculatorInputs, defaultCalculatorInputsV3, defaultCalculatorInputsV4,
  defaultCalculatorInputsV5, defaultCalculatorInputsV6, DEFAULT_SCENARIOS,
} from './conversion-defaults';
import { migrateInputs, migrateV4toV5, migrateV5toV6 } from './model';
import { CLASS_MA_AXES } from './deal-spider';

describe('defaultCalculatorInputs', () => {
  it('includes a severe scenario matching the ported preset (-15% GDV, +20% cost, +6mo)', () => {
    const inputs = defaultCalculatorInputs();
    expect(inputs.scenarios.severe.gdv_adjustment_pct).toBe(-15);
    expect(inputs.scenarios.severe.construction_cost_adjustment_pct).toBe(20);
    expect(inputs.scenarios.severe.timeline_adjustment_months).toBe(6);
  });

  it('includes deal_spider defaults with a weight of 1 for every Class MA axis', () => {
    const inputs = defaultCalculatorInputs();
    expect(inputs.deal_spider).toBeDefined();
    for (const axis of CLASS_MA_AXES) {
      expect(inputs.deal_spider.weights[axis.id]).toBe(1);
    }
    expect(inputs.deal_spider.target_profit_on_cost_pct).toBe(20);
    expect(inputs.deal_spider.daylight_pass_pct).toBe(100);
  });

  it('seeds storeys from the project floors when available', () => {
    const inputs = defaultCalculatorInputs({ id: 'p', price_pence: 0, floor_area_sqm: null, floors: 4 });
    expect(inputs.deal_spider.storeys).toBe(4);
  });
});

describe('migrateInputs (legacy v1 snapshot merge)', () => {
  it('fills severe scenario and deal_spider on a legacy snapshot without losing saved values', () => {
    const legacy = defaultCalculatorInputs();
    legacy.acquisition.purchase_price_pence = 42_000_000;
    legacy.scenarios.downside.gdv_adjustment_pct = -12;
    // Simulate a snapshot saved before the spider existed
    const snapshot = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
    delete (snapshot as { scenarios?: { severe?: unknown } }).scenarios!.severe;
    delete (snapshot as { deal_spider?: unknown }).deal_spider;

    const merged = migrateInputs(snapshot);
    expect(merged.acquisition.purchase_price_pence).toBe(42_000_000);
    expect(merged.scenarios.downside.gdv_adjustment_pct).toBe(-12);
    expect(merged.scenarios.severe).toEqual(DEFAULT_SCENARIOS.severe);
    expect(merged.deal_spider.absorption_months).toBeGreaterThan(0);
  });

  it('preserves saved deal_spider values and merges missing weight keys', () => {
    const saved = defaultCalculatorInputs();
    saved.deal_spider.absorption_months = 14;
    const snapshot = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
    (snapshot as { deal_spider: { weights: Record<string, number> } }).deal_spider.weights = {
      margin_resilience: 2,
    };

    const merged = migrateInputs(snapshot);
    expect(merged.deal_spider.absorption_months).toBe(14);
    expect(merged.deal_spider.weights.margin_resilience).toBe(2);
    expect(merged.deal_spider.weights.tax_advantage).toBe(1);
  });
});

describe('defaultCalculatorInputsV4', () => {
  it('is v3 defaults plus the three null blocks', () => {
    const v4 = defaultCalculatorInputsV4();
    expect(v4.inputs_version).toBe(4);
    expect(v4.programme).toBeNull();
    expect(v4.sales_phasing).toBeNull();
    expect(v4.refinance).toBeNull();
    expect(v4.finance).toEqual(defaultCalculatorInputsV3().finance);
  });
});

describe('defaultCalculatorInputsV5 (R8 Task 11)', () => {
  // The calculator's fresh document and a migrated one must be the same
  // document. This is spelled out literally in conversion-defaults.ts (that
  // module cannot import model/migrate.ts -- migrate.ts imports it), so this is
  // the guard that stops the two definitions drifting apart.
  it('is exactly what migrateV4toV5 makes of the v4 defaults', () => {
    // `risks` and `equity_sources` carry freshly minted crypto.randomUUID()s on
    // every call, so they are compared by shape rather than by id; everything
    // else -- the acquisition block above all -- is compared field for field.
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV5>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV5()))
      .toEqual(stripIds(migrateV4toV5(defaultCalculatorInputsV4())));
  });

  it('records no jurisdiction of its own, so the server may still derive one from the postcode', () => {
    const v5 = defaultCalculatorInputsV5();
    expect(v5.inputs_version).toBe(5);
    // app/api/app.py applies a postcode-derived jurisdiction ONLY when the
    // source is 'migrated_default'. Stamping 'derived' here would silently
    // disable derivation on every new appraisal.
    expect(v5.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(v5.acquisition.jurisdiction_evidence_status).toBe('unconfirmed');
  });

  it('leaves the acquisition date unknown rather than assuming today (spec §1.5)', () => {
    expect(defaultCalculatorInputsV5().acquisition.acquisition_date).toBeNull();
  });
});

describe('defaultCalculatorInputsV6 (R9 Task 3)', () => {
  // Same guard as the V5 block above, for the same reason: conversion-defaults.ts
  // cannot import model/migrate.ts (migrate.ts imports it), so the v6 blocks are
  // spelled out there and this is what stops the fresh document and the migrated
  // one drifting apart.
  it('is exactly what migrateV5toV6 makes of the v5 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV6>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV6()))
      .toEqual(stripIds(migrateV5toV6(defaultCalculatorInputsV5())));
  });

  it('starts on the manual basis with a zeroed bridge, so no cost area moves', () => {
    const v6 = defaultCalculatorInputsV6();
    expect(v6.inputs_version).toBe(6);
    expect(v6.areas.basis).toBe('manual');
    expect(v6.areas.existing_gia_sqm).toBe(0);
    expect(v6.areas.external_amenity_sqm).toBe(0);
  });

  it('carries the v5 acquisition block through untouched', () => {
    const v6 = defaultCalculatorInputsV6();
    expect(v6.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(v6.acquisition.acquisition_date).toBeNull();
  });
});
