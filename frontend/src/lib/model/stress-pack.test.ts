import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAppraisal, computeCostPlan, developedAreaSqm } from './index';
import { applyScenario } from './apply-scenario';
import { migrateInputsToV15 } from './migrate';
import { InvalidBaseDocumentError } from './sensitivity';
import { STRESS_PACK, resolveStress, runStressPack } from './stress-pack';
import { ddDoc } from './__fixtures__/due-diligence-docs';
import { icDoc } from './__fixtures__/investment-case-docs';
import type { StressDefinition } from './stress-pack';
import type { SensitivityLever } from './sensitivity';
import type { AnyCalculatorInputs, CalculatorInputsV15 } from './finance-types';
import type { ScenarioOverrides } from '../conversion-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

function load(stem: string): CalculatorInputsV15 {
  const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  return migrateInputsToV15(doc.inputs);
}

function single(lever: SensitivityLever, value: number): ScenarioOverrides {
  const fieldByLever: Record<string, keyof ScenarioOverrides> = {
    saleable_area: 'saleable_area_adjustment_pct', abnormal_cost: 'abnormal_cost_adjustment_pct',
    programme_slip: 'programme_slip_months', refi_ltv: 'refi_ltv_adjustment_pct',
    sales_slip: 'sales_slip_months', exit_yield: 'exit_yield_adjustment_pct',
    operating_cost: 'operating_cost_adjustment_pct', vacancy: 'vacancy_adjustment_pct',
    construction_cost: 'construction_cost_adjustment_pct',
  };
  const field = fieldByLever[lever];
  // Every field explicit: unlike Python's pydantic ScenarioOverrides, a TS
  // object literal has no runtime default for a field this test doesn't set,
  // and apply-scenario.ts reads several of them (e.g. `sales_slip_months !==
  // 0`) in a way that treats `undefined` as truthy, not as zero.
  const base: ScenarioOverrides = {
    label: '', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0,
    timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
    phase_slip_phase_id: null, phase_slip_months: 0,
    exit_yield_adjustment_pct: 0, operating_cost_adjustment_pct: 0, vacancy_adjustment_pct: 0,
    sales_slip_months: 0, saleable_area_adjustment_pct: 0, abnormal_cost_adjustment_pct: 0,
    programme_slip_months: 0, refi_ltv_adjustment_pct: 0,
  };
  return { ...base, [field]: value };
}

