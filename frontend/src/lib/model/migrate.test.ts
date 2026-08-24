import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  migrateInputs, migrateV2toV3, migrateInputsToV3, isV3,
  migrateV3toV4, migrateInputsToV4,
  migrateV4toV5, migrateInputsToV5,
  migrateV5toV6, migrateInputsToV6,
  migrateV6toV7, migrateInputsToV7,
  migrateV7toV8, migrateInputsToV8, isV8,
  migrateV8toV9, migrateInputsToV9, PACKAGE_TO_PHASE,
  migrateV9toV10, migrateInputsToV10,
  migrateV10toV11, migrateInputsToV11,
  migrateV11toV12, migrateInputsToV12,
} from './migrate';
import type {
  CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV5,
  CalculatorInputsV7, CalculatorInputsV8, CalculatorInputsV9, CalculatorInputsV10, CalculatorInputsV11,
  MonitoringCategory, MonitoringLineInputs,
} from './finance-types';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { VAT_CHARGE_CATEGORIES, defaultVatInputs, defaultVatTreatments } from './vat';
import { runAppraisal } from './index';
import { validateInputs } from './validation';

const V1_SNAPSHOT = {
  project_id: 'p1',
  acquisition: {
    purchase_price_pence: 42_500_000, legal_fees_pence: 500_000,
    survey_cost_pence: 300_000, broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  },
  unit_mix: { units: [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' }] },
  conversion_costs: {
    prior_approval_fee_per_dwelling_pence: 9_600, cil_s106_pence: 0, architect_pence: 1_500_000,
    structural_engineer_pence: 500_000, mande_pence: 500_000, planning_consultant_pence: 300_000,
    building_control_pence: 200_000, other_professional_fees_pence: 0,
    construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 500,
    contingency_pct: 10, fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
  },
  finance: {
    funding_source: 'development_finance', ltv_pct: 70, interest_rate_annual_pct: 8,
    arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 12, interest_type: 'rolled_up',
  },
  exit_strategy: { route: 'retain_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 150_000, retained_units: [] },
};

describe('migrateInputs', () => {
  it('passes a v2 document through unchanged', () => {
    const v2 = migrateInputs({ ...V1_SNAPSHOT, inputs_version: 2, finance: undefined } as never);
    // a malformed "v2" without finance still normalises — but a real v2 round-trips:
    const again = migrateInputs(v2 as unknown as Record<string, unknown>);
    expect(again).toEqual(v2);
  });

  it('migrates v1 ltv_pct to an unconfirmed proposed facility, never an approved metric', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    expect(v2.inputs_version).toBe(2);
    expect(v2.finance.legacy_leverage_pct).toBe(70);
    expect(v2.finance.requires_confirmation).toBe(true);
    expect(v2.finance.day_one_advance_pence).toBeNull();
    expect(v2.finance.equity_draw_rule).toBe('fund_as_required');
    // proposed net facility = round(v1 cost-before-finance × 70%)
    // v1 cost before finance for this snapshot:
    //   acquisition 42,500,000 + SDLT 1,075,000 + 500,000 + 300,000 + broker 425,000 = 44,800,000
    //   construction 50,000×500 = 25,000,000 + 10% cont 2,500,000 = 27,500,000 (+£0.01... compliance 0)
    //   professional+statutory 9,600 + 1,500,000+500,000+500,000+300,000+200,000 = 3,009,600
    //   total 75,309,600 → 70% = 52,716,720
    expect(v2.finance.committed_net_facility_pence).toBe(52_716_720);
    expect(v2.finance.term_months).toBe(12);
    expect(v2.finance.interest_type).toBe('rolled_up');
  });

  it('creates a single unconfirmed cash equity source for v1 snapshots', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    expect(v2.equity_sources).toHaveLength(1);
    expect(v2.equity_sources[0].classification).toBe('cash');
    expect(v2.equity_sources[0].evidence_status).toBe('unconfirmed');
    // residual equity = 75,309,600 − 52,716,720
    expect(v2.equity_sources[0].amount_pence).toBe(22_592_880);
  });

  it('forces zero facility for v1 cash funding', () => {
    const v2 = migrateInputs({ ...V1_SNAPSHOT, finance: { ...V1_SNAPSHOT.finance, funding_source: 'cash' } });
    expect(v2.finance.committed_net_facility_pence).toBe(0);
    expect(v2.finance.legacy_leverage_pct).toBe(70);
    expect(v2.equity_sources[0].amount_pence).toBe(75_309_600);
  });

});

describe('migrateV2toV3', () => {
  it('migrates a minimal v2 document to v3 with lender_valuation null and enforcement default 0, all other fields byte-identical', () => {
    const v2 = defaultCalculatorInputsV2();
    const v3 = migrateV2toV3(v2);

    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toBeNull();
    expect(v3.finance.enforcement_cost_assumption_pence).toBe(0);

    const { inputs_version: _v2Version, ...v2Rest } = v2;
    const { inputs_version: _v3Version, lender_valuation: _lv, ...v3Rest } = v3;
    expect(v3Rest).toEqual(v2Rest);
  });

  it('rejects migrating an already-v3 document (idempotence guard), and isV3 recognises it', () => {
    const v2 = defaultCalculatorInputsV2();
    const v3 = migrateV2toV3(v2);

    expect(isV3(v3 as unknown as Record<string, unknown>)).toBe(true);
    expect(() => migrateV2toV3(v3 as unknown as CalculatorInputsV2)).toThrow();
  });

  it('chains a v1 snapshot through migrateInputs then migrateV2toV3, ending at v3 with both new fields defaulted and the v1 migration flags intact', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    const v3 = migrateV2toV3(v2);

    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toBeNull();
    expect(v3.finance.enforcement_cost_assumption_pence).toBe(0);
    // v1 migration flags preserved:
    expect(v3.finance.requires_confirmation).toBe(true);
    expect(v3.finance.legacy_leverage_pct).toBe(70);
    expect(v3.equity_sources[0].evidence_status).toBe('unconfirmed');
  });

  it('passes an already-present (illegal on a v2 doc) lender_valuation block through unchanged, then validates as v3', () => {
    const v2 = defaultCalculatorInputsV2();
    const illegalBlock = {
      basis: 'fixed_amount' as const, global_value: 100_000_00, per_key_values: null,
      reason: 'Independent RICS valuation', author: 'J. Smith', date: '2026-01-01',
    };
    const v2WithBlock = { ...v2, lender_valuation: illegalBlock } as unknown as CalculatorInputsV2;

    const v3 = migrateV2toV3(v2WithBlock);

    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toEqual(illegalBlock);
  });
});

describe('migrateInputsToV3', () => {
  it('chains a v1 snapshot through migrateInputs then migrateV2toV3', () => {
    const v3 = migrateInputsToV3(V1_SNAPSHOT);
    expect(v3.inputs_version).toBe(3);
    expect(v3.lender_valuation).toBeNull();
    expect(v3.finance.legacy_leverage_pct).toBe(70);
    expect(v3.finance.requires_confirmation).toBe(true);
  });

  it('chains a v2 snapshot through migrateV2toV3', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    const v3 = migrateInputsToV3(v2 as unknown as Record<string, unknown>);
    expect(v3.inputs_version).toBe(3);
    expect(v3.finance.legacy_leverage_pct).toBe(70);
  });

  it('round-trips a v3 snapshot unchanged, including a populated lender_valuation block', () => {
    const v3In: CalculatorInputsV3 = {
      ...migrateV2toV3(defaultCalculatorInputsV2()),
      lender_valuation: {
        basis: 'fixed_amount', global_value: 100_000_00, per_key_values: null,
        reason: 'Independent RICS valuation', author: 'J. Smith', date: '2026-01-01',
      },
    };
    const v3Out = migrateInputsToV3(v3In as unknown as Record<string, unknown>);
    expect(v3Out.lender_valuation).toEqual(v3In.lender_valuation);
    expect(v3Out.finance).toEqual(v3In.finance);
    expect(v3Out.unit_mix).toEqual(v3In.unit_mix);
  });

  it('a v3 snapshot missing fields (schema drift) is merged onto v3 defaults, not misread as v1', () => {
    // A v3-tagged snapshot with only a subset of fields — never routed through the v1
    // fallback path, which would otherwise misread `finance` as v1-shaped and silently
    // produce garbage facility terms (ltv_pct-derived committed facility, etc.).
    const partial = {
      inputs_version: 3,
      finance: { committed_net_facility_pence: 5_000_000, annual_interest_rate_pct: 9 },
      lender_valuation: null,
    };
    const v3 = migrateInputsToV3(partial);
    expect(v3.inputs_version).toBe(3);
    expect(v3.finance.committed_net_facility_pence).toBe(5_000_000);
    expect(v3.finance.annual_interest_rate_pct).toBe(9);
    // Fields absent from the partial snapshot fall back to v3 defaults, not v1-migration garbage:
    expect(v3.finance.legacy_leverage_pct).toBeNull();
    expect(v3.finance.requires_confirmation).toBe(false);
    expect(v3.lender_valuation).toBeNull();
  });

});

