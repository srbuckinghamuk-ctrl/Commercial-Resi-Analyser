import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCostPlan } from './cost-plan';
import { defaultCalculatorInputsV6, defaultCalculatorInputsV7 } from '../conversion-defaults';
import { migrateInputsToV13 } from './migrate';
import { runAppraisal } from './index';
import { monthsBetween } from './due-diligence';
import { docZ, docZNoAllowance } from './__fixtures__/cost-plan-in-time-docs';
import type { CalculatorInputsV7, CalculatorInputsV13 } from './finance-types';
import type { PriceBasis, QsProvenance } from './cost-plan';

/** A v7 document with the cost plan (and optionally the cost fields) replaced.
 *  `defaultCalculatorInputsV7` comes from Task 1. */
function doc(over: Partial<CalculatorInputsV7['cost_plan']>, costs: Partial<CalculatorInputsV7['conversion_costs']> = {}): CalculatorInputsV7 {
  const base = defaultCalculatorInputsV7();
  return {
    ...base,
    conversion_costs: { ...base.conversion_costs, ...costs },
    cost_plan: { ...base.cost_plan, ...over },
  };
}

const CLASSES = (general: number, existing: number, abnormal: number) => [
  { name: 'general' as const, pct: general },
  { name: 'existing_building' as const, pct: existing },
  { name: 'abnormal' as const, pct: abnormal },
];

const pkg = (id: string, amount: number, over = {}) => ({
  id, code: 'structure' as const, label: id, amount_pence: amount,
  contingency_class: 'general' as const, lender_eligible: true, notes: '',
  vat_override: null, phase_id: null, price_basis: null, ...over,
});

/** R11 spec §17.8. Two small builders used by the planted-divergence test and
 *  its neighbours below, matching `doc()`'s wholesale-replace semantics for
 *  `packages` / `contingency` but with sensible per-field defaults so a test
 *  can write a bare `{ id, code, amount_pence, contingency_class }` package or
 *  a bare `{ name, pct }` contingency class.
 *
 *  `package_ids: []` is stamped onto every contingency class regardless: a
 *  bare `{ name, pct }` is the correct final input shape (the field is gone
 *  from ContingencyClass), but stamping it keeps this helper safe to run
 *  against the PRE-refactor engine too, which still reads `c.package_ids` --
 *  without it, an absent field is `undefined`, and `undefined.reduce(...)`
 *  throws before the assertion ever runs, which is a type error, not the
 *  wrong `base_pence` the RED run is supposed to show. */
function detailedCostPlanDocument(over: {
  packages?: Array<Partial<CalculatorInputsV7['cost_plan']['packages'][number]>
    & Pick<CalculatorInputsV7['cost_plan']['packages'][number], 'id' | 'code' | 'amount_pence' | 'contingency_class'>>;
  contingency?: CalculatorInputsV7['cost_plan']['contingency'];
} = {}): CalculatorInputsV7 {
  const packages = over.packages?.map((p) => (
    { label: p.id, lender_eligible: true, notes: '', vat_override: null, ...p,
      phase_id: p.phase_id ?? null, price_basis: p.price_basis ?? null }
  ));
  const contingency = over.contingency?.map((c) => ({ package_ids: [] as string[], ...c }));
  return doc({
    mode: 'detailed',
    ...(packages ? { packages } : {}),
    ...(contingency ? { contingency } : {}),
  });
}

function headlineCostPlanDocument(over: {
  constructionPerSqm?: number;
  areaSqm?: number;
  contingency?: CalculatorInputsV7['cost_plan']['contingency'];
} = {}): CalculatorInputsV7 {
  const contingency = over.contingency?.map((c) => ({ package_ids: [] as string[], ...c }));
  return doc(
    { mode: 'headline', ...(contingency ? { contingency } : {}) },
    over.constructionPerSqm !== undefined
      ? { construction_cost_per_sqm_pence: over.constructionPerSqm } : {},
  );
}

