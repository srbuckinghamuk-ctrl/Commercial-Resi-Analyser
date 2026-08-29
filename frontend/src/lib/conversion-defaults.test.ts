import { describe, it, expect } from 'vitest';
import {
  defaultCalculatorInputs, defaultCalculatorInputsV3, defaultCalculatorInputsV4,
  defaultCalculatorInputsV5, defaultCalculatorInputsV6, defaultCalculatorInputsV7,
  defaultCalculatorInputsV8, defaultCalculatorInputsV9, defaultCalculatorInputsV10,
  defaultCalculatorInputsV11, defaultCalculatorInputsV12, defaultCalculatorInputsV13,
  defaultCalculatorInputsV14, defaultCalculatorInputsV15, defaultCalculatorInputsV16,
  captureSourceRecord,
  DEFAULT_CONVERSION_COSTS, DEFAULT_SCENARIOS,
} from './conversion-defaults';
import {
  migrateInputs, migrateV4toV5, migrateV5toV6, migrateV6toV7, migrateV7toV8, migrateV8toV9,
  migrateV9toV10, migrateV10toV11, migrateV11toV12, migrateV12toV13, migrateV13toV14, migrateV14toV15,
  migrateV15toV16,
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

describe('defaultCalculatorInputsV9 (R12 Task 18b, spec §18.7)', () => {
  // Same guard as the V5/V6/V7/V8 blocks above, and it is the one that
  // matters most here: this is the document EVERY freshly opened calculator
  // now starts on, and the one every stored appraisal is compared against
  // after `migrateInputsToV9` merges onto it. If the two drifted, a new
  // appraisal and a migrated one would be different documents while both
  // claiming to be v9.
  it('is exactly what migrateV8toV9 makes of the v8 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV9>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV9()))
      .toEqual(stripIds(migrateV8toV9(defaultCalculatorInputsV8())));
  });

  // Non-vacuity for the equality above: the three fields v9 re-types are
  // asserted by name and value, so the comparison cannot be passing merely
  // because both sides are the v8 document with a bumped version number.
  it('starts on the §6 auto windows, with no exit block anchored', () => {
    const v9 = defaultCalculatorInputsV9();
    expect(v9.inputs_version).toBe(9);
    // null programme = the auto windows, bit-identical to calc 2.10.0 --
    // a brand-new appraisal behaves exactly as it did before R12 until the
    // user builds a network on the Programme page.
    expect(v9.programme).toBeNull();
    expect(v9.sales_phasing).toBeNull();
    expect(v9.refinance).toBeNull();
  });

  // The v9-only fields v9 inherits from v8 UNCHANGED, so the type system
  // cannot tell you whether they are actually present. They are what the
  // phase_slip lever (§18.9) and the per-line phase tags (§18.7) read.
  it('carries the phase tags and the phase_slip lever fields inert', () => {
    const v9 = defaultCalculatorInputsV9();
    for (const scenario of [v9.scenarios.base, v9.scenarios.upside,
      v9.scenarios.downside, v9.scenarios.severe]) {
      expect(scenario.phase_slip_phase_id).toBeNull();
      expect(scenario.phase_slip_months).toBe(0);
    }
    for (const line of [...v9.cost_plan.packages, ...v9.cost_plan.fee_lines]) {
      expect(line.phase_id).toBeNull();
    }
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV9();
    const b = defaultCalculatorInputsV9();
    a.vat.treatments[0].rate_pct = 20;
    a.scenarios.base.phase_slip_months = 3;
    expect(b.vat.treatments[0].rate_pct).toBe(0);
    expect(b.scenarios.base.phase_slip_months).toBe(0);
  });
});

describe('defaultCalculatorInputsV10 (R13 Task 18, spec §19.9)', () => {
  // Same guard as the V8/V9 blocks above, and the one that matters most here:
  // this is the document EVERY freshly opened calculator now starts on, and
  // the one every stored appraisal is compared against after
  // `migrateInputsToV10` merges onto it. If the two drifted, a new appraisal
  // and a migrated one would be different documents while both claiming to
  // be v10.
  it('is exactly what migrateV9toV10 makes of the v9 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV10>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV10()))
      .toEqual(stripIds(migrateV9toV10(defaultCalculatorInputsV9())));
  });

  // Non-vacuity for the equality above: the two fields v10 adds are asserted
  // by name and value, so the comparison cannot be passing merely because
  // both sides are the v9 document with a bumped version number.
  it('starts on the explicit investment case, with no derived case set', () => {
    const v10 = defaultCalculatorInputsV10();
    expect(v10.inputs_version).toBe(10);
    // null investment_case = calc 2.11.0's explicit investment_value_pence x
    // ltv_pct path, bit-identical -- a brand-new appraisal behaves exactly as
    // it did before R13 until the user builds a derived case.
    expect(v10.investment_case).toBeNull();
    expect(v10.refinance).toBeNull();
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV10();
    const b = defaultCalculatorInputsV10();
    a.vat.treatments[0].rate_pct = 20;
    a.scenarios.base.phase_slip_months = 3;
    expect(b.vat.treatments[0].rate_pct).toBe(0);
    expect(b.scenarios.base.phase_slip_months).toBe(0);
  });
});