describe('the standard lender stress pack', () => {
  it('is nine entries in the normative order', () => {
    // Fix round 1, Finding 2: pins every key, label AND settings tuple, not
    // just the key order -- so a magnitude or label drift (e.g. sales_slip 6
    // -> 5) fails here rather than passing the whole suite silently.
    expect(STRESS_PACK).toEqual<StressDefinition[]>([
      { key: 'unit_loss', label: 'One unit lost', settings: [['saleable_area', null]] },
      { key: 'area_reduction', label: 'Saleable area -5%', settings: [['saleable_area', -5]] },
      { key: 'abnormal_cost', label: 'Abnormal cost +10%', settings: [['abnormal_cost', 10]] },
      { key: 'slower_absorption', label: 'Sales six months slower', settings: [['sales_slip', 6]] },
      { key: 'delayed_start', label: 'Start / PC six months late', settings: [['programme_slip', 6]] },
      { key: 'yield_expansion', label: 'Exit yield +100 bp', settings: [['exit_yield', 1]] },
      { key: 'lower_refi_ltv', label: 'Refinance LTV -10 pp', settings: [['refi_ltv', 10]] },
      {
        key: 'opex_vacancy', label: 'Opex +10%, vacancy +5 pp',
        settings: [['operating_cost', 10], ['vacancy', 5]],
      },
      {
        key: 'risks_crystallise', label: 'Recorded risks crystallise',
        settings: [['construction_cost', null], ['programme_slip', null]],
      },
    ]);
  });

  it('derives and applies fixture Y correctly (plan table "Base Y", hand-derived)', () => {
    const y = load('y-due-diligence');
    const byKey = Object.fromEntries(STRESS_PACK.map((d) => [d.key, resolveStress(y, d)]));
    expect(byKey.unit_loss.settings[0].value).toBe(-25);
    expect(byKey.unit_loss.applicable).toBe(true);
    const rc = byKey.risks_crystallise;
    expect(rc.applicable).toBe(true);
    expect(rc.note).toBeNull();
    expect(rc.derivation?.cost_impact_pence).toBe(2_550_000);
    expect(rc.derivation?.base_build_pence).toBe(26_000_000);
    expect(rc.derivation?.cost_pct).toBe(9.807692307692);
    expect(rc.derivation?.programme_impact_months).toBe(7);
    expect(rc.derivation?.programme_impact_max_months).toBe(3);
    expect(rc.derivation?.stated_item_count).toBe(4);
    expect(rc.settings.map((s) => [s.lever, s.value])).toEqual([
      ['construction_cost', 9.807692307692], ['programme_slip', 7],
    ]);
    expect(byKey.abnormal_cost.applicable).toBe(false);
    expect(byKey.abnormal_cost.note).toBe(
      'No package carries the abnormal contingency class, so the stress has nothing to attach to.',
    );
    for (const k of ['yield_expansion', 'lower_refi_ltv', 'opex_vacancy'] as const) {
      expect(byKey[k].applicable).toBe(false);
      expect(byKey[k].note).toBe('No investment case is modelled, so there is no take-out to stress.');
    }
    for (const k of ['area_reduction', 'slower_absorption', 'delayed_start'] as const) {
      expect(byKey[k].applicable).toBe(true);
    }
  });

  it('derives and applies fixture U correctly', () => {
    const u = load('u-investment-case-ltv-binds');
    const byKey = Object.fromEntries(STRESS_PACK.map((d) => [d.key, resolveStress(u, d)]));
    expect(byKey.unit_loss.settings[0].value).toBe(-20);
    expect(byKey.abnormal_cost.applicable).toBe(true);
    expect(byKey.slower_absorption.applicable).toBe(false);
    const rc = byKey.risks_crystallise;
    expect(rc.applicable).toBe(false);
    expect(rc.note).toBe(
      'No assessed due-diligence item states a cost impact. '
      + 'No assessed due-diligence item states a programme impact.',
    );
    expect(rc.settings.map((s) => [s.lever, s.value])).toEqual([
      ['construction_cost', 0], ['programme_slip', 0],
    ]);
  });

  it('keeps the risks_crystallise levered build on Y within the stated bound', () => {
    // §25.3: detailed mode, per-package rounding -> |levered - (base + sum)| <= packages.
    const y = load('y-due-diligence');
    const rc = resolveStress(y, STRESS_PACK[STRESS_PACK.length - 1]);
    const levered = applyScenario(y, {
      label: '', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: rc.derivation!.cost_pct!,
      timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
      phase_slip_phase_id: null, phase_slip_months: 0,
      exit_yield_adjustment_pct: 0, operating_cost_adjustment_pct: 0, vacancy_adjustment_pct: 0,
      sales_slip_months: 0, saleable_area_adjustment_pct: 0, abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0, refi_ltv_adjustment_pct: 0,
    });
    const amounts = levered.cost_plan.packages.map((p) => p.amount_pence);
    expect(amounts).toEqual([13_176_923, 8_784_615, 6_588_462]);        // hand-derived
    expect(Math.abs(amounts.reduce((a, b) => a + b, 0) - (26_000_000 + 2_550_000))).toBeLessThanOrEqual(amounts.length);
  });

  it('keeps the risks_crystallise headline bound (Sec 25.3 headline arm)', () => {
    // The lever rounds the RATE, so the bound is ceil(area/2) + 1 pence.
    // Built from icDoc (headline) with two DD items given impacts by hand.
    const doc = migrateInputsToV15(icDoc() as unknown as Record<string, unknown>);
    const items = doc.due_diligence.items;
    items[0].status = 'amber';
    items[0].cost_impact_pence = 1_234_567;
    items[1].status = 'red';
    items[1].cost_impact_pence = 765_433;
    const rc = resolveStress(doc, STRESS_PACK[STRESS_PACK.length - 1]);
    expect(rc.derivation?.cost_impact_pence).toBe(2_000_000);
    const levered = applyScenario(doc, {
      label: '', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: rc.derivation!.cost_pct!,
      timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
      phase_slip_phase_id: null, phase_slip_months: 0,
      exit_yield_adjustment_pct: 0, operating_cost_adjustment_pct: 0, vacancy_adjustment_pct: 0,
      sales_slip_months: 0, saleable_area_adjustment_pct: 0, abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0, refi_ltv_adjustment_pct: 0,
    });
    const area = developedAreaSqm(doc);
    const before = computeCostPlan(doc, area, doc.unit_mix.units.length).base_build_pence;
    const after = computeCostPlan(levered, area, doc.unit_mix.units.length).base_build_pence;
    expect(Math.abs(after - (before + 2_000_000))).toBeLessThanOrEqual(Math.ceil(area / 2) + 1);
  });

  it('an inapplicable stress equals the base, corpus-wide (design decision 11 / guard 3)', () => {
    // The identity every measured stress is defined by (§25.2): a stress
    // cell IS runAppraisal(applyScenario(base, its settings)).
    //
    // Fix round 1, Finding 3: the corpus stems whose base document fails
    // validation are collected and asserted against the known set (currently
    // empty), not skipped one-by-one -- a fixture newly going invalid now
    // fails this test instead of quietly dropping out of coverage.
    const invalidBaseStems = new Set<string>();
    for (const filename of readdirSync(FIXTURE_DIR)) {
      if (!filename.endsWith('.json')) continue;
      const stem = filename.slice(0, -'.json'.length);
      const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, filename), 'utf-8')) as {
        inputs?: Record<string, unknown>;
      };
      if (doc.inputs === undefined) continue; // suite fixture, no inputs of its own
      const inputs = migrateInputsToV15(doc.inputs);
      let result;
      try {
        result = runStressPack(inputs);
      } catch (e) {
        if (e instanceof InvalidBaseDocumentError) {
          invalidBaseStems.add(stem);
          continue;
        }
        throw e;
      }
      for (const s of result.stresses) {
        if (!s.applicable) {
          expect(s.metrics, `${stem} ${s.key}`).toEqual(result.base);
        }
      }
    }
    expect(invalidBaseStems).toEqual(new Set());
  });

  it('every stress is the levered appraisal, on Y and U', () => {
    // Fix round 1, Finding 3: the (stem, key) pairs skipped because the
    // levered position is unmeasured are collected and asserted against the
    // known set, rather than `continue`d unconditionally -- a widening of
    // that set now fails this test instead of silently reducing its
    // assertion count.
    const skipped = new Set<string>();
    for (const stem of ['y-due-diligence', 'u-investment-case-ltv-binds']) {
      const inputs = load(stem);
      const result = runStressPack(inputs);
      for (const s of result.stresses) {
        let levered: AnyCalculatorInputs = inputs;
        for (const setting of s.settings) {
          levered = applyScenario(levered, single(setting.lever, setting.value));
        }
        if (s.metrics.validation_errors.length > 0) {
          // The levered position is unmeasured (§12.7): `measure` never calls
          // `runAppraisal` for it, so there is nothing to compare against.
          // Fixture Y's slower_absorption slip (sales_slip +6) pushes
          // unit_sales row 3's completion to month 26 against a 24-month
          // term, which validateInputs rejects but a raw runAppraisal call
          // does not (it silently computes on the out-of-range month) --
          // same as sensitivity.test.ts's "sales_slip cells go invalid, not
          // clamped" case. The set below has TWO members, and the second has
          // its own cause: fixture U's delayed_start slip (programme_slip +6)
          // adds six months to every predecessor-free phase, pushing U's
          // programme finish from month 21 to month 27 against the same
          // 24-month term -- so the levered network no longer fits the
          // facility financing it ("Phase 'Maturity' ends 3 months after
          // maturity"), and validateInputs rejects that document too.
          skipped.add(`${stem}:${s.key}`);
          continue;
        }
        const expected = runAppraisal(levered).metrics;
        expect(s.metrics.profit_pence, `${stem} ${s.key}`).toBe(expected.profit_pence);
        expect(s.metrics.peak_debt_pence, `${stem} ${s.key}`).toBe(expected.peak_debt_pence);
        expect(s.delta_profit_pence).toBe((expected.profit_pence as number) - result.base.profit_pence);
      }
    }
    expect(skipped).toEqual(new Set([
      'y-due-diligence:slower_absorption',
      'u-investment-case-ltv-binds:delayed_start',
    ]));
  });

  it('matches Base U by hand: abnormal cost and refi LTV', () => {
    // Plan table "Base U": +3,500,000 contingency on an unlevered headline
    // document moves profit by exactly -3,500,000; the LTV cap at 45% is
    // floor(32,407,082 x 45 / 100) = 14,583,186 and still binds.
    const u = load('u-investment-case-ltv-binds');
    const result = runStressPack(u);
    const byKey = Object.fromEntries(result.stresses.map((s) => [s.key, s]));
    expect(byKey.abnormal_cost.delta_profit_pence).toBe(-3_500_000);
    const levered = applyScenario(u, single('refi_ltv', 10));
    const ic = runAppraisal(levered).metrics.investment_case;
    expect(ic?.takeout.ltv_cap_pence).toBe(14_583_186);
    expect(ic?.takeout.quantum_pence).toBe(14_583_186);
    expect(ic?.takeout.binding_constraint).toBe('ltv');
  });

  it('refuses an invalid base document', () => {
    const doc = ddDoc();
    doc.finance.term_months = 0;
    expect(() => runStressPack(doc)).toThrow(InvalidBaseDocumentError);
  });
});