describe('migrateInputsToV3 refuses v4 documents (R3b — shim removed)', () => {
  it('throws instead of downgrading — dropping the v4 blocks would lose user data', () => {
    const v4 = migrateInputsToV4({});
    expect(() => migrateInputsToV3(v4 as unknown as Record<string, unknown>))
      .toThrow(/v4 document/);
  });
  it('migrateInputsToV4 remains the hydration path and preserves all three blocks', () => {
    const v4 = migrateInputsToV4({});
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    v4.refinance = {
      month_offset: 11, investment_value_pence: 30_000_000, ltv_pct: 65,
      arrangement_fee_pence: 0, legal_costs_pence: 0,
    };
    const again = migrateInputsToV4(v4 as unknown as Record<string, unknown>);
    expect(again.sales_phasing).toEqual(v4.sales_phasing);
    expect(again.refinance).toEqual(v4.refinance);
  });
});

describe('migrateV3toV4 / migrateInputsToV4', () => {
  it('stamps version 4 and nulls the three new blocks', () => {
    const v3 = migrateInputsToV3({});
    const v4 = migrateV3toV4(v3);
    expect(v4.inputs_version).toBe(4);
    expect(v4.programme).toBeNull();
    expect(v4.sales_phasing).toBeNull();
    expect(v4.refinance).toBeNull();
    expect(v4.finance).toEqual(v3.finance);
    expect(v4.lender_valuation).toEqual(v3.lender_valuation);
  });
  it('throws on double-migration', () => {
    const v4 = migrateInputsToV4({});
    expect(() => migrateV3toV4(v4 as never)).toThrow(/already a v4/);
  });
  it('migrateInputsToV4 normalises v1, v2, v3 and v4 snapshots', () => {
    for (const snap of [{}, migrateInputs({}), migrateInputsToV3({}), migrateInputsToV4({})]) {
      const out = migrateInputsToV4(snap as Record<string, unknown>);
      expect(out.inputs_version).toBe(4);
      expect(out.programme).toBeNull();
    }
  });
  it('preserves a saved programme block on a v4 round-trip', () => {
    const v4 = migrateInputsToV4({});
    v4.programme = {
      anchor_month: '2026-09',
      packages: {
        construction: { start_offset: 1, duration_months: 6, curve: { kind: 's_curve' } },
        professional: { start_offset: 2, duration_months: 3, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 4, duration_months: 2, curve: { kind: 'back_loaded' } },
      },
    };
    const again = migrateInputsToV4(v4 as unknown as Record<string, unknown>);
    expect(again.programme).toEqual(v4.programme);
  });
});

describe('v5 migration (R8 — jurisdiction and acquisition tax)', () => {
  it('stamps a migrated default jurisdiction, unconfirmed, with no date', () => {
    const v4 = migrateInputsToV4({ inputs_version: 1 } as Record<string, unknown>);
    const v5 = migrateV4toV5(v4);
    expect(v5.inputs_version).toBe(5);
    expect(v5.acquisition.jurisdiction).toBe('england_ni');
    expect(v5.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(v5.acquisition.jurisdiction_evidence_status).toBe('unconfirmed');
    expect(v5.acquisition.acquisition_date).toBeNull();
    expect(v5.acquisition.acquisition_tax_override_pence).toBeNull();
    expect(v5.acquisition.acquisition_tax_override_reason).toBe('');
  });

  it('carries every other field across unchanged', () => {
    const v4 = migrateInputsToV4({ inputs_version: 1 } as Record<string, unknown>);
    const v5 = migrateV4toV5(v4);
    const { inputs_version: _iv, acquisition: a5, ...rest5 } = v5;
    const { inputs_version: _iv4, acquisition: a4, ...rest4 } = v4;
    expect(rest5).toEqual(rest4);
    // The v4 acquisition fields survive verbatim alongside the five new ones.
    expect(a5.purchase_price_pence).toBe(a4.purchase_price_pence);
    expect(a5.legal_fees_pence).toBe(a4.legal_fees_pence);
    expect(a5.broker_fee_pct).toBe(a4.broker_fee_pct);
  });

  it('refuses to double-migrate', () => {
    const v5 = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    expect(() => migrateV4toV5(v5 as unknown as CalculatorInputsV4))
      .toThrow('migrateV4toV5: input is already a v5 document');
  });

  it('refuses to downgrade a v5 document through the v4 entry point', () => {
    const v5 = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    expect(() => migrateInputsToV4(v5 as unknown as Record<string, unknown>))
      .toThrow('migrateInputsToV4: input is a v5 document — use migrateInputsToV5');
  });

  it.each([1, 2, 3, 4])('normalises a v%i snapshot to v5', (version) => {
    const v5 = migrateInputsToV5({ inputs_version: version } as Record<string, unknown>);
    expect(v5.inputs_version).toBe(5);
    expect(v5.acquisition.jurisdiction).toBe('england_ni');
  });

  it('preserves a saved v5 document’s confirmed jurisdiction', () => {
    const saved = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    saved.acquisition.jurisdiction = 'wales';
    saved.acquisition.jurisdiction_source = 'user';
    saved.acquisition.jurisdiction_evidence_status = 'confirmed';
    saved.acquisition.acquisition_date = '2026-05-01';
    const round = migrateInputsToV5(saved as unknown as Record<string, unknown>);
    expect(round.acquisition.jurisdiction).toBe('wales');
    expect(round.acquisition.jurisdiction_source).toBe('user');
    expect(round.acquisition.jurisdiction_evidence_status).toBe('confirmed');
    expect(round.acquisition.acquisition_date).toBe('2026-05-01');
  });

  // Task 10 fix round 2: mirrors migrate_inputs_to_v5's Python guard
  // (app/financial_model/migrate.py, added fix round 1). Both cases used to
  // fall through every isVN check undetected into the v1 fallback path,
  // which reads the document as noise and rebuilds finance/equity_sources
  // from an LTV-based heuristic.
  it('refuses an unrecognised inputs_version rather than silently rebuilding via the v1 fallback', () => {
    const v5 = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    const doc = { ...v5, inputs_version: 6 } as unknown as Record<string, unknown>;
    expect(() => migrateInputsToV5(doc)).toThrow(/unrecognised inputs_version 6/);
  });

  it('refuses a document tagged inputs_version 5 that fails the v5 structural check', () => {
    const v5 = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    const finance = { ...v5.finance } as Record<string, unknown>;
    delete finance.committed_net_facility_pence;
    const doc = { ...v5, finance } as unknown as Record<string, unknown>;
    expect(() => migrateInputsToV5(doc))
      .toThrow(/inputs_version is 5 but the document fails the v5 structural check/);
  });

  it('still lets a malformed v2 document fall through to the v1 legacy path (unchanged, permissive)', () => {
    // Mirrors the Python-side pin (test_malformed_v2_snapshot_migrates_to_
    // legacy_unreconciled): only an unrecognised version, or a version-5 tag
    // that isn't structurally v5, is refused -- a malformed v2/v3/v4 tag
    // keeps the existing, deliberately permissive v1-fallback behaviour.
    const doc = {
      inputs_version: 2,
      finance: { funding_source: 'cash' }, // missing committed_net_facility_pence -- isV2 is false
    } as unknown as Record<string, unknown>;
    const v5 = migrateInputsToV5(doc);
    expect(v5.inputs_version).toBe(5);
  });
});

describe('R9 — v5 to v6 migration', () => {
  const v5 = migrateInputsToV5({}, { id: 'p1', price_pence: 42_500_000, floor_area_sqm: 500 });

  it('stamps inputs_version 6', () => {
    expect(migrateV5toV6(v5).inputs_version).toBe(6);
  });

  it('defaults the area basis to manual so no cost area moves', () => {
    const v6 = migrateV5toV6(v5);
    expect(v6.areas.basis).toBe('manual');
    expect(v6.areas.existing_gia_sqm).toBe(0);
    expect(v6.conversion_costs.total_construction_sqm)
      .toBe(v5.conversion_costs.total_construction_sqm);
  });

  it('gives every unit a zeroed ancillary block', () => {
    const withUnits = {
      ...v5,
      unit_mix: { units: [
        { id: 'u1', type: '1bed' as const, floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
      ] },
    };
    const v6 = migrateV5toV6(withUnits);
    expect(v6.unit_mix.units[0].ancillary).toEqual({
      balcony_terrace_sqm: 0,
      balcony_terrace_value_pence: 0,
      parking_spaces: 0,
      parking_value_pence: 0,
    });
  });

  it('refuses to double-migrate', () => {
    const v6 = migrateV5toV6(v5);
    expect(() => migrateV5toV6(v6 as never)).toThrow(/already a v6 document/);
  });

  it('refuses an unrecognised inputs_version rather than reaching the v1 fallback', () => {
    // R8's silent-corruption bug: migrateInputsToV4 had no v5 guard, so a v5
    // document fell to the v1 fallback, was rebuilt from ltv_pct and returned 201.
    expect(() => migrateInputsToV6({ inputs_version: 7 })).toThrow(/unrecognised inputs_version/);
    expect(() => migrateInputsToV6({ inputs_version: 99 })).toThrow(/unrecognised inputs_version/);
  });

  it('refuses a document tagged v6 that fails the structural check', () => {
    expect(() => migrateInputsToV6({ inputs_version: 6, finance: 'not an object' }))
      .toThrow(/fails the v6 structural check/);
  });

  it('migrates a v1 document all the way to v6', () => {
    const v6 = migrateInputsToV6({}, { id: 'p1', price_pence: 42_500_000, floor_area_sqm: 500 });
    expect(v6.inputs_version).toBe(6);
    expect(v6.areas.basis).toBe('manual');
    expect(v6.acquisition.jurisdiction_source).toBe('migrated_default');
  });

  it('merges an already-v6 document onto v6 defaults rather than re-migrating', () => {
    const saved = { ...migrateV5toV6(v5), project_id: 'kept' };
    expect(migrateInputsToV6(saved as never).project_id).toBe('kept');
  });

  // Fix round 2, Important 2. Both engines must agree on these two shapes, or
  // the parity rules this codebase runs on are decorative. Python's twins are
  // test_v6_merge_branch_default_fills_a_unit_missing_its_ancillary_block and
  // test_v5_document_with_no_unit_mix_migrates_to_empty_units.
  it('default-fills ancillary on a saved v6 unit that has none, as Python does', () => {
    const v6 = migrateV5toV6(v5);
    const saved = {
      ...v6,
      unit_mix: { units: [
        { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
      ] },
    } as unknown as Record<string, unknown>;

    const merged = migrateInputsToV6(saved);

    expect(merged.unit_mix.units[0].ancillary).toEqual({
      balcony_terrace_sqm: 0,
      balcony_terrace_value_pence: 0,
      parking_spaces: 0,
      parking_value_pence: 0,
    });
  });

  it('keeps the ancillary values a saved v6 unit already carries', () => {
    const v6 = migrateV5toV6(v5);
    const saved = {
      ...v6,
      unit_mix: { units: [
        {
          id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000,
          comparable_notes: '', ancillary: { balcony_terrace_sqm: 8, parking_spaces: 2 },
        },
      ] },
    } as unknown as Record<string, unknown>;

    const merged = migrateInputsToV6(saved);

    expect(merged.unit_mix.units[0].ancillary).toEqual({
      balcony_terrace_sqm: 8,
      balcony_terrace_value_pence: 0,
      parking_spaces: 2,
      parking_value_pence: 0,
    });
  });

  it('migrates a v5 document with no unit_mix to empty units rather than throwing', () => {
    // migrate_v5_to_v6 reads `doc.get("unit_mix") or {}` and yields [];
    // this used to throw on `unit_mix.units`.
    const noUnitMix = { ...v5, unit_mix: undefined } as unknown as CalculatorInputsV5;
    expect(migrateV5toV6(noUnitMix).unit_mix.units).toEqual([]);
  });

  it('refuses a v6 document through the v5 entry point', () => {
    const v6 = migrateV5toV6(v5) as unknown as Record<string, unknown>;
    expect(() => migrateInputsToV5(v6)).toThrow(/unrecognised inputs_version 6/);
  });
});

describe('migrateV6toV7 (R10 spec §4)', () => {
  it('produces headline mode with no packages and exactly three contingency classes', () => {
    const v6 = migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2()))));
    const v7 = migrateV6toV7(v6);
    expect(v7.inputs_version).toBe(7);
    expect(v7.cost_plan.mode).toBe('headline');
    expect(v7.cost_plan.packages).toEqual([]);
    expect(v7.cost_plan.contingency.map((c) => c.name))
      .toEqual(['general', 'existing_building', 'abnormal']);
  });

  it('carries contingency_pct onto the general class and zeroes the other two', () => {
    const v6 = migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2()))));
    v6.conversion_costs = { ...v6.conversion_costs, contingency_pct: 12.5 };
    const v7 = migrateV6toV7(v6);
    expect(v7.cost_plan.contingency.map((c) => c.pct)).toEqual([12.5, 0, 0]);
  });

  it('converts all eight fee fields to fixed lines with the CORRECT categories', () => {
    // building_control is STATUTORY despite sitting in the professional block of
    // ConversionCostInputs. Classifying it as professional would leave every
    // grand total correct while moving money between two reported lines.
    const v6 = migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2()))));
    v6.conversion_costs = {
      ...v6.conversion_costs,
      architect_pence: 1_500_000, structural_engineer_pence: 500_000, mande_pence: 500_000,
      planning_consultant_pence: 300_000, other_professional_fees_pence: 0,
      building_control_pence: 200_000, cil_s106_pence: 700_000,
      prior_approval_fee_per_dwelling_pence: 9_600,
    };
    const v7 = migrateV6toV7(v6);
    const byCode = Object.fromEntries(v7.cost_plan.fee_lines.map((f) => [f.code, f]));
    expect(v7.cost_plan.fee_lines).toHaveLength(8);
    expect(v7.cost_plan.fee_lines.every((f) => f.basis === 'fixed')).toBe(true);
    expect(byCode.building_control.category).toBe('statutory');
    expect(byCode.cil_s106.category).toBe('statutory');
    expect(byCode.prior_approval.category).toBe('statutory');
    expect(byCode.prior_approval.per_dwelling).toBe(true);
    expect(byCode.architect.category).toBe('professional');
    expect(byCode.architect.amount_pence).toBe(1_500_000);
    expect(byCode.mande.per_dwelling).toBe(false);
  });

  it('refuses a document that is already v7', () => {
    const v7 = migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(
      migrateV2toV3(defaultCalculatorInputsV2())))));
    expect(() => migrateV6toV7(v7 as never)).toThrow(/already a v7 document/);
  });
});