describe('defaultCalculatorInputsV11 (R14 Task 14, spec §20.1)', () => {
  // Same guard as the V9/V10 blocks above, and the one that matters most
  // here: this is the document EVERY freshly opened calculator now starts
  // on, and the one every stored appraisal is compared against after
  // `migrateInputsToV11` merges onto it. If the two drifted, a new appraisal
  // and a migrated one would be different documents while both claiming to
  // be v11.
  it('is exactly what migrateV10toV11 makes of the v10 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV11>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV11()))
      .toEqual(stripIds(migrateV10toV11(defaultCalculatorInputsV10())));
  });

  // Non-vacuity for the equality above: the field v11 adds is asserted by
  // name and value, so the comparison cannot be passing merely because both
  // sides are the v10 document with a bumped version number.
  it('starts with no monitoring statement entered', () => {
    const v11 = defaultCalculatorInputsV11();
    expect(v11.inputs_version).toBe(11);
    // null monitoring = no QS monitoring statement entered, bit-identical --
    // a brand-new appraisal behaves exactly as it did before R14 until a
    // statement is entered on the Finance page's monitoring editor.
    expect(v11.monitoring).toBeNull();
    expect(v11.investment_case).toBeNull();
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV11();
    const b = defaultCalculatorInputsV11();
    a.vat.treatments[0].rate_pct = 20;
    a.scenarios.base.phase_slip_months = 3;
    expect(b.vat.treatments[0].rate_pct).toBe(0);
    expect(b.scenarios.base.phase_slip_months).toBe(0);
  });
});

describe('defaultCalculatorInputsV12 (R13b Task 15, spec §22.1)', () => {
  // Same guard as the V10/V11 blocks above, and the one that matters most
  // here: this is the document EVERY freshly opened calculator now starts
  // on, and the one every stored appraisal is compared against after
  // `migrateInputsToV12` merges onto it. If the two drifted, a new appraisal
  // and a migrated one would be different documents while both claiming to
  // be v12.
  it('is exactly what migrateV11toV12 makes of the v11 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV12>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV12()))
      .toEqual(stripIds(migrateV11toV12(defaultCalculatorInputsV11())));
  });

  // Non-vacuity for the equality above: the field v12 adds is asserted by
  // name and value, so the comparison cannot be passing merely because both
  // sides are the v11 document with a bumped version number.
  it('starts with no unit sales ledger entered', () => {
    const v12 = defaultCalculatorInputsV12();
    expect(v12.inputs_version).toBe(12);
    // null unit_sales = no per-unit sales ledger entered, bit-identical -- a
    // brand-new appraisal behaves exactly as it did before R13b until a
    // ledger is entered on the calculator's unit sales editor.
    expect(v12.unit_sales).toBeNull();
    expect(v12.monitoring).toBeNull();
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV12();
    const b = defaultCalculatorInputsV12();
    a.vat.treatments[0].rate_pct = 20;
    a.scenarios.base.phase_slip_months = 3;
    expect(b.vat.treatments[0].rate_pct).toBe(0);
    expect(b.scenarios.base.phase_slip_months).toBe(0);
  });
});

