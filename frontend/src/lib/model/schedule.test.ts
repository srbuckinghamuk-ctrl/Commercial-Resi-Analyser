import { describe, it, expect } from 'vitest';
import { buildSchedule, spreadStraightLine } from './schedule';
import { defaultCalculatorInputsV2, defaultCalculatorInputsV7 } from '../conversion-defaults';
import type { CalculatorInputsV2, CalculatorInputsV6, CalculatorInputsV7 } from './finance-types';
import { migrateInputsToV3, migrateInputsToV4, migrateInputsToV6, migrateV3toV4 } from './migrate';
import type { ProposedUnitV6 } from '../conversion-types';
import { costPlanFromLegacyCosts } from './cost-plan';

function baseInputs(): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.acquisition = {
    purchase_price_pence: 40_000_000, legal_fees_pence: 500_000, survey_cost_pence: 300_000,
    broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  };
  inputs.unit_mix = {
    units: [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    })),
  };
  inputs.conversion_costs = {
    ...inputs.conversion_costs,
    construction_cost_per_sqm_pence: 100_000, total_construction_sqm: 400, contingency_pct: 10,
    fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    prior_approval_fee_per_dwelling_pence: 9_600, cil_s106_pence: 0,
    architect_pence: 1_500_000, structural_engineer_pence: 500_000, mande_pence: 500_000,
    planning_consultant_pence: 300_000, building_control_pence: 200_000, other_professional_fees_pence: 0,
  };
  inputs.finance.term_months = 12;
  inputs.exit_strategy = {
    route: 'sell_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 400_000, retained_units: [],
  };
  return inputs;
}

describe('spreadStraightLine', () => {
  it('sums exactly to the total (final month absorbs residue)', () => {
    const spread = spreadStraightLine(10_000_001, 3);
    expect(spread).toHaveLength(3);
    expect(spread.reduce((a, b) => a + b, 0)).toBe(10_000_001);
    expect(spread[0]).toBe(3_333_334); // round(10,000,001/3) half-up
    expect(spread[2]).toBe(10_000_001 - 2 * 3_333_334);
  });
});

describe('buildSchedule', () => {
  it('places acquisition, prior approval and ancillary totals in month 0', () => {
    const s = buildSchedule(baseInputs());
    // acquisition = 40,000,000 + SDLT 950,000 + 500,000 + 300,000 + broker 400,000 = 42,150,000
    expect(s.uses[0].acquisition_pence).toBe(42_150_000);
    expect(s.uses[0].statutory_pence).toBe(4 * 9_600); // prior approval month 0
  });

  it('spreads construction over months 1..term-2 and sums exactly', () => {
    const s = buildSchedule(baseInputs());
    const constructionByMonth = s.uses.map((u) => u.construction_pence);
    expect(constructionByMonth[0]).toBe(0);
    expect(constructionByMonth[11]).toBe(0);
    // 400 sqm × 100,000 = 40,000,000 base + 10% = 44,000,000 over months 1..10
    expect(constructionByMonth.reduce((a, b) => a + b, 0)).toBe(44_000_000);
    expect(constructionByMonth[1]).toBe(4_400_000);
  });

  it('books all sale receipts net-of-fee data in the final month for sell_all', () => {
    const s = buildSchedule(baseInputs());
    expect(s.receipts[11].gross_sale_pence).toBe(120_000_000);
    expect(s.receipts[11].agent_fee_pence).toBe(1_800_000);
    expect(s.receipts[11].selling_legal_pence).toBe(400_000);
    expect(s.totals.selling_costs_pence).toBe(2_200_000);
  });

  it('books zero receipts and zero selling costs for retain_all', () => {
    const inputs = baseInputs();
    inputs.exit_strategy.route = 'retain_all';
    const s = buildSchedule(inputs);
    expect(s.receipts.every((r) => r.gross_sale_pence === 0)).toBe(true);
    expect(s.totals.selling_costs_pence).toBe(0);
    expect(s.totals.retained_value_pence).toBe(120_000_000);
    expect(s.totals.gdv_pence).toBe(120_000_000);
  });

  it('splits blended: sold units get receipts, retained units do not', () => {
    const inputs = baseInputs();
    inputs.exit_strategy.route = 'blended';
    inputs.exit_strategy.retained_units = [{ unit_id: 'u1', monthly_rent_pence: 100_000 }];
    const s = buildSchedule(inputs);
    expect(s.receipts[11].gross_sale_pence).toBe(90_000_000);
    expect(s.totals.retained_value_pence).toBe(30_000_000);
    // agent fee on sold only: 1.5% × 90,000,000
    expect(s.receipts[11].agent_fee_pence).toBe(1_350_000);
  });

  it('handles term_months = 1 with everything in month 0', () => {
    const inputs = baseInputs();
    inputs.finance.term_months = 1;
    const s = buildSchedule(inputs);
    expect(s.uses).toHaveLength(1);
    expect(s.receipts[0].gross_sale_pence).toBe(120_000_000);
    const totalUses = s.uses[0].acquisition_pence + s.uses[0].construction_pence
      + s.uses[0].professional_pence + s.uses[0].statutory_pence;
    expect(totalUses).toBe(s.totals.acquisition_pence + s.totals.construction_pence
      + s.totals.professional_pence + s.totals.statutory_pence);
  });
});