describe('migrateInputsToV7 refusals (R8 carry-forward)', () => {
  it('refuses an unrecognised inputs_version rather than falling through to v1', () => {
    expect(() => migrateInputsToV7({ inputs_version: 99 }))
      .toThrow(/unrecognised inputs_version/);
  });

  it('refuses a document tagged 7 that fails the structural check', () => {
    expect(() => migrateInputsToV7({ inputs_version: 7, finance: 'not an object' }))
      .toThrow(/fails the v7 structural check/);
  });
});

// --- R11 spec §17.11 — v8, the VAT block, and the persistence boundary ------

function someV7Document(): CalculatorInputsV7 {
  return migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(
    migrateV2toV3(defaultCalculatorInputsV2())))));
}

/**
 * A v7 document with a real package schedule and, on its contingency classes,
 * the two fields §17.8 deletes from the INPUT. They are spelled here as extra
 * keys on a v7-typed object because that is exactly how they exist in the wild:
 * every row R10 persisted carries them, and the v8 migration is the only thing
 * that ever removes them.
 */
function detailedV7Document(): CalculatorInputsV7 {
  const v7 = someV7Document();
  return {
    ...v7,
    cost_plan: {
      mode: 'detailed',
      packages: [
        {
          id: 'pkg-structure', code: 'structure', label: 'Structure',
          amount_pence: 20_000_000, contingency_class: 'general',
          lender_eligible: true, notes: '',
          // Deliberately NON-null on both a package and a fee line below. A
          // fixture whose overrides were already null would make "the migration
          // nulls every override" vacuously true — the exact shape of blindness
          // R9 recorded against a gate that could not fail.
          vat_override: { rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' },
          phase_id: null,
        },
        {
          id: 'pkg-envelope', code: 'envelope', label: 'Envelope',
          amount_pence: 10_000_000, contingency_class: 'existing_building',
          lender_eligible: true, notes: '', vat_override: null, phase_id: null,
        },
      ],
      contingency: v7.cost_plan.contingency.map((c) => ({
        ...c,
        basis: 'selected_packages',
        package_ids: ['pkg-structure'],
      })) as typeof v7.cost_plan.contingency,
      fee_lines: v7.cost_plan.fee_lines.map((f, i) => (
        i === 0
          ? { ...f, vat_override: { rate_pct: 20, recoverable_pct: 0, recovery_basis: 'blocked' as const } }
          : f
      )),
    },
  };
}

describe('migrateV7toV8 (R11 spec §17.11)', () => {
  it('writes an inert VAT block, so no existing appraisal moves', () => {
    const v8 = migrateV7toV8(someV7Document());
    expect(v8.inputs_version).toBe(8);
    expect(v8.vat.registered).toBe(false);
    expect(v8.vat.treatments.map((t) => t.category)).toEqual([...VAT_CHARGE_CATEGORIES]);
    expect(v8.vat.treatments.every((t) => t.rate_pct === 0 && t.recoverable_pct === 0)).toBe(true);
    expect(v8.vat.treatments.every(
      (t) => t.recovery_basis === 'unconfirmed' && t.evidence_status === 'unconfirmed',
    )).toBe(true);
    expect(v8.vat.purchase.vendor_opted_to_tax).toBe(false);
    expect(v8.vat.purchase.togc_treatment).toBe('unconfirmed');
  });

  it('nulls every line override and drops the deleted contingency fields', () => {
    const source = detailedV7Document();
    // Non-vacuity: the input really does carry what the migration must remove.
    expect(source.cost_plan.packages[0].vat_override).not.toBeNull();
    expect(source.cost_plan.fee_lines[0].vat_override).not.toBeNull();
    expect('basis' in source.cost_plan.contingency[0]).toBe(true);

    const v8 = migrateV7toV8(source);
    expect(v8.cost_plan.packages).toHaveLength(2);
    expect(v8.cost_plan.packages.every((p) => p.vat_override === null)).toBe(true);
    expect(v8.cost_plan.fee_lines).toHaveLength(8);
    expect(v8.cost_plan.fee_lines.every((f) => f.vat_override === null)).toBe(true);
    expect(v8.cost_plan.contingency).toHaveLength(3);
    for (const c of v8.cost_plan.contingency) {
      expect('basis' in c).toBe(false);
      expect('package_ids' in c).toBe(false);
    }
    // The tags themselves are RETAINED — they are the surviving mechanism.
    expect(v8.cost_plan.packages.map((p) => p.contingency_class))
      .toEqual(['general', 'existing_building']);
    expect(v8.cost_plan.contingency.map((c) => c.name))
      .toEqual(['general', 'existing_building', 'abnormal']);
  });

  it('refuses a document that is already v8', () => {
    const v8 = migrateV7toV8(someV7Document());
    expect(() => migrateV7toV8(v8 as never)).toThrow(/already a v8 document/);
  });

  // Fix round 2, Minor 10. `existingVat` mirrors migrateV6toV7's `existingPlan`:
  // a block already on the document is KEPT rather than overwritten, so a
  // mistagged row does not lose data here. That branch bypasses the inert write
  // the identity gate assumes, so it needs its own test — the corpus-wide gate
  // only ever sees documents that take the other branch.
  it('keeps a VAT block the v7 document already carries, rather than resetting it', () => {
    const source = {
      ...someV7Document(),
      vat: {
        ...defaultVatInputs(),
        registered: true,
        return_frequency: 'monthly' as const,
        treatments: defaultVatTreatments().map(
          (t, i) => (i === 1 ? { ...t, rate_pct: 20 } : t),
        ),
      },
    };

    const v8 = migrateV7toV8(source as never);

    expect(v8.vat.registered).toBe(true);
    expect(v8.vat.return_frequency).toBe('monthly');
    expect(v8.vat.treatments[1].rate_pct).toBe(20);
    // Non-vacuity: this is NOT what the inert default would have produced.
    expect(v8.vat).not.toEqual(defaultVatInputs());
    // And the container gate is unmoved by the stray block — it is still a v7
    // document until inputs_version says otherwise.
    expect(isV8(source as unknown as Record<string, unknown>)).toBe(false);
  });

  it('hands back an independently mutable VAT block, not the shared default', () => {
    const a = migrateV7toV8(someV7Document());
    const b = migrateV7toV8(someV7Document());
    a.vat.registered = true;
    a.vat.purchase.vendor_opted_to_tax = true;
    expect(b.vat.registered).toBe(false);
    expect(b.vat.purchase.vendor_opted_to_tax).toBe(false);
  });
});

describe('migrateInputsToV8 refusals (R8 carry-forward)', () => {
  it('refuses an unrecognised version rather than falling through to the v1 path', () => {
    // Tagged 9, one past the declared tuple. R10 found a predicate loosened
    // from `=== 6` to `!== 5` — the literal negation of the set's own
    // definition, which could never fail.
    //
    // The regex names migrateInputsToV8 DELIBERATELY. A bare
    // /unrecognised inputs_version/ passes for the wrong reason and cannot
    // catch that defect at all: a v8 predicate that never fires falls through
    // to `migrateV7toV8(migrateInputsToV7(...))`, and migrateInputsToV7's OWN
    // predicate then refuses 9 with a message the loose regex still matches.
    // Watched failing with the predicate replaced by an always-false one, which
    // the loose regex did not catch.
    expect(() => migrateInputsToV8({ inputs_version: 9 } as never))
      .toThrow(/migrateInputsToV8: unrecognised inputs_version 9/);
    expect(() => migrateInputsToV8({ inputs_version: 99 } as never))
      .toThrow(/migrateInputsToV8: unrecognised inputs_version 99/);
  });

  it('accepts every version in the declared tuple', () => {
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const doc = { ...someV7Document(), inputs_version: version } as unknown as Record<string, unknown>;
      expect(migrateInputsToV8(doc).inputs_version).toBe(8);
    }
  });

  it('refuses a document tagged v8 that fails the structural check', () => {
    expect(() => migrateInputsToV8({ inputs_version: 8, finance: 'nope' } as never))
      .toThrow(/fails the v8 structural check/);
  });
});