describe('defaultCalculatorInputsV13 (R15 Task 2, spec §23.10)', () => {
  // Same guard as the V10/V11/V12 blocks above, and the one that matters
  // most here: this is the document EVERY freshly opened calculator now
  // starts on, and the one every stored appraisal is compared against after
  // `migrateInputsToV13` merges onto it.
  it('with no project, is exactly what migrateV12toV13 makes of the v12 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV13>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV13()))
      .toEqual(stripIds(migrateV12toV13(defaultCalculatorInputsV12())));
  });

  // Non-vacuity for the equality above: the fields v13 adds are asserted by
  // name and value, so the comparison cannot be passing merely because both
  // sides are the v12 document with a bumped version number.
  it('starts with every catalogue item unknown, no source record, and null cost-plan provenance', () => {
    const v13 = defaultCalculatorInputsV13();
    expect(v13.inputs_version).toBe(13);
    expect(v13.due_diligence.source_record).toBeNull();
    expect(v13.due_diligence.items.every((i) => i.status === 'unknown')).toBe(true);
    expect(v13.cost_plan.qs).toBeNull();
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV13();
    const b = defaultCalculatorInputsV13();
    a.due_diligence.items[0].status = 'green';
    expect(b.due_diligence.items[0].status).toBe('unknown');
  });

  // R15 spec §23.5: opening the calculator against a real listing captures
  // the listing's structured fields into `due_diligence.source_record` --
  // the project's own PROSE fields (address, description) are never copied.
  it('captures the listing into due_diligence.source_record when a project is given', () => {
    const project = {
      id: 'p', price_pence: 1, floor_area_sqm: 360,
      is_vacant: false, tenure: 'freehold' as const, lease_years_remaining: null,
      source_name: 'rightmove', source_url: null, use_class: 'office' as const, epc_rating: 'D',
    };
    const now = new Date('2026-08-25T09:00:00Z');
    const v13 = defaultCalculatorInputsV13(project, now);
    expect(v13.due_diligence.source_record).toEqual(captureSourceRecord(
      {
        source_name: 'rightmove', source_url: null, is_vacant: false, tenure: 'freehold',
        lease_years_remaining: null, floor_area_sqm: 360, use_class: 'office', epc_rating: 'D',
      },
      '2026-08-25T09:00:00.000Z',
    ));
    expect(v13.due_diligence.source_record!.captured_at).toBe('2026-08-25T09:00:00.000Z');
  });

  // R15 fix wave (minor 6). A partial project states neither tenure nor use
  // class, and the record says so with `null` rather than synthesising
  // 'unknown'/'other' — a captured listing field must be the listing's, and
  // 'unknown' tenure is a REAL value the enum carries, so writing it here
  // would be indistinguishable from a listing that stated it.
  it('records a partial listing tenure and use class as null, not a synthesised value', () => {
    const record = defaultCalculatorInputsV13({
      id: 'p', price_pence: 1, floor_area_sqm: 360, is_vacant: null,
    }).due_diligence.source_record!;
    expect(record.tenure).toBeNull();
    expect(record.use_class).toBeNull();
  });

  it('does not capture a source record when no project is given', () => {
    expect(defaultCalculatorInputsV13().due_diligence.source_record).toBeNull();
  });
});

describe('defaultCalculatorInputsV14 (R15b Task 6, spec §24.8)', () => {
  // Same guard as the V11/V12/V13 blocks above, and the one that matters
  // most here: this is the document EVERY freshly opened calculator now
  // starts on, and the one every stored appraisal is compared against after
  // `migrateInputsToV14` merges onto it.
  it('is exactly what migrateV13toV14 makes of the v13 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV14>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV14()))
      .toEqual(stripIds(migrateV13toV14(defaultCalculatorInputsV13())));
  });

  // Non-vacuity for the equality above: v14 adds no new top-level field
  // (`cost_plan.qs.inflation` already exists on `QsProvenance`), so the
  // proof that this is not just "the v13 document with a bumped version
  // number" is the version number itself plus the inert `qs: null` (the
  // default document never enters a QS statement, so there is nothing for
  // `inflation` to attach to).
  it('starts with inputs_version 14 and null cost-plan provenance', () => {
    const v14 = defaultCalculatorInputsV14();
    expect(v14.inputs_version).toBe(14);
    expect(v14.cost_plan.qs).toBeNull();
    expect(v14.due_diligence.items.every((i) => i.status === 'unknown')).toBe(true);
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV14();
    const b = defaultCalculatorInputsV14();
    a.due_diligence.items[0].status = 'green';
    expect(b.due_diligence.items[0].status).toBe('unknown');
  });

  // R15 spec §23.5 (unchanged by this release): opening the calculator
  // against a real listing still captures it into `due_diligence.
  // source_record` -- v14 touches only `cost_plan.qs`, so this must still
  // hold identically.
  it('captures the listing into due_diligence.source_record when a project is given', () => {
    const project = {
      id: 'p', price_pence: 1, floor_area_sqm: 360,
      is_vacant: false, tenure: 'freehold' as const, lease_years_remaining: null,
      source_name: 'rightmove', source_url: null, use_class: 'office' as const, epc_rating: 'D',
    };
    const now = new Date('2026-08-25T09:00:00Z');
    const v14 = defaultCalculatorInputsV14(project, now);
    expect(v14.due_diligence.source_record).toEqual(captureSourceRecord(
      {
        source_name: 'rightmove', source_url: null, is_vacant: false, tenure: 'freehold',
        lease_years_remaining: null, floor_area_sqm: 360, use_class: 'office', epc_rating: 'D',
      },
      '2026-08-25T09:00:00.000Z',
    ));
  });

  it('does not capture a source record when no project is given', () => {
    expect(defaultCalculatorInputsV14().due_diligence.source_record).toBeNull();
  });
});