describe('computeCostPlan — headline mode', () => {
  it('reproduces the pre-R10 base = rate x area', () => {
    // 80,730 p/m2 x 500 m2 = 40,365,000 p. Derived by hand.
    const r = computeCostPlan(
      doc({ mode: 'headline', contingency: CLASSES(0, 0, 0) },
          { construction_cost_per_sqm_pence: 80_730 }),
      500, 1,
    );
    expect(r.base_build_pence).toBe(40_365_000);
    expect(r.compliance_pence).toBe(0);
    expect(r.construction_total_pence).toBe(40_365_000);
  });

  it('keeps compliance allowances as a separate component in headline mode', () => {
    // 40,365,000 base + 0 contingency + (250,000 + 150,000 + 100,000) compliance
    const r = computeCostPlan(
      doc({ mode: 'headline', contingency: CLASSES(0, 0, 0) }, {
        construction_cost_per_sqm_pence: 80_730,
        fire_safety_pence: 250_000, sound_insulation_pence: 150_000,
        part_l_compliance_pence: 100_000,
      }),
      500, 1,
    );
    expect(r.compliance_pence).toBe(500_000);
    expect(r.construction_total_pence).toBe(40_865_000);
  });
});

describe('computeCostPlan — three contingency classes round independently', () => {
  it('sums three rounded figures rather than rounding the sum', () => {
    // Base build chosen so each 5% lands on a half-penny: 1,000,010 x 5% =
    // 50,000.5 -> 50,001 half-up. Three classes: 150,003.
    // One class at 15% would be 150,001.5 -> 150,002. The two differ by 1p, so
    // this test fails if the classes are ever collapsed for rounding.
    //
    // Headline mode: R11 spec §17.8 makes existing_building/abnormal scope by
    // package tag in DETAILED mode, so a single untagged package could no
    // longer give all three classes the same base. Headline mode still gives
    // every class the whole base build, which is what this test needs to
    // isolate rounding independence from scoping.
    const r = computeCostPlan(
      headlineCostPlanDocument({ constructionPerSqm: 1_000_010, areaSqm: 1, contingency: CLASSES(5, 5, 5) }),
      1, 1,
    );
    expect(r.contingency.map((c) => c.amount_pence)).toEqual([50_001, 50_001, 50_001]);
    expect(r.contingency_total_pence).toBe(150_003);
  });

  it('resolves existing_building against only its tagged packages, as an addition to general', () => {
    // existing_building at 20% of p2 alone (2,000,000, tagged existing_building) = 400,000.
    // general at 10% of the whole base build (3,000,000) = 300,000.
    const r = computeCostPlan(
      detailedCostPlanDocument({
        packages: [
          { id: 'p1', code: 'structure', amount_pence: 1_000_000, contingency_class: 'general' },
          { id: 'p2', code: 'structure', amount_pence: 2_000_000, contingency_class: 'existing_building' },
        ],
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: 20 },
          { name: 'abnormal', pct: 0 },
        ],
      }),
      0, 1,
    );
    expect(r.base_build_pence).toBe(3_000_000);
    expect(r.contingency[0].base_pence).toBe(3_000_000);
    expect(r.contingency[0].amount_pence).toBe(300_000);
    expect(r.contingency[1].base_pence).toBe(2_000_000);
    expect(r.contingency[1].amount_pence).toBe(400_000);
    expect(r.contingency_total_pence).toBe(700_000);
  });
});