describe('migrateInputsToV8 merge-onto-defaults branch', () => {
  function someV8Snapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(migrateV7toV8(someV7Document()))) as Record<string, unknown>;
  }

  it('deep-merges a saved vat block onto defaults', () => {
    // R10 found a cost_plan deep-merge nobody had deleted to check; without it a
    // stored row computed zero contingency. Same shape, same check.
    const merged = migrateInputsToV8({
      ...someV8Snapshot(), vat: { registered: true },
    } as never);
    expect(merged.vat.registered).toBe(true);
    expect(merged.vat.treatments).toHaveLength(6);
    expect(merged.vat.return_frequency).toBe('quarterly');
    expect(merged.vat.purchase.togc_treatment).toBe('unconfirmed');
  });

  it('carries a saved vat block through untouched', () => {
    const snapshot = someV8Snapshot();
    const saved = {
      ...snapshot,
      vat: {
        ...(snapshot.vat as Record<string, unknown>),
        registered: true,
        return_frequency: 'monthly',
        first_period_end_month: 0,
      },
    };
    const merged = migrateInputsToV8(saved as never);
    expect(merged.vat.registered).toBe(true);
    expect(merged.vat.return_frequency).toBe('monthly');
    expect(merged.vat.first_period_end_month).toBe(0);
  });

  it('still deep-merges cost_plan, as v7 did', () => {
    const snapshot = someV8Snapshot();
    const merged = migrateInputsToV8({ ...snapshot, cost_plan: { mode: 'detailed' } } as never);
    expect(merged.cost_plan.mode).toBe('detailed');
    expect(merged.cost_plan.contingency).toHaveLength(3);
  });
});

// --- R12 spec §18.7 — v9, the precedence-network migration ------------------

/** A v8 document with no programme/sales_phasing/refinance blocks -- the
 *  common case a fresh someV7Document() migrates to. */
function defaultV8Document(): CalculatorInputsV8 {
  return migrateV7toV8(someV7Document());
}

/** A v8 document with a real (detailed) cost plan carrying packages and fee
 *  lines, so the phase_id no-op has non-empty arrays to write onto. */
function defaultV8DocumentWithDetailedCostPlan(): CalculatorInputsV8 {
  return migrateV7toV8(detailedV7Document());
}

/** A v8 document with a real, explicit three-package programme. The three
 *  packages carry DISTINCT start_offset/duration_months/curve values on every
 *  axis so that a migration bug which transposes two packages -- rather than
 *  merely dropping a field -- changes an assertion somewhere in the suite. */
function v8DocumentWithProgramme(): CalculatorInputsV8 {
  return {
    ...defaultV8Document(),
    programme: {
      anchor_month: '2026-03',
      packages: {
        construction: { start_offset: 2, duration_months: 9, curve: { kind: 's_curve' as const } },
        professional: { start_offset: 0, duration_months: 5, curve: { kind: 'straight_line' as const } },
        statutory: { start_offset: 1, duration_months: 4, curve: { kind: 'back_loaded' as const } },
      },
    },
  };
}

