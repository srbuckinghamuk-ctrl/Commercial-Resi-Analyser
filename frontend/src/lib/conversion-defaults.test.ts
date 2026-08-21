import { describe, it, expect } from 'vitest';
import {
  defaultCalculatorInputs, defaultCalculatorInputsV3, defaultCalculatorInputsV4,
  defaultCalculatorInputsV5, defaultCalculatorInputsV6, defaultCalculatorInputsV7,
  defaultCalculatorInputsV8,
  DEFAULT_CONVERSION_COSTS, DEFAULT_SCENARIOS,
} from './conversion-defaults';
import {
  migrateInputs, migrateV4toV5, migrateV5toV6, migrateV6toV7, migrateV7toV8,
  costPlanFromLegacyCosts, VAT_CHARGE_CATEGORIES,
} from './model';
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

describe('defaultCalculatorInputsV7 (R10 Task 12)', () => {
  // Same guard as the V5/V6 blocks above: conversion-defaults.ts cannot import
  // model/migrate.ts (migrate.ts imports it), so this is what stops the fresh
  // document and the migrated one drifting apart.
  it('is exactly what migrateV6toV7 makes of the v6 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV7>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV7()))
      .toEqual(stripIds(migrateV6toV7(defaultCalculatorInputsV6())));
  });

  // Carried item (a) of Task 12: the cost plan was ported from the bare
  // DEFAULT_COST_PLAN (no fee lines) to costPlanFromLegacyCosts(DEFAULT_CONVERSION_COSTS)
  // -- the SAME construction the migration and the engine's pre-v7 fallback
  // use (ruling P2) -- so a brand-new document starts with the same eight fee
  // lines a migrated one gets.
  it('derives cost_plan from DEFAULT_CONVERSION_COSTS via costPlanFromLegacyCosts, not the bare default', () => {
    expect(defaultCalculatorInputsV7().cost_plan)
      .toEqual(costPlanFromLegacyCosts(DEFAULT_CONVERSION_COSTS));
  });

  // Carried item (b) of Task 12 (Task 6 fix round 1, ruling on I3): Python's
  // `_default_v7()` test helper (tests/test_cost_plan.py) builds its document
  // via `migrate_inputs_to_v7({})`, which resolves to the SAME construction --
  // `cost_plan_from_legacy_costs(DEFAULT_CONVERSION_COSTS)`, where Python's
  // DEFAULT_CONVERSION_COSTS (app/financial_model/migrate.py) is field-for-field
  // identical to this file's. The two engines' v7 defaults were DELIBERATELY
  // diverged earlier in the release (TS had zero fee lines, Python had eight);
  // this pins that they have re-converged, by asserting the literal figures
  // Python's suite independently pins for the same eight lines. If either
  // side's default changes without the other, this is the test that fails.
  it('the eight default fee lines match Python\'s _default_v7() literal for literal (cross-engine parity)', () => {
    const plan = defaultCalculatorInputsV7().cost_plan;
    expect(plan.mode).toBe('headline');
    expect(plan.packages).toEqual([]);
    expect(plan.contingency.map((c) => [c.name, c.pct])).toEqual([
      ['general', 10], ['existing_building', 0], ['abnormal', 0],
    ]);
    const byCode = Object.fromEntries(plan.fee_lines.map((f) => [f.code, f]));
    expect(Object.keys(byCode).sort()).toEqual([
      'architect', 'building_control', 'cil_s106', 'mande',
      'other_professional', 'planning_consultant', 'prior_approval', 'structural_engineer',
    ]);
    const expected: Record<string, { category: string; amount: number; perDwelling: boolean }> = {
      architect: { category: 'professional', amount: 1_500_000, perDwelling: false },
      structural_engineer: { category: 'professional', amount: 500_000, perDwelling: false },
      mande: { category: 'professional', amount: 500_000, perDwelling: false },
      planning_consultant: { category: 'professional', amount: 300_000, perDwelling: false },
      other_professional: { category: 'professional', amount: 0, perDwelling: false },
      prior_approval: { category: 'statutory', amount: 9_600, perDwelling: true },
      cil_s106: { category: 'statutory', amount: 0, perDwelling: false },
      building_control: { category: 'statutory', amount: 200_000, perDwelling: false },
    };
    for (const [code, exp] of Object.entries(expected)) {
      const f = byCode[code];
      expect(f.basis).toBe('fixed');
      expect(f.category).toBe(exp.category);
      expect(f.amount_pence).toBe(exp.amount);
      expect(f.pct).toBe(0);
      expect(f.per_dwelling).toBe(exp.perDwelling);
    }
  });
});

describe('defaultCalculatorInputsV8 (R11 Task 10, spec §17.11)', () => {
  // Same guard as the V5/V6/V7 blocks above: conversion-defaults.ts cannot
  // import model/migrate.ts (migrate.ts imports it), so this is what stops the
  // fresh document and the migrated one drifting apart. §17.11 makes that
  // drift a specification failure and not just an inconsistency: DEFAULT_VAT
  // and the migration must write the SAME block.
  it('is exactly what migrateV7toV8 makes of the v7 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV8>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV8()))
      .toEqual(stripIds(migrateV7toV8(defaultCalculatorInputsV7())));
  });

  // The literal block Python's `migrate_inputs_to_v8({})` independently
  // produces, via CalculatorInputsV8's `DEFAULT_VAT.model_copy(deep=True)`
  // default_factory -- pinned here the same way the eight fee lines above pin
  // the v7 re-convergence. tests/test_migrate_v8.py asserts the same figures.
  it("the default VAT block matches Python's migrate_inputs_to_v8({}) field for field", () => {
    const vat = defaultCalculatorInputsV8().vat;
    expect(vat.registered).toBe(false);
    expect(vat.return_frequency).toBe('quarterly');
    expect(vat.first_period_end_month).toBe(2);
    expect(vat.repayment_lag_months).toBe(1);
    expect(vat.treatments.map((t) => t.category)).toEqual([...VAT_CHARGE_CATEGORIES]);
    for (const t of vat.treatments) {
      expect(t.rate_pct).toBe(0);
      expect(t.recoverable_pct).toBe(0);
      expect(t.recovery_basis).toBe('unconfirmed');
      expect(t.evidence_status).toBe('unconfirmed');
      expect(t.notes).toBe('');
    }
    expect(vat.purchase).toEqual({
      vendor_opted_to_tax: false,
      togc_treatment: 'unconfirmed',
      evidence_status: 'unconfirmed',
      notes: '',
    });
  });

  it('hands every caller its own block, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV8();
    const b = defaultCalculatorInputsV8();
    a.vat.treatments[0].rate_pct = 20;
    a.vat.purchase.notes = 'edited';
    expect(b.vat.treatments[0].rate_pct).toBe(0);
    expect(b.vat.purchase.notes).toBe('');
  });
});