describe('computeCostPlan — contingency scoped by package tag, mode-dependent (R11 spec §17.8)', () => {
  it('resolves a contingency base from the package TAG, not from a stale id list', () => {
    // The two mechanisms are made to DISAGREE deliberately. Before this task,
    // package_ids decided the base -- and this document's helper stamps
    // package_ids: [] on every class, since nothing here sets it, so the old
    // mechanism would report 0, not a plausible-looking figure from either
    // package. After it, the tag decides and the base is the OTHER package
    // (7,000,000, abnormal's own package, not general's 1,000,000).
    const inputs = detailedCostPlanDocument({
      packages: [
        { id: 'p1', code: 'structure', amount_pence: 1_000_000, contingency_class: 'general' },
        { id: 'p2', code: 'externals', amount_pence: 7_000_000, contingency_class: 'abnormal' },
      ],
      contingency: [
        { name: 'general', pct: 0 },
        { name: 'existing_building', pct: 0 },
        { name: 'abnormal', pct: 10 },
      ],
    });
    const result = computeCostPlan(inputs, 100, 1);
    const abnormal = result.contingency.find((c) => c.name === 'abnormal');
    expect(abnormal?.base_pence).toBe(7_000_000);
    expect(abnormal?.amount_pence).toBe(700_000);
    expect(abnormal?.basis).toBe('selected_packages');
  });

  it('gives every contingency class the whole base build in headline mode', () => {
    // ConversionCostsPage renders all three percentages in BOTH modes, and a
    // headline document has no packages to tag. Scoping by tag here would
    // silently zero a live, shipped input path (spec §17.8).
    const inputs = headlineCostPlanDocument({
      constructionPerSqm: 100_000, areaSqm: 100,   // base build 10,000,000p
      contingency: [
        { name: 'general', pct: 5 },
        { name: 'existing_building', pct: 15 },
        { name: 'abnormal', pct: 0 },
      ],
    });
    const result = computeCostPlan(inputs, 100, 1);
    const existing = result.contingency.find((c) => c.name === 'existing_building');
    expect(existing?.base_pence).toBe(10_000_000);
    expect(existing?.amount_pence).toBe(1_500_000);
    expect(existing?.basis).toBe('all_packages');
  });

  it('gives general the whole base build in detailed mode, tagged or not', () => {
    const inputs = detailedCostPlanDocument({
      packages: [
        { id: 'p1', code: 'structure', amount_pence: 1_000_000, contingency_class: 'existing_building' },
        { id: 'p2', code: 'externals', amount_pence: 7_000_000, contingency_class: 'abnormal' },
      ],
      contingency: [{ name: 'general', pct: 5 }, { name: 'existing_building', pct: 0 }, { name: 'abnormal', pct: 0 }],
    });
    const result = computeCostPlan(inputs, 100, 1);
    const general = result.contingency.find((c) => c.name === 'general');
    expect(general?.base_pence).toBe(8_000_000);
    expect(general?.basis).toBe('all_packages');
  });
});

describe('computeCostPlan — fee bases never include fees', () => {
  it('resolves pct_of_construction_total against cost only, not against other fees', () => {
    // base_build 2,000,000; general contingency 10% = 200,000; compliance 0
    // (detailed mode) -> construction_total 2,200,000.
    // Architect at 6% of construction total = 132,000.
    // A large fixed fee of 9,000,000 is present precisely so that a defect
    // which folded fees into the base would produce 672,000 instead of 132,000.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000)],
        contingency: CLASSES(10, 0, 0),
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'pct_of_construction_total', amount_pence: 0, pct: 6, per_dwelling: false, vat_override: null,
            phase_id: null },
          { id: 'f2', code: 'other_professional', category: 'professional', label: 'PM',
            basis: 'fixed', amount_pence: 9_000_000, pct: 0, per_dwelling: false, vat_override: null,
            phase_id: null },
        ],
      }),
      0, 1,
    );
    expect(r.construction_total_pence).toBe(2_200_000);
    expect(r.fees[0].base_pence).toBe(2_200_000);
    expect(r.fees[0].amount_pence).toBe(132_000);
    expect(r.professional_total_pence).toBe(9_132_000);
  });

  it('resolves pct_of_base_build against the base build, excluding contingency', () => {
    // base_build 2,000,000, contingency 10% -> the two bases differ by 200,000.
    // 6% of 2,000,000 = 120,000, against 132,000 on the other basis.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000)],
        contingency: CLASSES(10, 0, 0),
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'pct_of_base_build', amount_pence: 0, pct: 6, per_dwelling: false, vat_override: null,
            phase_id: null },
        ],
      }),
      0, 1,
    );
    expect(r.fees[0].base_pence).toBe(2_000_000);
    expect(r.fees[0].amount_pence).toBe(120_000);
  });

  it('multiplies a per_dwelling fixed fee by unit count and splits categories', () => {
    // prior approval 9,600 x 4 dwellings = 38,400, STATUTORY.
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 1_000_000)],
        contingency: CLASSES(0, 0, 0),
        fee_lines: [
          { id: 'f1', code: 'prior_approval', category: 'statutory', label: 'Prior approval',
            basis: 'fixed', amount_pence: 9_600, pct: 0, per_dwelling: true, vat_override: null,
            phase_id: null },
          { id: 'f2', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'fixed', amount_pence: 1_500_000, pct: 0, per_dwelling: false, vat_override: null,
            phase_id: null },
        ],
      }),
      0, 4,
    );
    expect(r.statutory_total_pence).toBe(38_400);
    expect(r.professional_total_pence).toBe(1_500_000);
  });
});