describe('migrateV8toV9 — spec §18.7', () => {
  it('leaves a null programme null', () => {
    const v9 = migrateV8toV9({ ...defaultV8Document(), programme: null } as never);
    expect(v9.programme).toBeNull();
    expect(v9.inputs_version).toBe(9);
  });

  it('converts each of the three packages to a predecessor-free phase with an identical window', () => {
    // Table-driven over ALL THREE, matched by id rather than array position:
    // fix round 1, Finding 3. The single-phase (index-0) version of this test
    // passed even with `professional`/`statutory`'s fields transposed --
    // window identity is this task's entire safety claim, so every package
    // needs its own check against ITS OWN source values, not just construction's.
    const source = v8DocumentWithProgramme().programme!.packages;
    const v9 = migrateV8toV9(v8DocumentWithProgramme() as never);
    const net = v9.programme!;

    expect(net.anchor_month).toBe('2026-03');
    expect(net.phases.map((p) => p.id)).toEqual(['construction', 'professional', 'statutory']);
    expect(net.phases.map((p) => p.code)).toEqual(['construction', 'design', 'planning']);
    expect(net.phases.every((p) => p.predecessors.length === 0)).toBe(true);
    expect(net.phases.every((p) => p.slip_months === 0)).toBe(true);

    for (const name of ['construction', 'professional', 'statutory'] as const) {
      const phase = net.phases.find((p) => p.id === name)!;
      const pkg = source[name];
      expect(phase.start_offset).toBe(pkg.start_offset);
      expect(phase.duration_months).toBe(pkg.duration_months);
      expect(phase.curve).toEqual(pkg.curve);
    }
  });

  it('points category_phase_ids at the three migrated phases', () => {
    const v9 = migrateV8toV9(v8DocumentWithProgramme() as never);
    expect(v9.programme!.category_phase_ids).toEqual({
      construction: 'construction', professional: 'professional', statutory: 'statutory',
    });
  });

  it('writes the id equal to the package name — the alias map depends on it', () => {
    // §18.7's one exemption to the validation-identity gate is bounded by this
    // equality. If migration ever renames these ids, Task 8's alias assertion
    // must fail, so this is asserted at the source too.
    const v9 = migrateV8toV9(v8DocumentWithProgramme() as never);
    expect(new Set(v9.programme!.phases.map((p) => p.id)))
      .toEqual(new Set(Object.keys(PACKAGE_TO_PHASE)));
  });

  it('names the missing package rather than throwing an anonymous TypeError', () => {
    // Fix round 1, Finding 5. A hand-edited or malformed stored row is not
    // bound by CalculatorInputsV8's type -- this is the runtime guard for a
    // `programme.packages` object missing one of its three keys.
    const v8 = v8DocumentWithProgramme();
    const packages = v8.programme!.packages as unknown as Record<string, unknown>;
    delete packages.statutory;
    expect(() => migrateV8toV9(v8 as never)).toThrow(/migrateV8toV9.*"statutory"/);
  });

  it('adds anchor: null to every tranche and to refinance', () => {
    const v8 = {
      ...defaultV8Document(),
      sales_phasing: { tranches: [{ month_offset: 10, pct_of_gross_receipts: 100 }] },
      refinance: { month_offset: 11, investment_value_pence: 1, ltv_pct: 60, arrangement_fee_pence: 0, legal_costs_pence: 0 },
    };
    const v9 = migrateV8toV9(v8 as never);
    expect(v9.sales_phasing!.tranches[0].anchor).toBeNull();
    expect(v9.sales_phasing!.tranches[0].month_offset).toBe(10);
    expect(v9.refinance!.anchor).toBeNull();
  });

  // Fix round 1, Finding 1 (CRITICAL). `phase_slip_phase_id`/`phase_slip_months`
  // live on the SHARED, version-agnostic `ScenarioOverrides` type, and Task 4
  // already made conversion-defaults.ts write both at these exact no-op values
  // -- so `defaultV8Document()` already carries them, and a test built from it
  // stays green with `withSlip` deleted from migrateV8toV9 entirely. A stored
  // v8 row written before R12 has NEITHER key. The fixture here is raw JSON
  // with both keys stripped, and their absence is asserted first, so the test
  // can only pass because the migration actually wrote them.
  it('adds the two slip fields, at no-op values, to all four scenarios -- from a snapshot with neither key', () => {
    const raw = JSON.parse(JSON.stringify(defaultV8Document())) as Record<string, unknown>;
    const scenarios = raw.scenarios as Record<string, Record<string, unknown>>;
    for (const k of ['base', 'upside', 'downside', 'severe']) {
      delete scenarios[k].phase_slip_phase_id;
      delete scenarios[k].phase_slip_months;
    }
    // Non-vacuity: the input really does lack what the migration must add.
    for (const k of ['base', 'upside', 'downside', 'severe']) {
      expect('phase_slip_phase_id' in scenarios[k]).toBe(false);
      expect('phase_slip_months' in scenarios[k]).toBe(false);
    }

    const v9 = migrateV8toV9(raw as never);
    for (const k of ['base', 'upside', 'downside', 'severe'] as const) {
      expect(v9.scenarios[k].phase_slip_phase_id).toBeNull();
      expect(v9.scenarios[k].phase_slip_months).toBe(0);
    }
  });

  // Fix round 1, Finding 1 (CRITICAL). `phase_id` lives on the SHARED
  // `CostPackage`/`FeeLine` types, and `costPlanFromLegacyCosts` (cost-plan.ts)
  // already writes `phase_id: null` on every fee line it builds -- so
  // `defaultV8DocumentWithDetailedCostPlan()`'s fee lines already carry it, and
  // a test built from it stays green with both `.map` clauses deleted from
  // migrateV8toV9. Same fix as above: raw JSON, keys stripped, absence
  // asserted first.
  it('writes phase_id: null on every package and fee line -- from a snapshot with neither key', () => {
    const raw = JSON.parse(JSON.stringify(defaultV8DocumentWithDetailedCostPlan())) as Record<string, unknown>;
    const costPlan = raw.cost_plan as {
      packages: Array<Record<string, unknown>>; fee_lines: Array<Record<string, unknown>>;
    };
    for (const p of costPlan.packages) delete p.phase_id;
    for (const f of costPlan.fee_lines) delete f.phase_id;
    // Non-vacuity: there are real rows here, and none of them carry the key.
    expect(costPlan.packages.length).toBeGreaterThan(0);
    expect(costPlan.fee_lines.length).toBeGreaterThan(0);
    expect(costPlan.packages.every((p) => !('phase_id' in p))).toBe(true);
    expect(costPlan.fee_lines.every((f) => !('phase_id' in f))).toBe(true);

    const v9 = migrateV8toV9(raw as never);
    expect(v9.cost_plan.packages.length).toBeGreaterThan(0);
    expect(v9.cost_plan.fee_lines.length).toBeGreaterThan(0);
    expect(v9.cost_plan.packages.every((p) => p.phase_id === null)).toBe(true);
    expect(v9.cost_plan.fee_lines.every((f) => f.phase_id === null)).toBe(true);
  });

  it('refuses to double-migrate', () => {
    const v9 = migrateV8toV9(defaultV8Document() as never);
    expect(() => migrateV8toV9(v9 as never)).toThrow(/already a v9 document/);
  });
});

// Fix round 1, Finding 2. Neither describe below existed in the brief; every
// other version (migrate.test.ts:307, 373, 504, 671 and the
// migrateInputsToV8 merge-onto-defaults describe) has both a refusal test and
// a merge-branch test, and copying the brief without noticing the gap was the
// mistake -- flagged here rather than repeated again.
describe('migrateInputsToV9 refusals (R8 carry-forward)', () => {
  it('refuses an unrecognised version — tested with 10, the neighbour', () => {
    // R10 found a version predicate loosened from `=== 6` to `!== 5`, the literal
    // negation of the set's own definition, which could never fail. Testing the
    // NEIGHBOUR is what catches that shape.
    //
    // The regex names migrateInputsToV9 DELIBERATELY, mirroring
    // migrateInputsToV8's refusal test above: a v9 predicate that never fires
    // falls through to migrateV8toV9(migrateInputsToV8(...)), and
    // migrateInputsToV8's OWN predicate then refuses 10 with a message a loose
    // /unrecognised inputs_version/ regex would still match for the wrong reason.
    expect(() => migrateInputsToV9({ inputs_version: 10 } as never))
      .toThrow(/migrateInputsToV9: unrecognised inputs_version 10/);
  });

  it('refuses a document tagged v9 that fails the structural check', () => {
    expect(() => migrateInputsToV9({ inputs_version: 9, finance: 'nope' } as never))
      .toThrow(/fails the v9 structural check/);
  });
});

describe('migrateInputsToV9 merge-onto-defaults branch', () => {
  function someV9SnapshotWithProgramme(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(migrateV8toV9(v8DocumentWithProgramme()))) as Record<string, unknown>;
  }

  // Fix round 1, Finding 2. Guards migrateInputsToV9's
  // `programme: saved.programme ?? null` line specifically -- delete it and a
  // stored network comes back as the default document's null, and every phase
  // is silently lost. Same shape as R10's cost_plan-merge defect and R11's vat
  // one; this is the v9 instance of that recurring class.
  it('carries a saved, populated programme network through the merge branch, not the default null', () => {
    const snapshot = someV9SnapshotWithProgramme();
    // Non-vacuity: the stored snapshot really does carry a live network.
    expect((snapshot.programme as { phases: unknown[] }).phases).toHaveLength(3);

    const merged = migrateInputsToV9(snapshot as never);
    expect(merged.programme).not.toBeNull();
    expect(merged.programme!.phases.map((p) => p.id)).toEqual(['construction', 'professional', 'statutory']);
    expect(merged.programme!.phases.map((p) => p.start_offset)).toEqual([2, 0, 1]);
    expect(merged.programme!.phases.map((p) => p.duration_months)).toEqual([9, 5, 4]);
  });
});

