import { describe, it, expect } from 'vitest';
import { buildSchedule, spreadStraightLine } from './schedule';
import { defaultCalculatorInputsV2, defaultCalculatorInputsV7 } from '../conversion-defaults';
import type {
  CalculatorInputsV2, CalculatorInputsV6, CalculatorInputsV7, CalculatorInputsV8, CalculatorInputsV9,
  ProgrammeDerivation,
} from './finance-types';
import {
  migrateInputsToV3, migrateInputsToV4, migrateInputsToV6, migrateV3toV4,
  migrateV2toV3, migrateV4toV5, migrateV5toV6, migrateV6toV7, migrateV7toV8, migrateV8toV9,
} from './migrate';
import type { ProposedUnitV6 } from '../conversion-types';
import { costPlanFromLegacyCosts, defaultContingencyClasses } from './cost-plan';
import { DEFAULT_VAT, defaultVatTreatments } from './vat';
import { runAppraisal } from './index';
import { validateInputs } from './validation';
import { derivePhases } from './programme';

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
          phase_id: null,
        }],
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 0 },
        ],
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'fixed', amount_pence: 2_000_000, pct: 0, per_dwelling: false, vat_override: null,
            phase_id: null },
          { id: 'f2', code: 'prior_approval', category: 'statutory', label: 'Prior approval',
            basis: 'fixed', amount_pence: 5_000, pct: 0, per_dwelling: true, vat_override: null,
            phase_id: null },
          { id: 'f3', code: 'cil_s106', category: 'statutory', label: 'CIL / S106',
            basis: 'fixed', amount_pence: 300_000, pct: 0, per_dwelling: false, vat_override: null,
            phase_id: null },
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

// ---------------------------------------------------------------------------
// R11 Task 5 (spec §17.6, schedule half) — VAT out on uses, VAT back on
// receipts. Reuses vat.test.ts's buildWorkedVatCase approach (§17.4's worked
// cycle): construction is the only category bearing VAT by default, spread
// months 1-4 by an EXPLICIT programme (the auto window spreads over
// months 1..term-2 — five months for a term of seven — not the four the
// worked cycle specifies), and quarterly returns with first_period_end_month:
// 2 and repayment_lag_months: 1 (DEFAULT_VAT) give two reclaim periods over a
// 7-month term: months 0-2 (reclaim m3) and months 3-5 (reclaim m6).
// ---------------------------------------------------------------------------

function workedVatDocument(opts: { registered?: boolean } = {}): CalculatorInputsV8 {
  const registered = opts.registered ?? true;
  const v7 = defaultCalculatorInputsV7();
  return {
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
    finance: {
      ...v7.finance,
      committed_net_facility_pence: 500_000_000,
      broker_fee_pence: 250_000,
      lender_legal_fee_pence: 150_000,
      valuation_fee_pence: 100_000,
      monitoring_surveyor_fee_pence: 50_000,
      term_months: 7,
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
        t.category === 'construction'
          ? { ...t, rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' as const }
          : t),
    },
  };
}

function preV8Document(): CalculatorInputsV7 {
  return defaultCalculatorInputsV7();
}