describe('computeCostPlan — detailed mode drops compliance to zero', () => {
  it('ignores the compliance fields entirely in detailed mode', () => {
    // Validation rejects this document (Task 10), but the ENGINE must not
    // double count if it ever sees one: compliance is 0 in detailed mode.
    const r = computeCostPlan(
      doc({ mode: 'detailed', packages: [pkg('p1', 1_000_000)], contingency: CLASSES(0, 0, 0) },
          { fire_safety_pence: 250_000 }),
      0, 1,
    );
    expect(r.compliance_pence).toBe(0);
    expect(r.construction_total_pence).toBe(1_000_000);
  });
});

describe('computeCostPlan — a pre-v7 document keeps its own figures', () => {
  it('derives the plan from the legacy cost fields, not from DEFAULT_COST_PLAN', () => {
    // The exact defect this guards: DEFAULT_COST_PLAN has no fee lines and a
    // hardcoded 10% contingency, so a v6 document would report zero professional
    // fees and the wrong contingency once the schedule reads these totals.
    // Contingency 15% (not the 10% default) and architect 1,500,000 are both
    // chosen so the wrong fallback produces visibly wrong numbers.
    //
    // DEFAULT_CONVERSION_COSTS carries non-zero defaults for every fee field
    // (structural_engineer_pence, mande_pence, planning_consultant_pence,
    // prior_approval_fee_per_dwelling_pence), so every fee field other than
    // architect/building_control is zeroed here too — otherwise the totals
    // below would include figures this test never mentions.
    const v6 = defaultCalculatorInputsV6();
    v6.conversion_costs = {
      ...v6.conversion_costs,
      construction_cost_per_sqm_pence: 10_000,
      contingency_pct: 15,
      architect_pence: 1_500_000,
      structural_engineer_pence: 0,
      mande_pence: 0,
      planning_consultant_pence: 0,
      other_professional_fees_pence: 0,
      building_control_pence: 200_000,
      prior_approval_fee_per_dwelling_pence: 0,
      cil_s106_pence: 0,
      fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    };
    const r = computeCostPlan(v6, 400, 1);
    expect(r.base_build_pence).toBe(4_000_000);
    expect(r.contingency[0].pct).toBe(15);
    expect(r.contingency_total_pence).toBe(600_000);   // 15% of 4,000,000
    expect(r.professional_total_pence).toBe(1_500_000);
    expect(r.statutory_total_pence).toBe(200_000);
  });
});