// --- Release 13 (calc 2.11.0 -> 2.12.0): v9 -> v10, spec §19.9 ------------
//
// TS twin of tests/test_migrate_v10.py. Reads the fixture corpus with
// readdirSync exactly as golden-fixtures.test.ts already does — see that
// file's `FIXTURE_DIR`/`fixtureFiles`/`versionOf`.
//
// Same three corrections as the Python file's docstring records against the
// brief's Step 1 text (see tests/test_migrate_v10.py for the full reasoning):
// each fixture's `inputs_version` lives under `fx.inputs`, not at the top
// level of the fixture file; every migration call needs `fx.inputs`, not the
// fixture wrapper; and the numeric-identity gate is `runAppraisal(...)` +
// `toEqual`, not a `deriveMetrics(...)` call with the wrong arity.
describe('v10 migration -- spec §19.9', () => {
  const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

  interface FixtureFile {
    name: string;
    kind: string;
    inputs?: Record<string, unknown>;
  }

  const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
  const fixtureDocs: Array<{ file: string; doc: FixtureFile }> = fixtureFiles.map((file) => ({
    file,
    doc: JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as FixtureFile,
  }));

  // Fixture K (kind 'sensitivity') carries no `inputs` of its own — it names a
  // `base_fixture` instead — so it is excluded here the same way
  // golden-fixtures.test.ts's `appraisalFixtures` already excludes it.
  //
  // migrateInputsToV9 refuses a v10 document by design, so the two v10-NATIVE
  // fixtures Task 5b authors are excluded here too (via the version filter)
  // and are covered by the golden-fixture suite instead. Both exclusions are
  // derived from each fixture's own content, never hard-coded to filenames.
  const versionOf = (doc: FixtureFile): number =>
    (doc.inputs as { inputs_version?: number } | undefined)?.inputs_version ?? 2;

  const fixtures = fixtureDocs.filter(
    ({ doc }) => doc.kind !== 'sensitivity' && versionOf(doc) <= 9,
  );

  it('the migration corpus is not empty and did not silently shrink', () => {
    // Pinned figure does not reconcile with the brief's 15 -- see
    // tests/test_migrate_v10.py's matching guard for the full reasoning. The
    // corpus holds 15 files; one (fixture K) is not an inputs document, so 14
    // is the correct bound for this task.
    expect(fixtures.length).toBeGreaterThanOrEqual(14);
    // Task 5b: the v10-native exclusion is now real -- t-investment-case.json
    // and u-investment-case-ltv-binds.json are both `inputs_version: 10`, so
    // the `<= 9` arm of `fixtures`'s filter excludes them.
    //
    // Pinned figure does not reconcile, flagged rather than silently matched:
    // Task 5b's own brief asks for `fixtureDocs.length - fixtures.length ===
    // 2`. That does not hold -- `fixtureDocs` also contains fixture K, which
    // is excluded from `fixtures` for an UNRELATED reason (`kind ===
    // 'sensitivity'`, no `inputs` document at all), so the difference is 3
    // today (K, plus the two v10-native fixtures), not 2. This isolates the
    // v10-native exclusion specifically, matching test_migrate_v10.py's
    // Python twin.
    //
    // R14 Task 2: v-exhausted-reserve.json is also stored at inputs v10 (spec
    // Sec 4's hand-derived fixture; v11 does not exist until this release's
    // later migration task), so the `<= 9` arm excludes it too and the
    // exclusion bound moves from two v10-native fixtures to three.
    //
    // R14 Task 8: w-monitoring-on-site.json is stored at inputs v11 (spec
    // §20.2's hand-derived golden case). This filter is `<= 9`, so it excludes
    // every version ABOVE 9, v11 included, and the bound moves from three to
    // four. `fixtures.length` is unchanged -- W was never inside this gate.
    const versionExcluded = fixtureDocs.filter(
      ({ doc }) => doc.kind !== 'sensitivity' && versionOf(doc) > 9,
    );
    expect(versionExcluded.length).toBe(4);
    expect(versionExcluded.map(({ file }) => file).sort()).toEqual([
      't-investment-case.json', 'u-investment-case-ltv-binds.json',
      'v-exhausted-reserve.json', 'w-monitoring-on-site.json',
    ]);
  });

  for (const { file, doc } of fixtures) {
    it(`${file}: no computed figure moves from v9 to v10`, () => {
      const inputs = doc.inputs!;
      const v9Run = runAppraisal(migrateInputsToV9(inputs));
      const v10Run = runAppraisal(migrateInputsToV10(inputs));
      expect(v10Run.metrics, `${file}: metrics moved`).toEqual(v9Run.metrics);
      expect(v10Run.model, `${file}: a ledger figure moved`).toEqual(v9Run.model);
      expect(v10Run.schedule, `${file}: a schedule figure moved`).toEqual(v9Run.schedule);
    });
  }

  // Property 1 of three. Field strings may be renamed under a stated alias
  // map; the SET of issues raised must not grow or shrink. No field renames
  // this release; kept so a future rename has a declared home rather than a
  // loosened assertion.
  const ALIAS: Record<string, string> = {};

  for (const { file, doc } of fixtures) {
    it(`${file}: every v9 validation issue has a v10 counterpart (property 1)`, () => {
      const inputs = doc.inputs!;
      const v9Issues = new Set(
        validateInputs(migrateInputsToV9(inputs))
          .map((i) => JSON.stringify([i.severity, ALIAS[i.field] ?? i.field, i.message])),
      );
      const v10Issues = new Set(
        validateInputs(migrateInputsToV10(inputs))
          .map((i) => JSON.stringify([i.severity, i.field, i.message])),
      );
      expect(v10Issues).toEqual(v9Issues);
    });
  }

  // Property 2 and Property 3, adopted by Task 7 (R13 spec §19.9). Task 5
  // built the gate but could implement only Property 1 — Properties 2 and 3
  // need a v10-only validation rule that actually fires, and no such rule
  // existed until Task 6 wrote §19.7 here. They are a matched pair by design:
  // Property 3 is the one that stops Property 2 being vacuous. Writing
  // Property 2 alone would reproduce exactly the defect shape R12 shipped and
  // had to rewrite mid-release.
  for (const { file, doc } of fixtures) {
    it(`${file}: every v10-only rule stays silent on a migrated document (property 2 of three)`, () => {
      const inputs = doc.inputs!;
      const issues = validateInputs(migrateInputsToV10(inputs));
      expect(issues.filter((i) => i.field.startsWith('investment_case'))).toEqual([]);
    });
  }

  it('the v10-only rules can actually fire (property 3 of three)', () => {
    // Property 3 of three, and the one that stops Property 2 being vacuous.
    // Without this, a release that wired the new rules to nothing would pass
    // Property 2 perfectly. R12 shipped exactly that shape and had to
    // rewrite the gate mid-release.
    //
    // Watched red first: with §19.7 rule 8's stabilised_occupancy_pct check
    // commented out in validation.ts, this test fails (see Task 7's report
    // for the exact failure captured before the rule was restored).
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'l-retain-all.json'), 'utf-8'),
    ) as FixtureFile;
    const v10 = migrateInputsToV10(raw.inputs!);
    const poisoned: CalculatorInputsV10 = {
      ...v10,
      investment_case: {
        stabilisation: {
          anchor: null, month_offset: 3, ramp_months: 3, stabilised_occupancy_pct: 0, // <- rule 8 violation
        },
        operating_lines: [],
        valuation: { cap_yield_pct: 5.5, purchasers_costs_pct: 6.75 },
        takeout: {
          ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3,
          annual_rate_pct: 6, amortisation_years: 25, term_years: 5,
        },
      },
    };
    const issues = validateInputs(poisoned);
    expect(issues.some((i) => i.field === 'investment_case.stabilisation.stabilised_occupancy_pct')).toBe(true);
  });

  it('migration writes only nulls and zeroes (spec §19.9)', () => {
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
    ) as FixtureFile;
    const v10 = migrateInputsToV10(raw.inputs!);
    expect(v10.investment_case).toBeNull();
    expect(v10.refinance).not.toBeNull();
    expect(v10.refinance!.arrangement_fee_basis).toBe('fixed_pence');
    expect(v10.refinance!.arrangement_fee_pct).toBe(0);
    // The explicit pair survives untouched -- this is the path that stays live.
    expect(v10.refinance!.investment_value_pence).not.toBeNull();
    expect(v10.refinance!.ltv_pct).not.toBeNull();
    // §19.8: the three new levers, written zero on all four named scenarios —
    // the numeric identity gate above (`no computed figure moves from v9 to
    // v10`) is what proves these three written zeroes are inert.
    (['base', 'upside', 'downside', 'severe'] as const).forEach((name) => {
      expect(v10.scenarios[name].exit_yield_adjustment_pct).toBe(0);
      expect(v10.scenarios[name].operating_cost_adjustment_pct).toBe(0);
      expect(v10.scenarios[name].vacancy_adjustment_pct).toBe(0);
    });
  });

  it('actively overwrites a stray non-zero scenario lever rather than relying on it already being zero (spec §19.8)', () => {
    // Non-vacuity for the test above. Every scenario reaching migrateV9toV10 by
    // the normal migrateInputsToV9 chain already carries these three fields at
    // 0 (DEFAULT_SCENARIOS backfills them, and ScenarioOverrides has no field
    // default of its own in TS — unlike the Python model, so this is not the
    // identical trap, but the effect is the same: the test above would pass
    // even with migrateV9toV10's `scenarios:` write deleted entirely, because
    // its input already happens to be zero). Poisoning `base`'s three new
    // fields with a nonzero value straight on the v9 document, THEN migrating,
    // is what proves migrateV9toV10 actively resets them rather than merely
    // passing an already-zero value through.
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
    ) as FixtureFile;
    const v9 = migrateInputsToV9(raw.inputs!);
    const poisoned: CalculatorInputsV9 = {
      ...v9,
      scenarios: {
        ...v9.scenarios,
        base: {
          ...v9.scenarios.base,
          exit_yield_adjustment_pct: 99, operating_cost_adjustment_pct: 99, vacancy_adjustment_pct: 99,
        },
      },
    };
    const v10 = migrateV9toV10(poisoned);
    expect(v10.scenarios.base.exit_yield_adjustment_pct).toBe(0);
    expect(v10.scenarios.base.operating_cost_adjustment_pct).toBe(0);
    expect(v10.scenarios.base.vacancy_adjustment_pct).toBe(0);
  });

  // No TS twin of Python's test_is_v2_or_later_recognises_v10: `is_v2_or_later`
  // is a Python-only server-persistence-boundary concept (app.py's `was_v1`
  // guard). There is no TypeScript function of that name or shape to mirror —
  // confirmed by grep across frontend/src before writing this comment.
});

