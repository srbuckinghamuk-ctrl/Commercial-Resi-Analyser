import { describe, it, expect } from 'vitest';
import {
  migrateInputs, migrateV2toV3, migrateInputsToV3, isV3,
  migrateV3toV4, migrateInputsToV4,
  migrateV4toV5, migrateInputsToV5,
  migrateV5toV6, migrateInputsToV6,
  migrateV6toV7, migrateInputsToV7,
  migrateV7toV8, migrateInputsToV8, isV8,
} from './migrate';
import type {
  CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV5,
  CalculatorInputsV7,
} from './finance-types';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { VAT_CHARGE_CATEGORIES, defaultVatInputs, defaultVatTreatments } from './vat';

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
        },
        {
          id: 'pkg-envelope', code: 'envelope', label: 'Envelope',
          amount_pence: 10_000_000, contingency_class: 'existing_building',
          lender_eligible: true, notes: '', vat_override: null,
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