describe('computeCostPlan — reported extras', () => {
  it('reports the lender-eligible base and the implied rate', () => {
    // eligible = p1 only (2,000,000); implied rate = 3,000,000 / 500 = 6,000 p/m2
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000), pkg('p2', 1_000_000, { lender_eligible: false })],
        contingency: CLASSES(0, 0, 0),
      }),
      500, 1,
    );
    expect(r.lender_eligible_base_pence).toBe(2_000_000);
    expect(r.implied_rate_pence_per_sqm).toBe(6_000);
  });

  // R14 spec §5. The ratio the ledger's §4.2(b) cap base reads. Unrounded:
  // 2,000,000 / 3,000,000 is exactly 2/3, and the ONE rounding happens later,
  // on `construction_pence × ratio` inside the ledger.
  it('reports the lender-eligible ratio as the unrounded eligible share of base build', () => {
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000), pkg('p2', 1_000_000, { lender_eligible: false })],
        contingency: CLASSES(0, 0, 0),
      }),
      500, 1,
    );
    expect(r.lender_eligible_ratio).toBe(2 / 3);
    expect(r.lender_eligible_ratio).not.toBe(Math.round(2 / 3));
  });

  it('reports a lender-eligible ratio of 1 when every package is eligible', () => {
    const r = computeCostPlan(
      doc({
        mode: 'detailed',
        packages: [pkg('p1', 2_000_000), pkg('p2', 1_000_000)],
        contingency: CLASSES(0, 0, 0),
      }),
      500, 1,
    );
    expect(r.lender_eligible_ratio).toBe(1);
  });

  // Headline mode has no packages at all, so `lender_eligible_base_pence` is 0
  // against a NON-zero base build — the one case where the raw quotient (0)
  // would silently zero the ledger's whole construction cap base.
  it('reports a lender-eligible ratio of 1 in headline mode, where there are no packages ' +
    'to flag and the eligible base is therefore 0', () => {
    const r = computeCostPlan(
      doc({ mode: 'headline', packages: [], contingency: CLASSES(0, 0, 0) },
          { construction_cost_per_sqm_pence: 80_730 }),
      500, 1,
    );
    expect(r.packages).toHaveLength(0);
    expect(r.base_build_pence).toBe(40_365_000);
    expect(r.lender_eligible_base_pence).toBe(0);
    expect(r.base_build_pence).toBeGreaterThan(0);
    expect(r.lender_eligible_ratio).toBe(1);
  });

  // R14 fix round 1. The `!detailed` half of the guard, pinned on its own: a
  // headline document CAN carry stray packages (apply-scenario.ts scales them
  // regardless of mode, and `lender_eligible_base_pence` sums them regardless of
  // mode), so `baseBuild === 0` is NOT what saves headline mode here. Base build
  // is the rate × area product, the eligible base is 3,000,000 of a 4,000,000
  // package sum, and the quotient would be neither 1 nor even meaningful — the
  // packages are not the base. Only `!detailed` gives the right answer.
  it('reports a lender-eligible ratio of 1 in headline mode even when stray packages ' +
    'are present and one of them is ineligible', () => {
    const r = computeCostPlan(
      doc({
        mode: 'headline',
        packages: [pkg('p1', 3_000_000), pkg('p2', 1_000_000, { lender_eligible: false })],
        contingency: CLASSES(0, 0, 0),
      }, { construction_cost_per_sqm_pence: 80_730 }),
      500, 1,
    );
    expect(r.packages).toHaveLength(2);
    expect(r.base_build_pence).toBe(40_365_000);        // rate × area, not the package sum
    expect(r.lender_eligible_base_pence).toBe(3_000_000);
    expect(r.lender_eligible_ratio).toBe(1);
    // Not the raw quotient, which would be a nonsense 0.0743…
    expect(r.lender_eligible_ratio).not.toBe(3_000_000 / 40_365_000);
  });

  it('reports a lender-eligible ratio of 1 in detailed mode when base build is 0 ' +
    '(no division by zero)', () => {
    const r = computeCostPlan(
      doc({ mode: 'detailed', packages: [], contingency: CLASSES(0, 0, 0) }),
      500, 1,
    );
    expect(r.base_build_pence).toBe(0);
    expect(r.lender_eligible_ratio).toBe(1);
  });

  it('returns a null implied rate when the area is zero', () => {
    const r = computeCostPlan(
      doc({ mode: 'detailed', packages: [pkg('p1', 2_000_000)], contingency: CLASSES(0, 0, 0) }),
      0, 1,
    );
    expect(r.implied_rate_pence_per_sqm).toBeNull();
  });
});

// R15 spec §23.6. Fixture Y (docs/... y-derivation.md) is fixture X
// (fixtures/financial-model/x-unit-sales-ledger.json) with the evidence layer
// added and no money field changed. Task 4 runs BEFORE Task 3, so the shared
// `ddDoc`/fixture-Y builders do not exist yet — this is a local, task-scoped
// equivalent covering only the cost-plan additions (`cost_plan.qs`,
// per-package `price_basis`) fixture Y carries. Twin of
// `_y_cost_plan_doc` in tests/test_cost_plan.py.
const FIXTURE_DIR_Y = resolve(__dirname, '../../../../fixtures/financial-model');