describe('defaultCalculatorInputsV15 (R16 Task 4, spec §25.7)', () => {
  // Same guard as the V12/V13/V14 blocks above, and the one that matters
  // most here: this is the document EVERY freshly opened calculator now
  // starts on, and the one every stored appraisal is compared against after
  // `migrateInputsToV15` merges onto it.
  it('is exactly what migrateV14toV15 makes of the v14 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV15>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV15()))
      .toEqual(stripIds(migrateV14toV15(defaultCalculatorInputsV14())));
  });

  // Non-vacuity for the equality above: v15 adds no new top-level field (the
  // four Sec 25.1 fields already exist on `ScenarioOverrides`), so the proof
  // that this is not just "the v14 document with a bumped version number" is
  // the version number itself plus the four fields' identity zero -- already
  // `DEFAULT_SCENARIOS`'s own value (Task 1), so this is a rewrite of the
  // same values, which is fine (the point is the identity, not the change).
  it('starts with inputs_version 15 and the four stress-pack fields at zero on every scenario', () => {
    const v15 = defaultCalculatorInputsV15();
    expect(v15.inputs_version).toBe(15);
    (['base', 'upside', 'downside', 'severe'] as const).forEach((name) => {
      expect(v15.scenarios[name].saleable_area_adjustment_pct).toBe(0);
      expect(v15.scenarios[name].abnormal_cost_adjustment_pct).toBe(0);
      expect(v15.scenarios[name].programme_slip_months).toBe(0);
      expect(v15.scenarios[name].refi_ltv_adjustment_pct).toBe(0);
    });
  });

  it('hands every caller its own document, not one shared mutable default', () => {
    const a = defaultCalculatorInputsV15();
    const b = defaultCalculatorInputsV15();
    a.due_diligence.items[0].status = 'green';
    expect(b.due_diligence.items[0].status).toBe('unknown');
  });

  // R15 spec §23.5 (unchanged by this release): opening the calculator
  // against a real listing still captures it into `due_diligence.
  // source_record` -- v15 touches only the four scenario lever fields, so
  // this must still hold identically.
  it('captures the listing into due_diligence.source_record when a project is given', () => {
    const project = {
      id: 'p', price_pence: 1, floor_area_sqm: 360,
      is_vacant: false, tenure: 'freehold' as const, lease_years_remaining: null,
      source_name: 'rightmove', source_url: null, use_class: 'office' as const, epc_rating: 'D',
    };
    const now = new Date('2026-08-25T09:00:00Z');
    const v15 = defaultCalculatorInputsV15(project, now);
    expect(v15.due_diligence.source_record).toEqual(captureSourceRecord(
      {
        source_name: 'rightmove', source_url: null, is_vacant: false, tenure: 'freehold',
        lease_years_remaining: null, floor_area_sqm: 360, use_class: 'office', epc_rating: 'D',
      },
      '2026-08-25T09:00:00.000Z',
    ));
  });

  it('does not capture a source record when no project is given', () => {
    expect(defaultCalculatorInputsV15().due_diligence.source_record).toBeNull();
  });
});

describe('defaultCalculatorInputsV16 (R16b Task 2, spec §26.1)', () => {
  it('is exactly what migrateV15toV16 makes of the v15 defaults', () => {
    const stripIds = (d: ReturnType<typeof defaultCalculatorInputsV16>) => ({
      ...d,
      risks: d.risks.map((r) => ({ ...r, id: '' })),
      equity_sources: d.equity_sources.map((e) => ({ ...e, id: '' })),
    });
    expect(stripIds(defaultCalculatorInputsV16()))
      .toEqual(stripIds(migrateV15toV16(defaultCalculatorInputsV15())));
  });

  it('starts with inputs_version 16 and exactly the five kept cost keys', () => {
    const v16 = defaultCalculatorInputsV16();
    expect(v16.inputs_version).toBe(16);
    expect(Object.keys(v16.conversion_costs).sort()).toEqual([
      'construction_cost_per_sqm_pence', 'fire_safety_pence', 'part_l_compliance_pence',
      'sound_insulation_pence', 'total_construction_sqm',
    ]);
    // Non-vacuity: the v15 default DID carry the removed keys.
    expect('contingency_pct' in defaultCalculatorInputsV15().conversion_costs).toBe(true);
  });
});
