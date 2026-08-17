import { describe, it, expect } from 'vitest';
import {
  CLASS_MA_AXES,
  normaliseAxis,
  ndssPassPct,
  computeSpider,
  scenarioColor,
  SCENARIO_COLORS,
  HARD_GATE_KEYS,
} from './deal-spider';
import { defaultCalculatorInputsV2 } from './conversion-defaults';
import { applyScenario } from './model/apply-scenario';
import { runAppraisal } from './model';
import { migrateInputsToV5 } from './model';
import { calculateAcquisitionTax } from './tax/acquisition-tax';
import type { CalculatorInputsV2 } from './model';
import type { EligibilityAssessment, EligibilityCriterion } from '../types';

// ── Fixtures ─────────────────────────────────────────────

function fixtureInputs(): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.acquisition.purchase_price_pence = 50_000_000; // £500k
  inputs.unit_mix.units = [
    { id: 'u1', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 32_000_000, comparable_notes: '' },
    { id: 'u2', type: '1bed', floor_area_sqm: 52, estimated_value_pence: 24_000_000, comparable_notes: '' },
    { id: 'u3', type: 'studio', floor_area_sqm: 39, estimated_value_pence: 18_000_000, comparable_notes: '' },
  ];
  inputs.conversion_costs.total_construction_sqm = 160;
  return inputs;
}

function criterion(partial: Partial<EligibilityCriterion> & { key: string }): EligibilityCriterion {
  return {
    label: partial.key,
    passed: true,
    source: null,
    auto_checked: false,
    value: null,
    risk_flag: null,
    ...partial,
  };
}