function rawXForY(): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(resolve(FIXTURE_DIR_Y, 'x-unit-sales-ledger.json'), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  return JSON.parse(JSON.stringify(parsed.inputs)) as Record<string, unknown>;
}

const Y_QS: QsProvenance = {
  source: 'Gardiner & Theobald', stage: 'riba_3', date: '2026-08-01',
  status: 'issued', base_date: '2026-07-01', inflation: null,
};
const Y_PRICE_BASIS: Record<string, PriceBasis | null> = {
  'pkg-structure': 'fixed_price', 'pkg-envelope': 'provisional_sum', 'pkg-mande': null,
};

interface YCostPlanDocOverrides {
  qs?: QsProvenance | null;
  price_basis?: Record<string, PriceBasis | null>;
  mode?: 'headline' | 'detailed';
}

function yCostPlanDoc(overrides: YCostPlanDocOverrides = {}): CalculatorInputsV13 {
  const v13 = migrateInputsToV13(rawXForY());
  const plan = JSON.parse(JSON.stringify(v13)) as CalculatorInputsV13;

  plan.cost_plan.qs = 'qs' in overrides ? overrides.qs ?? null : { ...Y_QS };

  const basis: Record<string, PriceBasis | null> = { ...Y_PRICE_BASIS, ...overrides.price_basis };
  plan.cost_plan.packages = plan.cost_plan.packages.map((p) => ({
    ...p, price_basis: basis[p.id] ?? null,
  }));

  if (overrides.mode) {
    plan.cost_plan.mode = overrides.mode;
    if (overrides.mode === 'headline') plan.cost_plan.packages = [];
  }

  return plan;
}

describe('computeCostPlan — price-basis summary and QS provenance (R15 spec §23.6)', () => {
  it('reports the price-basis summary by hand on fixture Y', () => {
    const r = runAppraisal(yCostPlanDoc()).metrics.cost_plan;
    const pb = r.price_basis!;
    expect([pb.fixed_price_pence, pb.provisional_sums_pence, pb.estimate_pence, pb.unclassified_pence])
      .toEqual([12_000_000, 8_000_000, 0, 6_000_000]);
    expect([pb.fixed_price_coverage_pct, pb.provisional_sums_pct]).toEqual([46.15, 30.77]);
    expect(r.qs).toEqual({
      source: 'Gardiner & Theobald', stage: 'riba_3', date: '2026-08-01',
      status: 'issued', base_date: '2026-07-01', inflation: null,
    });
  });

  it('moves coverage by its share when the null package is classified', () => {
    const pb = runAppraisal(yCostPlanDoc({ price_basis: { 'pkg-mande': 'fixed_price' } }))
      .metrics.cost_plan.price_basis!;
    expect([pb.fixed_price_pence, pb.unclassified_pence, pb.fixed_price_coverage_pct])
      .toEqual([18_000_000, 0, 69.23]);
    const pb2 = runAppraisal(yCostPlanDoc({ price_basis: { 'pkg-mande': 'estimate' } }))
      .metrics.cost_plan.price_basis!;
    expect([pb2.estimate_pence, pb2.unclassified_pence]).toEqual([6_000_000, 0]);
  });

  it('publishes no price basis and no QS in headline mode', () => {
    const r = runAppraisal(yCostPlanDoc({ mode: 'headline', qs: null })).metrics.cost_plan;
    expect(r.price_basis).toBeNull();
    expect(r.qs).toBeNull();
  });
});