describe('buildSchedule VAT (spec §17.6)', () => {
  it('places VAT out on the spend months and VAT back on the reclaim months', () => {
    const schedule = buildSchedule(workedVatDocument());
    expect(schedule.uses.map((u) => u.vat_pence))
      .toEqual([0, 5_000_000, 5_000_000, 5_000_000, 5_000_000, 0, 0]);
    expect(schedule.receipts.map((r) => r.vat_reclaim_pence))
      .toEqual([0, 0, 0, 10_000_000, 0, 0, 10_000_000]);
    expect(schedule.totals.vat_pence).toBe(20_000_000);
    expect(schedule.totals.vat_reclaim_pence).toBe(20_000_000);
  });

  it('leaves every non-VAT figure identical to the same document with VAT off', () => {
    // §17.5's one-direction rule, at the schedule boundary. Compared
    // EXHAUSTIVELY BY EXCLUSION (ruling R21) rather than an enumerated field
    // list: strip the VAT fields off both sides and deep-equal the remainder,
    // so a field added to MonthUses/MonthReceipts/Schedule.totals in future is
    // covered automatically, and a newly-leaking field fails this test without
    // anyone remembering to update an allowlist here.
    const on = buildSchedule(workedVatDocument());
    const off = buildSchedule(workedVatDocument({ registered: false }));

    const usesWithoutVat = (uses: typeof on.uses) => uses.map(({ vat_pence, ...rest }) => rest);
    expect(usesWithoutVat(on.uses)).toEqual(usesWithoutVat(off.uses));

    const receiptsWithoutVat = (receipts: typeof on.receipts) =>
      receipts.map(({ vat_reclaim_pence, ...rest }) => rest);
    expect(receiptsWithoutVat(on.receipts)).toEqual(receiptsWithoutVat(off.receipts));

    const totalsWithoutVat = (totals: typeof on.totals) => {
      const { vat_pence, vat_reclaim_pence, irrecoverable_vat_pence, ...rest } = totals;
      return rest;
    };
    expect(totalsWithoutVat(on.totals)).toEqual(totalsWithoutVat(off.totals));
  });

  it('writes zeroed VAT lines for a document with no vat block at all', () => {
    const schedule = buildSchedule(preV8Document());
    expect(schedule.uses.every((u) => u.vat_pence === 0)).toBe(true);
    expect(schedule.receipts.every((r) => r.vat_reclaim_pence === 0)).toBe(true);
    expect(schedule.totals.vat_pence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R12 Task 11 (spec §18.5) — phase-driven spend. Cost lines resolve to phases
// via `resolvedPhaseId`, and each phase's derived window/curve determines
// when its money lands in the monthly ledger.
// ---------------------------------------------------------------------------

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function migrateToV9(v2: CalculatorInputsV2): CalculatorInputsV9 {
  const v3 = migrateV2toV3(v2);
  const v4 = migrateV3toV4(v3);
  const v5 = migrateV4toV5(v4);
  const v6 = migrateV5toV6(v5);
  const v7 = migrateV6toV7(v6);
  const v8 = migrateV7toV8(v7);
  return migrateV8toV9(v8);
}

/**
 * Three predecessor-free phases: `design` [0,2), `strip_out` [0,2),
 * `construction` [4,8) — the last matches the brief's worked example
 * verbatim. Categories default construction -> construction, professional
 * and statutory -> design. cost_plan/conversion_costs are whatever
 * `baseInputs()` produces (professional total 2,800,000p; statutory total
 * 238,400p, of which 38,400p is prior_approval).
 */
function baseNetworkDoc(): CalculatorInputsV9 {
  const v9 = migrateToV9(baseInputs());
  v9.programme = {
    anchor_month: null,
    phases: [
      { id: 'design', code: 'design', label: 'Design', duration_months: 2,
        slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [] },
      { id: 'strip_out', code: 'strip_out', label: 'Strip out', duration_months: 2,
        slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [] },
      { id: 'construction', code: 'construction', label: 'Construction', duration_months: 4,
        slip_months: 0, start_offset: 4, curve: { kind: 'straight_line' }, predecessors: [] },
    ],
    category_phase_ids: { construction: 'construction', professional: 'design', statutory: 'design' },
  };
  return v9;
}

describe('phase-driven spend — §18.5', () => {
  it('headline totals spread over the phase named by category_phase_ids.construction', () => {
    // construction phase occupies [4,8) — ABSOLUTE months 4,5,6,7. Total is
    // 44,000,000p (400 sqm x 100,000p/sqm base build + 10% contingency, from
    // baseInputs()' conversion_costs — the same figure the top-of-file
    // "spreads construction over months 1..term-2" test establishes), which
    // divides the 4-month straight-line window evenly: 11,000,000p/month,
    // no residue.
    const s = buildSchedule(baseNetworkDoc());
    const c = s.uses.map((u) => u.construction_pence);
    expect(c.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(c.slice(4, 8)).toEqual([11_000_000, 11_000_000, 11_000_000, 11_000_000]);
    expect(c[8]).toBe(0);
    expect(s.totals.construction_pence).toBe(44_000_000);
  });

  // Task 16 falsifiability audit. Single-line change that kills this guard:
  // `resolvedPhaseId`'s `return phaseId ?? network.category_phase_ids[category];`
  // -> `return phaseId ?? network.category_phase_ids.construction;` (every
  // category silently reads the construction map entry). Verified: `a`'s and
  // `b`'s professional_pence arrays become identical — reverted after
  // confirming the guard, and the rest of this file, pass again clean.
  it('GUARD 5: repointing category_phase_ids.professional changes the spend profile', () => {
    // Two documents identical but for the map. Without this, the map could be
    // read by nothing and every other test would still pass.
    const a = baseNetworkDoc(); // professional -> design [0,2)
    const b = baseNetworkDoc();
    b.programme!.category_phase_ids.professional = 'construction'; // [4,8)
    expect(buildSchedule(a).uses.map((u) => u.professional_pence))
      .not.toEqual(buildSchedule(b).uses.map((u) => u.professional_pence));
  });

  it('a per-line phase_id override lands in its own window, not the category default', () => {
    const doc = baseNetworkDoc();
    doc.cost_plan = {
      mode: 'detailed',
      packages: [{
        id: 'p1', code: 'structure', label: 'Structure', amount_pence: 6_000_000,
        contingency_class: 'general', lender_eligible: true, notes: '',
        vat_override: null, phase_id: 'strip_out',
      }],
      contingency: defaultContingencyClasses(0),
      fee_lines: [],
    };
    const s = buildSchedule(doc);
    // strip_out window is months 0-1; the package's whole amount must land there.
    expect(s.uses[0].construction_pence + s.uses[1].construction_pence).toBe(6_000_000);
    // construction window (category default, months 4-7) gets none of it — the
    // remainder (base build minus the one tagged package) is zero here.
    expect(s.uses.slice(4, 8).every((u) => u.construction_pence === 0)).toBe(true);
    expect(s.totals.construction_pence).toBe(6_000_000);
  });

  it('acquisition stays at month 0 regardless of the acquisition phase window', () => {
    const doc = baseNetworkDoc();
    doc.programme!.phases.push({
      id: 'acquisition', code: 'acquisition', label: 'Acquisition', duration_months: 1,
      slip_months: 0, start_offset: 6, curve: { kind: 'straight_line' }, predecessors: [],
    });
    const s = buildSchedule(doc);
    expect(s.totals.acquisition_pence).toBeGreaterThan(0);
    expect(s.uses[0].acquisition_pence).toBe(s.totals.acquisition_pence);
  });

  it('prior_approval stays at month 0 by default and moves only when tagged', () => {
    const untagged = baseNetworkDoc();
    // Isolate: zero the other statutory fee (building_control; cil_s106 is
    // already 0 in baseInputs()) and move the statutory category default
    // itself off month 0, so any month-0 statutory spend can only be the
    // prior_approval pin.
    untagged.cost_plan.fee_lines = untagged.cost_plan.fee_lines.map((f) => (
      f.code === 'building_control' ? { ...f, amount_pence: 0 } : f
    ));
    untagged.programme!.category_phase_ids.statutory = 'construction'; // [4,8), nowhere near month 0
    const tagged = clone(untagged);
    tagged.cost_plan.fee_lines = tagged.cost_plan.fee_lines.map((f) => (
      f.code === 'prior_approval' ? { ...f, phase_id: 'construction' } : f
    ));

    expect(buildSchedule(untagged).uses[0].statutory_pence).toBeGreaterThan(0);
    expect(buildSchedule(tagged).uses[0].statutory_pence).toBe(0);
  });

  it('every window still sums to its total exactly (the residue invariant)', () => {
    const doc = baseNetworkDoc();
    doc.programme!.category_phase_ids.professional = 'construction'; // exercises a >1-month curve too
    const s = buildSchedule(doc);
    expect(s.uses.reduce((t, u) => t + u.construction_pence, 0)).toBe(s.totals.construction_pence);
    expect(s.uses.reduce((t, u) => t + u.professional_pence, 0)).toBe(s.totals.professional_pence);
    expect(s.uses.reduce((t, u) => t + u.statutory_pence, 0)).toBe(s.totals.statutory_pence);
  });

  it('the auto path is untouched when programme is null (byte-identical to calc 2.10.0)', () => {
    const v2 = baseInputs();
    const v8 = migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(v2))))));
    const v9 = migrateV8toV9(v8);
    expect(v9.programme).toBeNull();
    expect(buildSchedule(v9)).toEqual(buildSchedule(v8));
    expect(buildSchedule(v9).programme).toBeNull();
  });

  it('Ruling A: a v9 network document is NOT silently treated as auto-windows', () => {
    // Earlier tasks left deliberate scaffolding (three `'packages' in`
    // narrowings, since removed) that would have made a v9 document carrying
    // a POPULATED network silently fall through to the §6 auto-window path
    // here — programme ignored, no error, no warning. This guard asserts the
    // real network arm: a non-null `programme` result block, and spend that
    // follows the NETWORK'S windows, not §6's formula, in absolute months.
    const withNetwork = baseNetworkDoc(); // design[0,2), strip_out[0,2), construction[4,8), term 12
    const s = buildSchedule(withNetwork);

    expect(s.programme).not.toBeNull();
    expect(s.programme!.finish_month).toBe(8); // construction's own finish sets the programme end
    expect(s.programme!.critical_path).toEqual(['construction']); // the only phase with zero float

    // Absolute months: construction spend lands in the NETWORK's window [4,8) —
    // matching the "headline totals spread over the phase named by
    // category_phase_ids.construction" test above — not §6's auto formula,
    // which for a 12-month term would start spend at month 1 (established by
    // "spreads construction over months 1..term-2" above: 4,400,000p).
    const c = s.uses.map((u) => u.construction_pence);
    expect(c[1]).toBe(0);
    expect(c.slice(4, 8)).toEqual([11_000_000, 11_000_000, 11_000_000, 11_000_000]);
    expect(c[8]).toBe(0);

    // Direct negative control, same document minus the network: an otherwise
    // identical document with `programme: null` DOES take the auto path and
    // DOES put spend at month 1 — proving the two arms are genuinely
    // different code paths, not the same numbers by coincidence.
    const withoutNetwork = { ...withNetwork, programme: null };
    const auto = buildSchedule(withoutNetwork);
    expect(auto.programme).toBeNull();
    expect(auto.uses.map((u) => u.construction_pence)).not.toEqual(c);
    expect(auto.uses[1].construction_pence).toBe(4_400_000);
  });

  /**
   * GUARD 2. `planning` [0,2), FS-predecessor of `construction` [duration 3),
   * lag 0. Acquisition (42,150,000p, established by the "places acquisition..."
   * test above) is fully funded by a matching committed cash equity source —
   * zero facility involvement, zero interest contribution from it — isolating
   * the whole interest/peak-debt story to the 300,000,000p construction spend
   * (400 sqm x 750,000p/sqm, headline, 0% contingency, 0 compliance; straight
   * line over 3 months = 100,000,000p/month exactly, no rounding residue).
   * Facility: rolled-up interest at 12%pa (1%/month), 0% arrangement/exit fee,
   * 100% development-cost advance, a facility ceiling far above anything drawn.
   * retain_all / 9-month term: no sale, no repayment before the final month,
   * so the balance is monotonic and the final month's pre-repayment balance
   * IS the peak.
   *
   * term_months is 9, not 8 (fix round 1, Finding 2): with an 8-month term the
   * SLIPPED case's construction window is [5,8), and `construction` is a
   * PRE_COMPLETION code, so validation's sale-tail rule
   * (`finish_month > term - 1`, spec §6) fires — 8 > 7. That pinned figures
   * for a document the product refuses to accept. At 9 months, finish 8 is
   * not > term-1 (8), so both documents below are asserted validation-clean.
   *
   * BASE (planning start 0, finish 2 -> construction start 2, finish 5;
   * draws at months 2,3,4; rolled-up interest at 1%/month on the RUNNING
   * balance, i.e. interest_m = round((opening_m + draw_m) * 0.01); one more
   * idle compounding month than an 8-month term would have had, m5..m8):
   *   m0-1: opening 0, draw 0, interest 0, balance 0.
   *   m2: opening 0,           draw 100,000,000 -> interest   1,000,000 -> balance 101,000,000
   *   m3: opening 101,000,000, draw 100,000,000 -> interest   2,010,000 -> balance 203,010,000
   *   m4: opening 203,010,000, draw 100,000,000 -> interest   3,030,100 -> balance 306,040,100
   *   m5: opening 306,040,100, draw 0            -> interest   3,060,401 -> balance 309,100,501
   *   m6: opening 309,100,501, draw 0            -> interest   3,091,005 -> balance 312,191,506
   *   m7: opening 312,191,506, draw 0            -> interest   3,121,915 -> balance 315,313,421
   *   m8: opening 315,313,421, draw 0            -> interest   3,153,134 -> balance 318,466,555 (peak, final month)
   *   total interest = 1,000,000+2,010,000+3,030,100+3,060,401+3,091,005+3,121,915+3,153,134 = 18,466,555
   *   (identity check: 300,000,000 draws + 18,466,555 interest = 318,466,555 = peak, matches)
   *
   * SLIPPED (planning.slip_months = +3: start 3, finish 5 -> construction
   * start 5, finish 8; draws at months 5,6,7, leaving ONE idle compounding
   * month, m8, before the peak is captured at the 9-month term's final month):
   *   m0-4: balance 0.
   *   m5: opening 0,           draw 100,000,000 -> interest 1,000,000 -> balance 101,000,000
   *   m6: opening 101,000,000, draw 100,000,000 -> interest 2,010,000 -> balance 203,010,000
   *   m7: opening 203,010,000, draw 100,000,000 -> interest 3,030,100 -> balance 306,040,100
   *   m8: opening 306,040,100, draw 0            -> interest 3,060,401 -> balance 309,100,501 (peak, final month)
   *   total interest = 1,000,000+2,010,000+3,030,100+3,060,401 = 9,100,501
   *   (identity check: 300,000,000 draws + 9,100,501 interest = 309,100,501 = peak, matches)
   */
  function guard2Doc(): CalculatorInputsV9 {
    const v9 = migrateToV9(baseInputs());
    v9.finance = {
      ...v9.finance,
      term_months: 9,
      annual_interest_rate_pct: 12,
      arrangement_fee_pct: 0,
      exit_fee_pct: 0,
      committed_net_facility_pence: 5_000_000_000,
      day_one_advance_pence: null,
    };
    v9.equity_sources = [{
      id: 'eq1', classification: 'cash', amount_pence: 42_150_000,
      timing_month: 0, repayment_priority: 1, evidence_status: 'confirmed', notes: '',
    }];
    v9.exit_strategy = {
      route: 'retain_all', selling_agent_fee_pct: 0, selling_legal_fee_pence: 0, retained_units: [],
    };
    v9.conversion_costs = {
      ...v9.conversion_costs,
      construction_cost_per_sqm_pence: 750_000, total_construction_sqm: 400,
    };
    v9.cost_plan = {
      mode: 'headline', packages: [], contingency: defaultContingencyClasses(0), fee_lines: [],
    };
    v9.programme = {
      anchor_month: null,
      phases: [
        { id: 'planning', code: 'planning', label: 'Planning', duration_months: 2,
          slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [] },
        { id: 'construction', code: 'construction', label: 'Construction', duration_months: 3,
          slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' },
          predecessors: [{ phase_id: 'planning', type: 'FS', lag_months: 0 }] },
      ],
      category_phase_ids: { construction: 'construction', professional: 'planning', statutory: 'planning' },
    };
    return v9;
  }

  function withPlanningSlip(doc: CalculatorInputsV9, months: number): CalculatorInputsV9 {
    const c = clone(doc);
    c.programme!.phases.find((p) => p.id === 'planning')!.slip_months = months;
    return c;
  }

  // Task 16 falsifiability audit. Single-line change that kills this guard:
  // schedule.ts's `placeInPhase`, `const start = derived?.start_month ?? 0;`
  // -> `const start = 0;` (severing the derived network's start month from
  // where spend actually lands). Verified: peak_debt_pence becomes
  // 215,499,206 instead of the pinned 318,466,555 — reverted after confirming
  // the guard, and the rest of this file, pass again clean.
  it('GUARD 2: slipping a critical phase moves the successor start AND peak debt/interest, absolutely', () => {
    const baseDoc = guard2Doc();
    const slippedDoc = withPlanningSlip(guard2Doc(), 3);

    // Fix round 1, Finding 2: the pinned figures below describe a document
    // the product actually accepts — not a state validation rejects.
    expect(validateInputs(baseDoc).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateInputs(slippedDoc).filter((i) => i.severity === 'error')).toEqual([]);

    const base = runAppraisal(baseDoc);
    const slipped = runAppraisal(slippedDoc);

    const startOf = (r: typeof base, id: string) =>
      r.schedule.programme!.phases.find((p) => p.id === id)!.start_month;

    expect(startOf(base, 'construction')).toBe(2);
    expect(startOf(slipped, 'construction')).toBe(5);

    // Hand-derived above — not read off a prior run of this code.
    expect(base.metrics.peak_debt_pence).toBe(318_466_555);
    expect(base.model.totals.interest_pence).toBe(18_466_555);
    expect(slipped.metrics.peak_debt_pence).toBe(309_100_501);
    expect(slipped.model.totals.interest_pence).toBe(9_100_501);

    // Absolute, not directional — R11 shipped a direction-only guard that was
    // blind to a constant added to both sides.
    expect(slipped.metrics.peak_debt_pence).not.toBe(base.metrics.peak_debt_pence);
    expect(slipped.model.totals.interest_pence).not.toBe(base.model.totals.interest_pence);
  });

  it('GUARD (Finding 1): two lines in one category resolving to the same phase are one spread of their combined total', () => {
    // 1,000,000p + 1,000,000p = 2,000,000p over 3 months, straight-line.
    // Per-line spreading would give [333,333,333,333,334] summed to
    // [666,666, 666,666, 666,668]. Bucketing the combined 2,000,000p gives a
    // SINGLE spread: round(2,000,000/3)=666,667 for the first two months,
    // the third absorbs the residue: 2,000,000 - 2*666,667 = 666,666.
    const doc = baseNetworkDoc();
    doc.programme!.phases[2].duration_months = 3; // construction [4,7)
    doc.cost_plan = {
      mode: 'detailed',
      packages: [
        { id: 'p1', code: 'structure', label: 'Structure A', amount_pence: 1_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null, phase_id: null },
        { id: 'p2', code: 'envelope', label: 'Structure B', amount_pence: 1_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null, phase_id: null },
      ],
      contingency: defaultContingencyClasses(0),
      fee_lines: [],
    };
    const s = buildSchedule(doc);
    expect(s.uses[4].construction_pence).toBe(666_667);
    expect(s.uses[5].construction_pence).toBe(666_667);
    expect(s.uses[6].construction_pence).toBe(666_666);
    expect(s.totals.construction_pence).toBe(2_000_000);
  });

  it('GUARD (Finding 3): the phase\'s own curve is actually used, not a hardcoded straight line', () => {
    // s_curve raised-cosine weights for a 3-month window: cum(k) =
    // (1-cos(pi*k/3))/2 -> cum(1)=0.25, cum(2)=0.75, cum(3)=1, so
    // w=[0.25, 0.5, 0.25]. Against the 2,800,000p professional total
    // (baseInputs()' architect+structural+mande+planning_consultant, all
    // other_professional_fees_pence=0): 700,000 / 1,400,000 / 700,000 exactly
    // — a straight-line spread over 3 months would instead give three equal
    // shares (~933,333 each), so this distinguishes the two unambiguously.
    const doc = baseNetworkDoc();
    const design = doc.programme!.phases.find((p) => p.id === 'design')!;
    design.duration_months = 3;
    design.curve = { kind: 's_curve' };
    // professional -> design already the default in baseNetworkDoc().
    const s = buildSchedule(doc);
    expect(s.uses[0].professional_pence).toBe(700_000);
    expect(s.uses[1].professional_pence).toBe(1_400_000);
    expect(s.uses[2].professional_pence).toBe(700_000);
    expect(s.totals.professional_pence).toBe(2_800_000);
  });

  it('a detailed-mode FEE-LINE phase_id override lands in its own window, not the category default', () => {
    // Finding 5: only a package override was covered; fee lines take the
    // same `resolvedPhaseId` path and need their own guard.
    const doc = baseNetworkDoc();
    doc.cost_plan.mode = 'detailed';
    doc.cost_plan.fee_lines = doc.cost_plan.fee_lines.map((f) => (
      f.code === 'architect' ? { ...f, phase_id: 'strip_out' } : f
    ));
    const architectAmount = doc.cost_plan.fee_lines.find((f) => f.code === 'architect')!.amount_pence;
    const s = buildSchedule(doc);
    // strip_out window is months 0-1; the tagged fee's whole amount lands there,
    // and none of it lands in the category default (design, [0,2) too, but
    // asserted via the totals split instead since the windows coincide here).
    expect(s.uses[0].professional_pence + s.uses[1].professional_pence)
      .toBeGreaterThanOrEqual(architectAmount);
    // Isolate precisely: re-run with every OTHER professional fee zeroed so
    // strip_out's professional total is exactly the tagged architect fee.
    const isolated = baseNetworkDoc();
    isolated.cost_plan.mode = 'detailed';
    isolated.cost_plan.fee_lines = isolated.cost_plan.fee_lines.map((f) => (
      f.code === 'architect' ? { ...f, phase_id: 'strip_out' }
        : f.category === 'professional' ? { ...f, amount_pence: 0, pct: 0 } : f
    ));
    const s2 = buildSchedule(isolated);
    expect(s2.uses[0].professional_pence + s2.uses[1].professional_pence).toBe(architectAmount);
    expect(s2.totals.professional_pence).toBe(architectAmount);
  });
});

// --- R12 §18.6/guard 4 — exit timing anchors --------------------------------

/**
 * `planning` [0,3) is predecessor-free; `unit_completions` is a milestone
 * chained off it (FS, lag 11) so slipping `planning` cascades onto
 * `unit_completions`'s start — 3 + 11 = 14 at baseline, matching the brief's
 * worked example verbatim. `practical_completion` (milestone, start 10) and
 * `sales` [16,21) are independent, so they do NOT move when `planning` slips
 * — the shape guard 4's divergence test needs.
 */
function exitAnchorNetworkDoc(term = 24): CalculatorInputsV9 {
  const v9 = migrateToV9(baseInputs());
  v9.finance = { ...v9.finance, term_months: term };
  v9.programme = {
    anchor_month: null,
    phases: [
      { id: 'planning', code: 'planning', label: 'Planning', duration_months: 3,
        slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [] },
      { id: 'unit_completions', code: 'unit_completions', label: 'Unit completions', duration_months: 0,
        slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' },
        predecessors: [{ phase_id: 'planning', type: 'FS', lag_months: 11 }] },
      { id: 'practical_completion', code: 'practical_completion', label: 'Practical completion',
        duration_months: 0, slip_months: 0, start_offset: 10, curve: { kind: 'straight_line' },
        predecessors: [] },
      { id: 'sales', code: 'sales', label: 'Sales', duration_months: 5,
        slip_months: 0, start_offset: 16, curve: { kind: 'straight_line' }, predecessors: [] },
    ],
    category_phase_ids: { construction: 'planning', professional: 'planning', statutory: 'planning' },
  };
  return v9;
}

function docWithTranche(
  tr: { anchor: { phase_id: string; offset_months: number } | null; month_offset: number },
): CalculatorInputsV9 {
  const d = exitAnchorNetworkDoc();
  return { ...d, sales_phasing: { tranches: [{ pct_of_gross_receipts: 100, ...tr }] } };
}

function docWithTwoAnchoredTranches(): CalculatorInputsV9 {
  const d = exitAnchorNetworkDoc();
  return {
    ...d,
    sales_phasing: {
      tranches: [
        { anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0, pct_of_gross_receipts: 40 },
        { anchor: { phase_id: 'sales', offset_months: 0 }, month_offset: 0, pct_of_gross_receipts: 60 },
      ],
    },
  };
}

function docWithRefinance(
  rf: { anchor: { phase_id: string; offset_months: number } | null; month_offset: number },
): CalculatorInputsV9 {
  const d = exitAnchorNetworkDoc();
  return {
    ...d,
    refinance: {
      month_offset: rf.month_offset, anchor: rf.anchor,
      investment_value_pence: 10_000_000, ltv_pct: 60,
      arrangement_fee_pence: 100_000, legal_costs_pence: 50_000,
    },
  };
}

function withSlip(d: CalculatorInputsV9, phaseId: string, months: number): CalculatorInputsV9 {
  return {
    ...d,
    programme: {
      ...d.programme!,
      phases: d.programme!.phases.map((p) => (
        p.id === phaseId ? { ...p, slip_months: p.slip_months + months } : p
      )),
    },
  };
}

describe('exit anchors — §18.6, guard 4', () => {
  // Task 16 falsifiability audit. Single-line change that kills BOTH guard-4
  // tests below: `resolveAnchorMonth`'s `if (anchor == null) return
  // monthOffset;` -> `if (true) return monthOffset;`, making every anchor a
  // no-op. Verified: the zero-slip identity test fails (the anchored doc's
  // month_offset defaults to 0, not 14, so it no longer matches its absolute
  // twin) AND the divergence test fails (the anchored receipt becomes all
  // zero at month 17, since it never resolves off unit_completions) —
  // reverted after confirming both guards, and the rest of this file, pass
  // again clean.
  it('an anchored tranche and its absolute twin are IDENTICAL at zero slip', () => {
    const anchored = docWithTranche({ anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0 });
    const absolute = docWithTranche({ anchor: null, month_offset: 14 }); // = unit_completions start
    expect(buildSchedule(anchored).receipts).toEqual(buildSchedule(absolute).receipts);
  });

  it('and DIVERGE at non-zero slip — without this, anchor is a no-op', () => {
    const anchored = withSlip(
      docWithTranche({ anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0 }),
      'planning', 3,
    );
    const absolute = withSlip(docWithTranche({ anchor: null, month_offset: 14 }), 'planning', 3);
    expect(buildSchedule(anchored).receipts).not.toEqual(buildSchedule(absolute).receipts);
    // absolute, not directional: planning [0,3)->slip 3->[3,6); unit_completions
    // floor = finish(planning) + 11 = 6 + 11 = 17. Exact pence, not merely
    // "> 0" (Task 13's carried gap, closed here) — a "> 0" check at these
    // indices would still pass if the anchored receipt landed at the RIGHT
    // month but the WRONG amount. 4 units x 30,000,000p = 120,000,000p gross;
    // 1.5% agent fee = 1,800,000p; selling legal 400,000p flat (baseInputs());
    // the sole 100%-of-gross tranche is also the LAST tranche, so it absorbs
    // the whole total rather than a pro-rata share.
    expect(buildSchedule(anchored).receipts[17]).toEqual({
      gross_sale_pence: 120_000_000, agent_fee_pence: 1_800_000,
      selling_legal_pence: 400_000, vat_reclaim_pence: 0,
    });
    // unanchored: month_offset is untouched by any phase's slip. Same total —
    // the two docs sell the same units — landing at the UNslipped month 14.
    expect(buildSchedule(absolute).receipts[14]).toEqual({
      gross_sale_pence: 120_000_000, agent_fee_pence: 1_800_000,
      selling_legal_pence: 400_000, vat_reclaim_pence: 0,
    });
  });

  it('a tranche may anchor to a MILESTONE', () => {
    // practical_completion + 2 — the canonical case, and exactly why milestones
    // carry a start even though they occupy no month.
    const doc = docWithTranche({ anchor: { phase_id: 'practical_completion', offset_months: 2 }, month_offset: 0 });
    const pc = derivePhases(doc.programme!) as ProgrammeDerivation;
    const s = buildSchedule(doc);
    expect(s.receipts[pc.byId.practical_completion.start_month + 2].gross_sale_pence).toBeGreaterThan(0);
    expect(validateInputs(doc).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refinance anchors the same way', () => {
    const anchored = docWithRefinance({ anchor: { phase_id: 'unit_completions', offset_months: 1 }, month_offset: 0 });
    const uc = (derivePhases(anchored.programme!) as ProgrammeDerivation).byId.unit_completions;
    expect(buildSchedule(anchored).refinance!.month).toBe(uc.start_month + 1);
  });

  it('two anchored tranches that CROSS when one slips are a hard error', () => {
    // §18.8's resolved-order rule. A slip that reorders tranches is a
    // finding, not something to sort silently — the receipts would
    // otherwise reorder without anyone being told.
    const d = docWithTwoAnchoredTranches();
    // Negative control: unslipped, the same document is clean.
    expect(validateInputs(d).filter((i) => i.severity === 'error')).toEqual([]);
    const crossed = withSlip(d, 'unit_completions', 9);
    expect(validateInputs(crossed).some((i) => i.severity === 'error' && /strictly increasing/.test(i.message)))
      .toBe(true);
  });
});