describe('buildSchedule with a v4 programme', () => {
  const base = () => migrateInputsToV4({});          // import from './migrate'

  it('v4 with programme:null is bit-identical to the migrated v3 schedule', () => {
    const v3 = migrateInputsToV3({});
    const v4 = migrateV3toV4(v3);
    expect(buildSchedule(v4)).toEqual(buildSchedule(v3));
  });

  it('an explicit programme places each package window with its curve', () => {
    const v4 = base();
    v4.finance.term_months = 12;
    // construction total must be 60,000,000p for the table below:
    v4.conversion_costs.construction_cost_per_sqm_pence = 150_000;
    v4.conversion_costs.total_construction_sqm = 400;
    v4.conversion_costs.contingency_pct = 0;
    v4.conversion_costs.fire_safety_pence = 0;
    v4.conversion_costs.sound_insulation_pence = 0;
    v4.conversion_costs.part_l_compliance_pence = 0;
    v4.programme = {
      anchor_month: null,
      packages: {
        construction: { start_offset: 1, duration_months: 6, curve: { kind: 's_curve' } },
        professional: { start_offset: 2, duration_months: 3, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 4, duration_months: 2, curve: { kind: 'back_loaded' } },
      },
    };
    const s = buildSchedule(v4);
    expect(s.uses.map((u) => u.construction_pence)).toEqual([
      0, 4_019_238, 10_980_762, 15_000_000, 15_000_000, 10_980_762, 4_019_238, 0, 0, 0, 0, 0,
    ]);
    // professional window shifted to months 2..4; statutory back-loaded months 4..5
    expect(s.uses[1].professional_pence).toBe(0);
    expect(s.uses[2].professional_pence).toBeGreaterThan(0);
    const statTotal = v4.conversion_costs.cil_s106_pence + v4.conversion_costs.building_control_pence;
    expect(s.uses[4].statutory_pence + s.uses[5].statutory_pence
      - Math.round(statTotal / 3) - (statTotal - Math.round(statTotal / 3))).toBe(0);
    // prior-approval fee still at month 0 regardless of the statutory package
    expect(s.uses[0].statutory_pence).toBe(
      v4.conversion_costs.prior_approval_fee_per_dwelling_pence * Math.max(1, v4.unit_mix.units.length));
  });

  // CRITICAL 1c: validation.ts is the real gate on these fields, but buildSchedule
  // must not throw when called directly on an unvalidated document (a negative
  // start_offset previously reached `uses[-1]` — undefined, TypeError on the next
  // property access — and a fractional duration reached `new Array(2.5)` —
  // RangeError). Both are now floored/clamped defensively at the schedule/curve
  // boundary; totals still conserve (nothing is dropped, just relocated in-range).
  it('a fractional/negative start_offset no longer throws and lands clamped', () => {
    const v4 = base();
    v4.finance.term_months = 12;
    v4.conversion_costs.construction_cost_per_sqm_pence = 150_000;
    v4.conversion_costs.total_construction_sqm = 400;
    v4.conversion_costs.contingency_pct = 0;
    v4.conversion_costs.fire_safety_pence = 0;
    v4.conversion_costs.sound_insulation_pence = 0;
    v4.conversion_costs.part_l_compliance_pence = 0;
    v4.programme = {
      anchor_month: null,
      packages: {
        construction: { start_offset: -1.5, duration_months: 2.5, curve: { kind: 'straight_line' } },
        professional: { start_offset: 1, duration_months: 2, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 1, duration_months: 2, curve: { kind: 'straight_line' } },
      },
    };
    expect(() => buildSchedule(v4)).not.toThrow();
    const s = buildSchedule(v4);
    const constructionByMonth = s.uses.map((u) => u.construction_pence);
    expect(constructionByMonth.length).toBe(12);
    expect(constructionByMonth.every((v) => v >= 0)).toBe(true);
    // conservation: total construction spend (400 sqm × 150,000p, 0% contingency)
    // is unaffected by the clamp — relocated in-range, never dropped.
    expect(constructionByMonth.reduce((a, b) => a + b, 0)).toBe(60_000_000);
  });
});