describe('migrateInputsToV10 refusals', () => {
  it('refuses an unrecognised version — tested with 11, the neighbour', () => {
    // R10 found a version predicate loosened from `=== 6` to `!== 5`, the literal
    // negation of the set's own definition, which could never fail. Testing the
    // NEIGHBOUR is what catches that shape.
    expect(() => migrateInputsToV10({ inputs_version: 11 } as never))
      .toThrow(/migrateInputsToV10: unrecognised inputs_version 11/);
  });

  it('refuses a document tagged v10 that fails the structural check', () => {
    expect(() => migrateInputsToV10({ inputs_version: 10 } as never))
      .toThrow(/fails the v10 structural check/);
  });
});

describe('migrateInputsToV10 merge-onto-defaults branch', () => {
  it('carries a saved, non-null investment_case through the merge branch, not the default null', () => {
    const v10 = migrateV9toV10(migrateV8toV9(defaultV8Document()));
    const snapshot = {
      ...JSON.parse(JSON.stringify(v10)),
      investment_case: {
        stabilisation: {
          anchor: null, month_offset: 3, ramp_months: 3, stabilised_occupancy_pct: 92,
        },
        operating_lines: [],
        valuation: { cap_yield_pct: 5.5, purchasers_costs_pct: 6.75 },
        takeout: {
          ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3,
          annual_rate_pct: 6, amortisation_years: 25, term_years: 5,
        },
      },
    };
    const merged = migrateInputsToV10(snapshot);
    expect(merged.investment_case).not.toBeNull();
    expect(merged.investment_case!.stabilisation.stabilised_occupancy_pct).toBe(92);
  });

  it('carries a saved, live refinance block through the merge branch with its own v10 fields, not defaults', () => {
    const v10 = migrateV9toV10(migrateV8toV9(defaultV8Document()));
    const snapshot = {
      ...JSON.parse(JSON.stringify(v10)),
      refinance: {
        month_offset: 6, investment_value_pence: 5_000_000, ltv_pct: 60,
        arrangement_fee_pence: 10_000, legal_costs_pence: 2_000, anchor: null,
        arrangement_fee_basis: 'pct_of_quantum', arrangement_fee_pct: 1.5,
      },
    };
    const merged = migrateInputsToV10(snapshot);
    expect(merged.refinance).not.toBeNull();
    expect(merged.refinance!.arrangement_fee_basis).toBe('pct_of_quantum');
    expect(merged.refinance!.arrangement_fee_pct).toBe(1.5);
  });
});

// --- Release 14 (calc 2.12.0 -> 2.13.0): v10 -> v11, spec §20.1 -----------
//
// TS twin of tests/test_migrate_v11.py. Reads the fixture corpus with
// readdirSync exactly as the v10 describe block above does — see that
// block's `FIXTURE_DIR`/`fixtureFiles`/`versionOf`.
describe('v11 migration -- spec §20.1', () => {
  const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

  interface FixtureFile {
    name: string;
    kind: string;
    inputs?: Record<string, unknown>;
  }

  const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
  const fixtureDocs: Array<{ file: string; doc: FixtureFile }> = fixtureFiles.map((file) => ({
    file,
    doc: JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as FixtureFile,
  }));

  // Fixture K (kind 'sensitivity') carries no `inputs` of its own — excluded
  // the same way golden-fixtures.test.ts's `appraisalFixtures` already
  // excludes it. `migrateInputsToV10` refuses a v11 document by design, so
  // any v11-NATIVE fixture would be excluded here too (via the version
  // filter) — none exists yet; Task 8 authors the first one.
  const versionOf = (doc: FixtureFile): number =>
    (doc.inputs as { inputs_version?: number } | undefined)?.inputs_version ?? 2;

  const fixtures = fixtureDocs.filter(
    ({ doc }) => doc.kind !== 'sensitivity' && versionOf(doc) <= 10,
  );

  it('the migration corpus is not empty and did not silently shrink', () => {
    // The corpus holds 19 files now; one (fixture K) is not an inputs document
    // and one (fixture W) is v11-native, leaving 17 in `fixtures` (the `<= 10`
    // filter includes v-exhausted-reserve.json, stored at v10, unlike the
    // `<= 9` filter one migration back).
    expect(fixtures.length).toBeGreaterThanOrEqual(17);
    // R14 Task 8: the v11-native exclusion is now real -- w-monitoring-on-site
    // .json is `inputs_version: 11`, so the `<= 10` arm of `fixtures`'s filter
    // excludes it and it is covered by the golden suite instead. Mirrors how
    // the v10 block above records its own T/U/V/W exclusion bound growing.
    const versionExcluded = fixtureDocs.filter(
      ({ doc }) => doc.kind !== 'sensitivity' && versionOf(doc) > 10,
    );
    expect(versionExcluded.length).toBe(1);
    expect(versionExcluded.map(({ file }) => file).sort()).toEqual([
      'w-monitoring-on-site.json',
    ]);
  });

  // `calc_version` is constant for the whole engine run, not version-
  // dependent, and `monitoring_statement` does not exist on `AppraisalMetrics`
  // until Task 9 — excluding a key that is not there yet is a no-op today and
  // keeps this gate correct without a rewrite once Task 9 lands it. Cast to a
  // plain record first so destructuring a not-yet-existing key does not fail
  // the TS build.
  const metricsSansExcluded = (metrics: object): Record<string, unknown> => {
    const { calc_version: _cv, monitoring_statement: _ms, ...rest } =
      metrics as unknown as Record<string, unknown>;
    return rest;
  };

  for (const { file, doc } of fixtures) {
    it(`${file}: no computed figure moves from v10 to v11`, () => {
      const inputs = doc.inputs!;
      const v10Run = runAppraisal(migrateInputsToV10(inputs));
      const v11Run = runAppraisal(migrateInputsToV11(inputs));
      expect(metricsSansExcluded(v11Run.metrics), `${file}: metrics moved`)
        .toEqual(metricsSansExcluded(v10Run.metrics));
      expect(v11Run.model, `${file}: a ledger figure moved`).toEqual(v10Run.model);
      expect(v11Run.schedule, `${file}: a schedule figure moved`).toEqual(v10Run.schedule);
    });
  }

  // Property 1 of three. Field strings may be renamed under a stated alias
  // map; the SET of issues raised must not grow or shrink. No field renames
  // this release; kept so a future rename has a declared home rather than a
  // loosened assertion.
  const ALIAS: Record<string, string> = {};

  for (const { file, doc } of fixtures) {
    it(`${file}: every v10 validation issue has a v11 counterpart (property 1)`, () => {
      const inputs = doc.inputs!;
      const v10Issues = new Set(
        validateInputs(migrateInputsToV10(inputs))
          .map((i) => JSON.stringify([i.severity, ALIAS[i.field] ?? i.field, i.message])),
      );
      const v11Issues = new Set(
        validateInputs(migrateInputsToV11(inputs))
          .map((i) => JSON.stringify([i.severity, i.field, i.message])),
      );
      expect(v11Issues).toEqual(v10Issues);
    });
  }

  // Property 2 and Property 3, the matched pair that stops Property 2 being
  // vacuous — R12's Sec 18.7 lesson, applied from the start again this
  // release (see the v10 block above's own comment).
  for (const { file, doc } of fixtures) {
    it(`${file}: every v11-only rule stays silent on a migrated document (property 2 of three)`, () => {
      const inputs = doc.inputs!;
      const issues = validateInputs(migrateInputsToV11(inputs));
      expect(issues.filter((i) => i.field.startsWith('monitoring'))).toEqual([]);
    });
  }

  it('the v11-only rules can actually fire (property 3 of three)', () => {
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'l-retain-all.json'), 'utf-8'),
    ) as FixtureFile;
    const v11 = migrateInputsToV11(raw.inputs!);
    const category = (c: MonitoringCategory): MonitoringLineInputs => ({
      category: c,
      current_budget_pence: 0,
      certified_to_date_pence: 0,
      paid_to_date_pence: 0,
      committed_to_date_pence: 0,
      forecast_to_complete_pence: 0,
    });
    const poisoned: CalculatorInputsV11 = {
      ...v11,
      monitoring: {
        reporting_month: 999, // <- exceeds l-retain-all's 12-month term
        reporting_date: '2026-01-01',
        lines: [
          category('acquisition'), category('construction'), category('professional'),
          category('statutory'), category('contingency'),
        ],
        debt_drawn_to_date_pence: 0,
        cash_equity_injected_to_date_pence: 0,
        author: 'QS',
        date: '2026-01-01',
        note: null,
      },
    };
    const issues = validateInputs(poisoned);
    expect(issues.some((i) => i.field === 'monitoring.reporting_month')).toBe(true);
  });

  it('migration writes only null (spec §20.1)', () => {
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
    ) as FixtureFile;
    const v11 = migrateInputsToV11(raw.inputs!);
    expect(v11.monitoring).toBeNull();
  });

  it('actively overwrites a stray monitoring block rather than relying on it already being null', () => {
    // Non-vacuity for the test above: `migrateV10toV11` is what resets a
    // poisoned `monitoring` value to null, not a coincidence of the input
    // already carrying null.
    const raw = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
    ) as FixtureFile;
    const v10 = migrateInputsToV10(raw.inputs!);
    const poisoned = { ...v10, monitoring: { poison: true } } as unknown as CalculatorInputsV10;
    const v11 = migrateV10toV11(poisoned);
    expect(v11.monitoring).toBeNull();
  });

  // No TS twin of Python's test_is_v2_or_later_recognises_v11: `is_v2_or_later`
  // is a Python-only server-persistence-boundary concept (app.py's `was_v1`
  // guard). There is no TypeScript function of that name or shape to mirror.
});