// R15b spec §24.3. Fixture Z (docs/superpowers/plans/2026-08-25-r15b-cost-plan-in-time.md,
// "Hand-derived figures for fixture Z") is fixture S (fixtures/financial-model/
// s-dated-programme.json) plus a QS provenance record carrying a tender-price
// inflation allowance, a new `mande_fitout` phase carrying pkg-mande's spend,
// per-package price basis tags, a VAT override on pkg-externals and an extra
// pct-of-construction-total fee line — see `docZ()` in
// `__fixtures__/cost-plan-in-time-docs.ts`. Every figure below is copied
// verbatim from the task brief's hand-derived worksheet, not recomputed.
// Twin of `TestInflation` in tests/test_cost_plan.py.
describe('R15b spec §24.3 inflation', () => {
  it('Z: every package\'s months, factor and pence by hand; the total is the sum of rounded lines', () => {
    const cp = computeCostPlan(docZ(), 600, 4);   // developedAreaSqm(docZ()) is 600 (S's manual area); unit count 4
    const by = Object.fromEntries(cp.packages.map((p) => [p.id, p]));
    expect(by['pkg-enabling']).toMatchObject({
      resolved_phase_id: 'strip_out', start_month: 6, finish_month: 8, midpoint_month: 6.5,
      months_from_base: 12.5, inflation_pence: 375_460,
    });
    expect(by['pkg-structure']).toMatchObject({ months_from_base: 16.5, inflation_pence: 2_002_003 });
    expect(by['pkg-envelope'].inflation_pence).toBe(1_501_502);
    expect(by['pkg-externals'].inflation_pence).toBe(500_501);
    expect(by['pkg-mande'].months_from_base).toBeCloseTo(18 + 1 / 3, 10);
    expect(by['pkg-mande'].inflation_pence).toBe(1_117_256);
    expect(by['pkg-structure'].inflation_factor).toBeCloseTo(1.0834167976, 9);
    expect(cp.inflation_total_pence).toBe(5_496_722);
    expect(cp.latest_midpoint_month).toBeCloseTo(74 / 6, 10);
    expect(cp.latest_midpoint_months_from_base).toBeCloseTo(18 + 1 / 3, 10);
    // The two whole-figure pins a generator may print alone (R15's lesson —
    // spec §24.3's own Interfaces note).
    expect(cp.inflation_pct_of_base_build).toBe(8.33);
    expect(cp.latest_midpoint_whole_months_from_base).toBe(18);
  });

  it('Z: the stack — base build uninflated, contingency on the uninflated base, ' +
    'construction total carries the line, the pct fee follows it', () => {
    const cp = computeCostPlan(docZ(), 600, 4);
    expect(cp.base_build_pence).toBe(66_000_000);
    expect(cp.contingency.find((c) => c.name === 'general'))
      .toMatchObject({ base_pence: 66_000_000, amount_pence: 3_300_000 });
    expect(cp.construction_total_pence).toBe(74_796_722);
    expect(cp.fees.find((f) => f.id === 'fee-pm'))
      .toMatchObject({ base_pence: 74_796_722, amount_pence: 747_967 });
    expect(cp.professional_total_pence).toBe(8_747_967);
    expect(cp.lender_eligible_base_pence).toBe(60_000_000);
    expect(cp.price_basis!.fixed_price_coverage_pct).toBe(72.73);
  });

  it('no allowance: pence 0, factor null, but months_from_base and the latest-midpoint ' +
    'fields are still published', () => {
    const cp = computeCostPlan(docZNoAllowance(), 600, 4);
    expect(cp.inflation_total_pence).toBe(0);
    expect(cp.construction_total_pence).toBe(69_300_000);
    expect(cp.packages.every((p) => p.inflation_pence === 0 && p.inflation_factor === null)).toBe(true);
    expect(cp.packages.find((p) => p.id === 'pkg-enabling')!.months_from_base).toBe(12.5);
    expect(cp.latest_midpoint_months_from_base).toBeCloseTo(18 + 1 / 3, 10);
    // The same two whole-figure fields the allowance twin pins above — the
    // months are unaffected by the allowance, only the pence and the pct are.
    expect(cp.inflation_pct_of_base_build).toBe(0);
    expect(cp.latest_midpoint_whole_months_from_base).toBe(18);
  });

  it('the midpoint is amount-independent: doubling a package moves its inflation, never its midpoint', () => {
    const d = docZ();
    d.cost_plan.packages[1].amount_pence *= 2;
    const a = computeCostPlan(docZ(), 600, 4).packages[1];
    const b = computeCostPlan(d, 600, 4).packages[1];
    expect(b.midpoint_month).toBe(a.midpoint_month);
    expect(b.inflation_factor).toBe(a.inflation_factor);
    expect(b.inflation_pence).not.toBe(a.inflation_pence);
  });

  it('floor at zero: a base date after every midpoint gives months 0, factor 1, pence 0 ' +
    '— and the unfloored value is negative', () => {
    const d = docZ();
    d.cost_plan.qs!.base_date = '2028-06-01';   // 22 months after acquisition; every midpoint < 13
    const cp = computeCostPlan(d, 600, 4);
    expect(cp.packages.every((p) => p.months_from_base === 0 && p.inflation_factor === 1 && p.inflation_pence === 0))
      .toBe(true);
    expect(monthsBetween('2028-06-01', '2026-08-01') + 12.5).toBeLessThan(0);
  });

  it('blank base_date (after trim): no months, no inflation, even with acquisition_date ' +
    'and an allowance both present', () => {
    const d = docZ();
    d.cost_plan.qs!.base_date = '   ';
    const cp = computeCostPlan(d, 600, 4);
    expect(cp.inflation_total_pence).toBe(0);
    expect(cp.packages.every((p) => p.months_from_base === null && p.inflation_factor === null)).toBe(true);
    expect(cp.latest_midpoint_months_from_base).toBeNull();
    // The midpoint itself is unaffected -- only the distance FROM the base is unknown.
    expect(cp.latest_midpoint_month).toBeCloseTo(74 / 6, 10);
  });

  // Z's own 6% allowance rounds its sum-of-lines to the SAME figure as
  // rounding the raw sum (5,496,722 both ways — the previous "by hand" test),
  // so it cannot discriminate the two roundings. Verified with Math.pow
  // before writing this test: 7% does discriminate on Z's five windows (8%
  // was not needed) — the five ROUNDED lines sum to 6,424,687p, one penny
  // above money-rounding the raw (unrounded) sum, 6,424,686p.
  it('rounded lines, not a rounded sum', () => {
    const d = docZ();
    d.cost_plan.qs!.inflation = { annual_pct: 7 };
    const cp = computeCostPlan(d, 600, 4);
    const sumOfRoundedLines = cp.packages.reduce((s, p) => s + p.inflation_pence, 0);
    const roundedSumOfRawProducts = Math.round(
      cp.packages.reduce((s, p) => s + p.amount_pence * (p.inflation_factor! - 1), 0),
    );
    expect(cp.inflation_total_pence).toBe(sumOfRoundedLines);
    expect(cp.inflation_total_pence).toBe(6_424_687);
    expect(roundedSumOfRawProducts).toBe(6_424_686);
    expect(cp.inflation_total_pence).not.toBe(roundedSumOfRawProducts);
  });

  // R16 minor: a raw stored document may have a `qs` object with no
  // `base_date` key at all (not merely blank), e.g. hand-edited or from a
  // future schema this document predates. The read must not assume the key
  // exists.
  it('missing base_date key entirely: computeCostPlan does not throw and treats the ' +
    'base date as absent', () => {
    const d = docZ();
    delete (d.cost_plan.qs as unknown as Record<string, unknown>).base_date;
    const cp = computeCostPlan(d, 600, 4);
    expect(cp.packages[0].months_from_base).toBeNull();
  });

  it('acquisition_date null: no months, no inflation — computeCostPlan does not throw ' +
    '(validation owns the error)', () => {
    const d = docZ();
    d.acquisition.acquisition_date = null;
    const cp = computeCostPlan(d, 600, 4);
    expect(cp.inflation_total_pence).toBe(0);
    expect(cp.packages[0].months_from_base).toBeNull();
    expect(cp.latest_midpoint_months_from_base).toBeNull();
  });

  it('headline mode: no timing, no inflation fields beyond their zero/null seeds', () => {
    const cp = computeCostPlan(headlineCostPlanDocument({ constructionPerSqm: 80_730 }), 500, 1);
    expect(cp.packages).toHaveLength(0);
    expect(cp.inflation_total_pence).toBe(0);
    expect(cp.inflation_pct_of_base_build).toBe(0);
    expect(cp.latest_midpoint_month).toBeNull();
    expect(cp.latest_midpoint_months_from_base).toBeNull();
    expect(cp.latest_midpoint_whole_months_from_base).toBeNull();
  });
});