describe('R9 — ancillary value flows into sale receipts', () => {
  // The two units from conversion-calc-engine.test.ts's
  // 'R9 — GDV splits internal saleable from ancillary' describe block.
  const units: ProposedUnitV6[] = [
    { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 6, balcony_terrace_value_pence: 400_000, parking_spaces: 1, parking_value_pence: 1_200_000 } },
    { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 24_500_000, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 0, balcony_terrace_value_pence: 0, parking_spaces: 1, parking_value_pence: 1_200_000 } },
  ];

  function makeV6Inputs(route: 'sell_all' | 'retain_all' | 'blended', retainedIds: string[] = []): CalculatorInputsV6 {
    const inputs = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
    inputs.unit_mix = { units };
    inputs.exit_strategy = {
      ...inputs.exit_strategy,
      route,
      retained_units: retainedIds.map((id) => ({ unit_id: id, monthly_rent_pence: 0 })),
    };
    return inputs;
  }

  it('sells a unit with its parking and balcony value attached', () => {
    // Without this, GDV and gross sale receipts disagree by the ancillary total
    // and the appraisal no longer reconciles.
    const s = buildSchedule(makeV6Inputs('sell_all'));
    expect(s.totals.gross_sales_pence).toBe(52_300_000);
    expect(s.totals.gdv_pence).toBe(52_300_000);
  });

  it('leaves a retained unit\'s ancillary out of receipts but inside GDV', () => {
    const s = buildSchedule(makeV6Inputs('blended', ['u2']));
    expect(s.totals.gross_sales_pence).toBe(26_600_000); // u1 internal + u1 ancillary
    expect(s.totals.gdv_pence).toBe(52_300_000);
  });
});