describe('migrateInputsToV11 refusals', () => {
  it('refuses an unrecognised version — tested with 12, the neighbour', () => {
    expect(() => migrateInputsToV11({ inputs_version: 12 } as never))
      .toThrow(/migrateInputsToV11: unrecognised inputs_version 12/);
  });

  it('refuses a document tagged v11 that fails the structural check', () => {
    expect(() => migrateInputsToV11({ inputs_version: 11 } as never))
      .toThrow(/fails the v11 structural check/);
  });
});

describe('migrateInputsToV11 merge-onto-defaults branch', () => {
  it('carries a saved, non-null monitoring block through the merge branch, not the default null', () => {
    const v11 = migrateV10toV11(migrateV9toV10(migrateV8toV9(defaultV8Document())));
    const snapshot = {
      ...JSON.parse(JSON.stringify(v11)),
      monitoring: {
        reporting_month: 3,
        reporting_date: '2026-01-01',
        lines: (['acquisition', 'construction', 'professional', 'statutory', 'contingency'] as const).map(
          (c) => ({
            category: c, current_budget_pence: 0, certified_to_date_pence: 0,
            paid_to_date_pence: 0, committed_to_date_pence: 0, forecast_to_complete_pence: 0,
          }),
        ),
        debt_drawn_to_date_pence: 0, cash_equity_injected_to_date_pence: 0,
        author: 'QS', date: '2026-01-01', note: null,
      },
    };
    const merged = migrateInputsToV11(snapshot);
    expect(merged.monitoring).not.toBeNull();
    expect(merged.monitoring!.reporting_month).toBe(3);
  });
});

describe('v12 migration -- spec §22.9', () => {
  const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

  interface FixtureFile {
    name: string;
    kind: string;
    inputs?: Record<string, unknown>;
  }

  const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
  const fixtureDocs: Array<{ file: string; doc: FixtureFile }> = fixtureFiles.map((file) => ({
    file,
    doc: JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as FixtureFile,
  }));

  // Fixture K (kind 'sensitivity') carries no `inputs` of its own — excluded
  // the same way golden-fixtures.test.ts's `appraisalFixtures` already
  // excludes it. `migrateInputsToV11` refuses a v12 document by design, so
  // any v12-NATIVE fixture would be excluded here too (via the version
  // filter) — none exists yet; Task 2 authors the first one (fixture X).
  const versionOf = (doc: FixtureFile): number =>
    (doc.inputs as { inputs_version?: number } | undefined)?.inputs_version ?? 2;

  const fixtures = fixtureDocs.filter(
    ({ doc }) => doc.kind !== 'sensitivity' && versionOf(doc) <= 11,
  );

  it('the migration corpus is not empty and did not silently shrink', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(18);
    // Task 2 adds the v12-native fixture X and changes this to
    // ['x-unit-sales-ledger.json']; until then no document is v12-native.
    const versionExcluded = fixtureDocs.filter(
      ({ doc }) => doc.kind !== 'sensitivity' && versionOf(doc) > 11,
    );
    expect(versionExcluded.map(({ file }) => file).sort()).toEqual([]);
  });

  // `calc_version` is constant for the whole engine run, not version-
  // dependent, and `monitoring_statement` is `null` on every document this
  // gate runs over regardless of arm.
  const metricsSansExcluded = (metrics: object): Record<string, unknown> => {
    const { calc_version: _cv, monitoring_statement: _ms, ...rest } =
      metrics as unknown as Record<string, unknown>;
    return rest;
  };

  for (const { file, doc } of fixtures) {
    it(`${file}: no computed figure moves from v11 to v12`, () => {
      const inputs = doc.inputs!;
      const v11Run = runAppraisal(migrateInputsToV11(inputs));
      const v12Run = runAppraisal(migrateInputsToV12(inputs));
      expect(metricsSansExcluded(v12Run.metrics), `${file}: metrics moved`)
        .toEqual(metricsSansExcluded(v11Run.metrics));
      expect(v12Run.model, `${file}: a ledger figure moved`).toEqual(v11Run.model);
      expect(v12Run.schedule, `${file}: a schedule figure moved`).toEqual(v11Run.schedule);
    });
  }

  it('writes unit_sales: null and sales_slip_months: 0 on all four scenarios, nothing else', () => {
    const v11 = migrateInputsToV11(fixtureDocs.find(({ file }) => file === 'j-blended-refinance.json')!.doc.inputs as Record<string, unknown>);
    const v12 = migrateV11toV12(v11);
    expect(v12.inputs_version).toBe(12);
    expect(v12.unit_sales).toBeNull();
    for (const k of ['base', 'upside', 'downside', 'severe'] as const) {
      expect(v12.scenarios[k].sales_slip_months).toBe(0);
    }
    const { inputs_version: _a, unit_sales: _b, scenarios: _c, ...restV12 } = v12;
    const { inputs_version: _d, scenarios: _e, ...restV11 } = v11;
    expect(restV12).toEqual(restV11);
  });

  it('refuses double migration and unrecognised versions', () => {
    expect(() => migrateInputsToV12({ inputs_version: 13 })).toThrow(/unrecognised inputs_version 13/);
    expect(() => migrateInputsToV12({ inputs_version: 12 })).toThrow(/fails the v12 structural check/);
  });
});

describe('migrateInputsToV12 merge-onto-defaults branch', () => {
  it('carries a saved, non-null unit_sales block through the merge branch, not the default null', () => {
    const v12 = migrateV11toV12(migrateV10toV11(migrateV9toV10(migrateV8toV9(defaultV8Document()))));
    const snapshot = {
      ...JSON.parse(JSON.stringify(v12)),
      unit_sales: {
        deposit_release: 'released_on_exchange',
        units: [{
          unit_id: 'u1', exchange: { month_offset: 3, anchor: null },
          completion: { month_offset: 6, anchor: null },
          deposit_pct: 10, agent_fee_pct: null, legal_fee_pence: null,
        }],
      },
    };
    const merged = migrateInputsToV12(snapshot);
    expect(merged.unit_sales).not.toBeNull();
    expect(merged.unit_sales!.units[0].completion.month_offset).toBe(6);
  });
});