function fixtureAssessment(criteria: EligibilityCriterion[]): EligibilityAssessment {
  return {
    id: 'a1',
    project_id: 'p1',
    pdr_class: 'class_ma',
    ruleset_version: 'gpdo-2026-08.2',
    criteria,
    verdict: 'green',
    suggested_next_steps: [],
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const ALL_PASS = fixtureAssessment([
  criterion({ key: 'use_class_check' }),
  criterion({ key: 'floor_area_limit' }),
  criterion({ key: 'article_4' }),
  criterion({ key: 'listed_building' }),
  criterion({ key: 'vacancy_period' }),
  criterion({ key: 'natural_light' }),
]);

function axisResult(inputs: CalculatorInputsV2, id: string, eligibility: EligibilityAssessment | null = ALL_PASS) {
  const result = computeSpider(inputs, eligibility);
  const axis = result.axes.find((a) => a.id === id);
  if (!axis) throw new Error(`axis ${id} missing`);
  return axis;
}

// ── Axis definitions ─────────────────────────────────────

describe('CLASS_MA_AXES', () => {
  it('defines exactly 9 axes, each with a help string and direction', () => {
    expect(CLASS_MA_AXES).toHaveLength(9);
    for (const axis of CLASS_MA_AXES) {
      expect(axis.help.length).toBeGreaterThan(20);
      expect(['higher', 'lower']).toContain(axis.direction);
      expect(axis.max).toBeGreaterThan(axis.min);
    }
  });
});

// ── Normalisation ────────────────────────────────────────

describe('normaliseAxis', () => {
  const higher = { min: 0, max: 20, direction: 'higher' as const };
  const lower = { min: 6, max: 18, direction: 'lower' as const };

  it('maps min→0, max→5, midpoint→2.5 when higher is better', () => {
    expect(normaliseAxis(higher, 0)).toBe(0);
    expect(normaliseAxis(higher, 20)).toBe(5);
    expect(normaliseAxis(higher, 10)).toBe(2.5);
  });

  it('inverts when lower is better', () => {
    expect(normaliseAxis(lower, 6)).toBe(5);
    expect(normaliseAxis(lower, 18)).toBe(0);
  });

  it('clamps out-of-range values to the 0–5 band', () => {
    expect(normaliseAxis(higher, -10)).toBe(0);
    expect(normaliseAxis(higher, 100)).toBe(5);
    expect(normaliseAxis(lower, 2)).toBe(5);
    expect(normaliseAxis(lower, 40)).toBe(0);
  });
});

// ── NDSS ─────────────────────────────────────────────────

describe('ndssPassPct', () => {
  it('scores each unit against its NDSS minimum (studio 37, 1bed 50, 2bed 61, 3bed 74)', () => {
    const pct = ndssPassPct([
      { id: 'u1', type: '1bed', floor_area_sqm: 46, estimated_value_pence: 0, comparable_notes: '' }, // fail
      { id: 'u2', type: '2bed', floor_area_sqm: 61, estimated_value_pence: 0, comparable_notes: '' }, // pass
      { id: 'u3', type: 'studio', floor_area_sqm: 37, estimated_value_pence: 0, comparable_notes: '' }, // pass
    ]);
    expect(pct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it('returns 0 for an empty unit mix', () => {
    expect(ndssPassPct([])).toBe(0);
  });
});

// ── Eligibility gate ─────────────────────────────────────

describe('prior approval axis and the hard gate', () => {
  it('blocks the overall score when a hard gate fails, naming the check', () => {
    const assessment = fixtureAssessment([
      criterion({ key: 'use_class_check' }),
      criterion({ key: 'article_4', label: 'Not in Article 4 direction area', passed: false }),
    ]);
    const result = computeSpider(fixtureInputs(), assessment);
    expect(result.blocked).toBe(true);
    expect(result.rag).toBe('blocked');
    expect(result.overall).toBeNull();
    expect(result.blockedBy).toContain('Not in Article 4 direction area');
    expect(result.axes.find((a) => a.id === 'prior_approval')!.score).toBe(0);
  });

  it('treats every hard-gate key as blocking', () => {
    for (const key of HARD_GATE_KEYS) {
      const assessment = fixtureAssessment([criterion({ key, passed: false })]);
      expect(computeSpider(fixtureInputs(), assessment).blocked).toBe(true);
    }
  });

  it('does not block on a soft criterion failing', () => {
    const assessment = fixtureAssessment([
      criterion({ key: 'use_class_check' }),
      criterion({ key: 'natural_light', passed: false }),
    ]);
    expect(computeSpider(fixtureInputs(), assessment).blocked).toBe(false);
  });

  it('caps the axis at 2 and marks it provisional when article_4 is unverified', () => {
    const assessment = fixtureAssessment([
      criterion({ key: 'use_class_check' }),
      criterion({ key: 'floor_area_limit' }),
      criterion({ key: 'listed_building' }),
      criterion({ key: 'article_4', passed: null }),
    ]);
    const result = computeSpider(fixtureInputs(), assessment);
    const axis = result.axes.find((a) => a.id === 'prior_approval')!;
    expect(axis.score).toBeLessThanOrEqual(2);
    expect(axis.provisional).toBe(true);
    expect(result.caveats.length).toBeGreaterThan(0);
    expect(result.blocked).toBe(false);
  });

  it('scores full marks when everything passes', () => {
    const axis = axisResult(fixtureInputs(), 'prior_approval', ALL_PASS);
    expect(axis.score).toBe(5);
    expect(axis.provisional).toBe(false);
  });

  it('is provisional and capped when no assessment exists', () => {
    const result = computeSpider(fixtureInputs(), null);
    const axis = result.axes.find((a) => a.id === 'prior_approval')!;
    expect(axis.provisional).toBe(true);
    expect(axis.score).toBeLessThanOrEqual(2);
    expect(result.blocked).toBe(false);
  });
});

// ── Derived axes ─────────────────────────────────────────

describe('margin resilience axis', () => {
  it('uses profit on cost under the saved downside scenario, not base case', () => {
    const inputs = fixtureInputs();
    const downside = runAppraisal(applyScenario(inputs, inputs.scenarios.downside)).metrics;
    const axis = axisResult(inputs, 'margin_resilience');
    expect(axis.raw).toBeCloseTo(downside.profit_on_cost_pct ?? 0, 3);
  });
});

describe('deliverability axis', () => {
  it('is the lower of NDSS pass rate and the manual daylight pass rate', () => {
    const inputs = fixtureInputs(); // all three units pass NDSS
    inputs.deal_spider.daylight_pass_pct = 60;
    expect(axisResult(inputs, 'deliverability').raw).toBe(60);
  });
});

describe('building safety axis', () => {
  it('scores 0 for a higher-risk building (≥18m or ≥7 storeys or flagged)', () => {
    const flagged = fixtureInputs();
    flagged.deal_spider.bsa_higher_risk = true;
    expect(axisResult(flagged, 'building_safety').score).toBe(0);

    const tall = fixtureInputs();
    tall.deal_spider.building_height_m = 19;
    expect(axisResult(tall, 'building_safety').score).toBe(0);

    const manyStoreys = fixtureInputs();
    manyStoreys.deal_spider.storeys = 7;
    expect(axisResult(manyStoreys, 'building_safety').score).toBe(0);
  });

  it('scores 5 for a low-rise building and midway for 11–18m', () => {
    const low = fixtureInputs();
    low.deal_spider.building_height_m = 9;
    low.deal_spider.storeys = 3;
    expect(axisResult(low, 'building_safety').score).toBe(5);

    const mid = fixtureInputs();
    mid.deal_spider.building_height_m = 14;
    mid.deal_spider.storeys = 4;
    expect(axisResult(mid, 'building_safety').score).toBe(3);
  });
});

describe('tax advantage axis', () => {
  it('captures SDLT saving + VAT saving + CIL offset as % of GDV', () => {
    const inputs = fixtureInputs();
    inputs.deal_spider.cil_offset_pence = 1_000_000;
    const metrics = runAppraisal(inputs).metrics;
    const resSdlt = calculateAcquisitionTax({
      consideration_pence: inputs.acquisition.purchase_price_pence,
      jurisdiction: 'england_ni', basis: 'residential_higher', date: null,
    }).total_pence;
    const commSdlt = calculateAcquisitionTax({
      consideration_pence: inputs.acquisition.purchase_price_pence,
      jurisdiction: 'england_ni', basis: 'non_residential', date: null,
    }).total_pence;
    const vatSaving = Math.round(metrics.construction_cost_pence * 0.15);
    const expected =
      ((resSdlt - commSdlt + vatSaving + 1_000_000) / metrics.gdv_pence) * 100;
    expect(axisResult(inputs, 'tax_advantage').raw).toBeCloseTo(expected, 3);
  });

  // Spec §11.10: the 15% construction-VAT saving folded into this axis must
  // never be presented as anything other than an unconfirmed illustration.
  it('is flagged illustrative with an UNCONFIRMED VAT caveat in its help text', () => {
    const def = CLASS_MA_AXES.find((d) => d.id === 'tax_advantage')!;
    expect(def.illustrative).toBe(true);
    expect(def.help).toContain('UNCONFIRMED');
    expect(def.help).toContain('excluded from the appraisal and all lender metrics');
  });

  it('no other axis is marked illustrative', () => {
    const others = CLASS_MA_AXES.filter((d) => d.id !== 'tax_advantage');
    for (const def of others) {
      expect(def.illustrative).toBeFalsy();
    }
  });
});

describe('tax advantage is computed within one regime (R8)', () => {
  it('is unchanged for an English appraisal', () => {
    const inputs = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    inputs.acquisition.purchase_price_pence = 75_348_200;
    const residential = calculateAcquisitionTax({
      consideration_pence: 75_348_200, jurisdiction: 'england_ni',
      basis: 'residential_higher', date: null,
    }).total_pence;
    expect(residential).toBe(6_534_820); // the pre-R8 residential-sdlt figure
    expect(() => computeSpider(inputs, null)).not.toThrow();
  });

  it('uses Welsh bands on both sides for a Welsh appraisal', () => {
    const eng = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    eng.acquisition.purchase_price_pence = 75_348_200;
    // A non-zero GDV so the axis isn't short-circuited to 0 by the
    // `metrics.gdv_pence > 0` guard before the jurisdiction can matter.
    eng.unit_mix.units = [
      { id: 'u1', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 32_000_000, comparable_notes: '' },
      { id: 'u2', type: '1bed', floor_area_sqm: 52, estimated_value_pence: 24_000_000, comparable_notes: '' },
      { id: 'u3', type: 'studio', floor_area_sqm: 39, estimated_value_pence: 18_000_000, comparable_notes: '' },
    ];
    eng.conversion_costs.total_construction_sqm = 160;
    const wal = migrateInputsToV5(
      JSON.parse(JSON.stringify(eng)) as Record<string, unknown>,
    );
    wal.acquisition.jurisdiction = 'wales';
    // Wales's residential-higher and non-residential bands both differ from
    // England's, so the axis must move. If it does not, the jurisdiction is
    // not reaching the comparison.
    const engAxis = computeSpider(eng, null).axes.find((a) => a.id === 'tax_advantage')!;
    const walAxis = computeSpider(wal, null).axes.find((a) => a.id === 'tax_advantage')!;
    expect(walAxis.raw).not.toBe(engAxis.raw);
  });
});

describe('programme axis', () => {
  it('totals prior approval window + facility term + contingency', () => {
    const inputs = fixtureInputs();
    inputs.deal_spider.prior_approval_window_months = 2;
    inputs.deal_spider.programme_contingency_months = 1;
    inputs.finance.term_months = 12;
    expect(axisResult(inputs, 'programme').raw).toBe(15);
  });
});

describe('exit optionality axis', () => {
  it('counts ticked exit routes out of four', () => {
    const inputs = fixtureInputs();
    inputs.deal_spider.exit_sell = true;
    inputs.deal_spider.exit_refinance = true;
    inputs.deal_spider.exit_hold = false;
    inputs.deal_spider.exit_part_sale = false;
    expect(axisResult(inputs, 'exit_optionality').raw).toBe(2);
  });
});

describe('acquisition headroom axis', () => {
  it('measures cushion between max bid (RLV at target return) and purchase price', () => {
    const inputs = fixtureInputs();
    inputs.deal_spider.target_profit_on_cost_pct = 20;
    const metrics = runAppraisal(inputs).metrics; // rlv_pence is at 20% PoC
    const expected =
      ((metrics.rlv_pence - inputs.acquisition.purchase_price_pence) / metrics.rlv_pence) * 100;
    expect(axisResult(inputs, 'acquisition_headroom').raw).toBeCloseTo(expected, 3);
  });

  it('exposes the max bid figure on the result', () => {
    const inputs = fixtureInputs();
    inputs.deal_spider.target_profit_on_cost_pct = 20;
    const metrics = runAppraisal(inputs).metrics;
    const result = computeSpider(inputs, ALL_PASS);
    expect(result.max_bid_pence).toBe(metrics.rlv_pence);
  });
});

// ── Overall score ────────────────────────────────────────

describe('overall score and RAG', () => {
  it('is the weighted mean of axis scores on the 0–5 scale', () => {
    const inputs = fixtureInputs();
    const result = computeSpider(inputs, ALL_PASS);
    const manual =
      result.axes.reduce((sum, a) => sum + a.score * a.weight, 0) /
      result.axes.reduce((sum, a) => sum + a.weight, 0);
    expect(result.overall).toBeCloseTo(manual, 6);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(5);
  });

  it('excludes zero-weighted axes from the overall score', () => {
    const inputs = fixtureInputs();
    const before = computeSpider(inputs, ALL_PASS);
    inputs.deal_spider.weights.sales_velocity = 0;
    const after = computeSpider(inputs, ALL_PASS);
    const excluded = before.axes.find((a) => a.id === 'sales_velocity')!;
    const rest = before.axes.filter((a) => a.id !== 'sales_velocity');
    const expected = rest.reduce((s, a) => s + a.score * a.weight, 0) / rest.reduce((s, a) => s + a.weight, 0);
    expect(after.overall).toBeCloseTo(expected, 6);
    expect(excluded.score).toBeGreaterThanOrEqual(0); // axis still reported
  });

  it('maps overall to RAG bands (≥3.5 green, ≥2.5 amber, else red)', () => {
    const inputs = fixtureInputs();
    const result = computeSpider(inputs, ALL_PASS);
    const expected = result.overall! >= 3.5 ? 'green' : result.overall! >= 2.5 ? 'amber' : 'red';
    expect(result.rag).toBe(expected);
  });
});

// ── Scenario colours ─────────────────────────────────────

describe('scenarioColor', () => {
  it('maps preset names to the shared palette', () => {
    expect(scenarioColor('Upside Case', '#000')).toBe(SCENARIO_COLORS.upside);
    expect(scenarioColor('Downside Case', '#000')).toBe(SCENARIO_COLORS.downside);
    expect(scenarioColor('Severe Case', '#000')).toBe(SCENARIO_COLORS.severe);
    expect(scenarioColor('Base Case', '#000')).toBe(SCENARIO_COLORS.base);
  });

  it('falls back for unrecognised names', () => {
    expect(scenarioColor('My Custom Scenario', '#abcdef')).toBe('#abcdef');
  });
});