describe('buildSchedule with sales_phasing (spec §4.4.1)', () => {
  const phased = () => {
    const v4 = migrateInputsToV4({});
    v4.finance.term_months = 12;
    v4.unit_mix.units = [
      { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' },
      { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_001, comparable_notes: '' },
    ];
    v4.exit_strategy.selling_agent_fee_pct = 1.5;
    v4.exit_strategy.selling_legal_fee_pence = 400_000;
    return v4;
  };

  it('null phasing is byte-identical to the single final-month disposal', () => {
    const v4 = phased();
    const single = buildSchedule(v4);
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    expect(buildSchedule(v4)).toEqual(single);   // single 100% tranche == null (identity)
  });

  it('splits gross and costs pro-rata with final-tranche residue absorption', () => {
    const v4 = phased();
    v4.sales_phasing = { tranches: [
      { month_offset: 9, pct_of_gross_receipts: 40 },
      { month_offset: 10, pct_of_gross_receipts: 35 },
      { month_offset: 11, pct_of_gross_receipts: 25 },
    ] };
    const s = buildSchedule(v4);
    const gross = 60_000_001;
    const agent = Math.round((gross * 1.5) / 100);
    const g9 = Math.round((gross * 40) / 100), g10 = Math.round((gross * 35) / 100);
    expect(s.receipts[9].gross_sale_pence).toBe(g9);
    expect(s.receipts[10].gross_sale_pence).toBe(g10);
    expect(s.receipts[11].gross_sale_pence).toBe(gross - g9 - g10);          // residue
    const a9 = Math.round((agent * g9) / gross), a10 = Math.round((agent * g10) / gross);
    expect(s.receipts[9].agent_fee_pence).toBe(a9);
    expect(s.receipts[11].agent_fee_pence).toBe(agent - a9 - a10);           // residue
    const legalSum = s.receipts.reduce((x, r) => x + r.selling_legal_pence, 0);
    expect(legalSum).toBe(400_000);                                          // conservation
    expect(s.totals.selling_costs_pence).toBe(agent + 400_000);              // totals unchanged
    expect(s.refinance).toBeNull();
  });
});

describe('buildSchedule statutory timing (R10 §3.4)', () => {
  it('keeps prior approval in month 0 and spreads the rest of statutory (R10 §3.4)', () => {
    // 4 units x 9,600 prior approval = 38,400 in month 0, and nothing else:
    // CIL/S106 (700,000) and building control (200,000) spread from month 1.
    const base = defaultCalculatorInputsV7();
    const inputs: CalculatorInputsV7 = {
      ...base,
      finance: { ...base.finance, term_months: 12, funding_source: 'cash' },
      exit_strategy: { ...base.exit_strategy, route: 'sell_all' },
      unit_mix: { units: ['u1', 'u2', 'u3', 'u4'].map((id) => ({
        ...base.unit_mix.units[0], id, estimated_value_pence: 20_000_000,
      })) },
      conversion_costs: {
        ...base.conversion_costs,
        prior_approval_fee_per_dwelling_pence: 9_600,
        cil_s106_pence: 700_000,
        building_control_pence: 200_000,
      },
    };
    // The cost plan must be rebuilt from those cost fields, because the fee lines
    // — not the fields — are what the schedule now reads.
    inputs.cost_plan = costPlanFromLegacyCosts(inputs.conversion_costs);
    const s = buildSchedule(inputs);
    expect(s.uses[0].statutory_pence).toBe(38_400);
    expect(s.totals.statutory_pence).toBe(938_400);
    // The spread half must be non-zero somewhere after month 0, or "month 0 only"
    // would pass vacuously on a document whose spread total happened to be 0.
    expect(s.uses.slice(1).reduce((t, u) => t + u.statutory_pence, 0)).toBe(900_000);
  });
});

describe('buildSchedule follows the cost plan, not legacy fields, when they disagree (R10 fix round 1, I1)', () => {
  it('reads construction/professional/statutory totals from cost_plan even though conversion_costs disagrees', () => {
    // Every schedule-level test elsewhere either uses a v6 document (where the
    // legacy fallback derives cost_plan FROM these same fields, so the two
    // paths necessarily agree) or rebuilds cost_plan from conversion_costs
    // (same again). None of those would catch a revert to reading
    // conversion_costs directly. Here the two are deliberately set to give
    // wildly different answers, so only a schedule that genuinely reads
    // cost_plan can pass.
    const base = defaultCalculatorInputsV7();
    const inputs: CalculatorInputsV7 = {
      ...base,
      finance: { ...base.finance, term_months: 12 },
      unit_mix: { units: ['u1', 'u2', 'u3', 'u4'].map((id) => ({
        ...base.unit_mix.units[0], id, estimated_value_pence: 20_000_000,
      })) },
      // The legacy fields: if the schedule ever read these directly again,
      // construction would be ~750m, professional ~45m, statutory ~22m —
      // nothing close to the cost-plan-derived literals asserted below.
      conversion_costs: {
        ...base.conversion_costs,
        construction_cost_per_sqm_pence: 999_999,
        total_construction_sqm: 500,
        contingency_pct: 50,
        fire_safety_pence: 100_000,
        sound_insulation_pence: 50_000,
        part_l_compliance_pence: 25_000,
        architect_pence: 9_000_000,
        structural_engineer_pence: 9_000_000,
        mande_pence: 9_000_000,
        planning_consultant_pence: 9_000_000,
        other_professional_fees_pence: 9_000_000,
        prior_approval_fee_per_dwelling_pence: 999_999,
        cil_s106_pence: 9_000_000,
        building_control_pence: 9_000_000,
      },
      // The cost plan the schedule must actually follow: detailed mode, so
      // base build and compliance come from the packages, not from cc.
      cost_plan: {
        mode: 'detailed',
        packages: [{
          id: 'p1', code: 'structure', label: 'Structure', amount_pence: 10_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null,
        }],
        contingency: [
          { name: 'general', pct: 10, basis: 'all_packages', package_ids: [] },
          { name: 'existing_building', pct: 0, basis: 'all_packages', package_ids: [] },
          { name: 'abnormal', pct: 0, basis: 'all_packages', package_ids: [] },
        ],
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'fixed', amount_pence: 2_000_000, pct: 0, per_dwelling: false, vat_override: null },
          { id: 'f2', code: 'prior_approval', category: 'statutory', label: 'Prior approval',
            basis: 'fixed', amount_pence: 5_000, pct: 0, per_dwelling: true, vat_override: null },
          { id: 'f3', code: 'cil_s106', category: 'statutory', label: 'CIL / S106',
            basis: 'fixed', amount_pence: 300_000, pct: 0, per_dwelling: false, vat_override: null },
        ],
      },
    };
    const s = buildSchedule(inputs);
    // Cost plan: base build 10,000,000 + 10% general contingency 1,000,000 +
    // 0 compliance (detailed mode prices compliance inside packages).
    expect(s.totals.construction_pence).toBe(11_000_000);
    // Cost plan: architect only (2,000,000) — every other legacy professional
    // field above is absent from the fee lines.
    expect(s.totals.professional_pence).toBe(2_000_000);
    // Cost plan: prior approval 5,000 x 4 units (20,000) + CIL/S106 (300,000).
    expect(s.totals.statutory_pence).toBe(320_000);
  });
});
