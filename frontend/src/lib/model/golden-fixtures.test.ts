import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import { validateInputs } from './validation';
import type { ValidationIssue } from './validation';
import {
  migrateInputsToV5, migrateInputsToV6, migrateInputsToV7, migrateInputsToV8,
  migrateInputsToV9, PROGRAMME_FIELD_ALIASES,
} from './migrate';
import { costPlanFromLegacyCosts, computeCostPlan } from './cost-plan';
import { areaBridge } from './areas';
import { VAT_CHARGE_CATEGORIES } from './vat';
import { runSensitivity } from './sensitivity';
import type { SensitivityConfig } from './sensitivity';
import { applyScenario } from './apply-scenario';
import type { AppraisalRun } from './index';
import type { AnyCalculatorInputs, AppraisalResultV2 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

interface Fixture {
  name: string;
  // 'programme' marks a fixture whose `inputs` carry a non-null `programme` block
  // (spec §6.1, calc 2.2.0) — h-programme-scurve.json, Release 3a; 'phased-sales'
  // one whose `inputs` carry a non-null `sales_phasing` block (spec §4.4.1, calc
  // 2.3.0) — i-phased-sales.json, Release 3b; 'refinance' one carrying a non-null
  // `refinance` block (spec §4.5, calc 2.3.0) — j-blended-refinance.json, which
  // carries both blocks and a `blended` exit route. All are labels only: every
  // fixture, whatever its kind, runs through the same `runAppraisal` assertion
  // loop below.
  // 'sensitivity' marks the R4 suite fixture (spec §12, calc 2.4.0) —
  // k-sensitivity.json. Unlike every other kind it carries no `inputs` of its own,
  // naming a `base_fixture` instead, so it is excluded from the runAppraisal loop
  // below and asserted by its own describe block.
  kind: 'pipeline' | 'programme' | 'phased-sales' | 'refinance' | 'sensitivity';
  // Widened from CalculatorInputsV2 in Release 3a: the corpus now mixes v3 and v4
  // documents, and `runAppraisal` takes the union directly (no downcast adapter).
  inputs: AnyCalculatorInputs;
  // Most keys are real AppraisalResultV2 properties. A few are not — they're a
  // fixture-authoring convenience mapped onto other parts of the run by FLAT_KEYS below
  // (the two cost_to_complete_* summary keys, spec §5.10; and funding_gap_pence, which
  // lives on the ledger totals rather than on the metrics object, spec §4.2).
  // R9: a key may also be a dotted path into a nested metrics object —
  // `area_bridge.nia_to_gia_pct` (spec §15.2). AreaBridgeResult has 23 fields; pinning
  // them individually keeps the JSON language-neutral (the Python mirror holds a
  // dataclass here, not a dict, so pinning the whole object would compare a dataclass
  // against a dict and never pass).
  expected_metrics: Partial<AppraisalResultV2> & Record<string, unknown>;
  /** R9 (spec §12.1 / §15.5): the same pin table, asserted against the appraisal
   *  produced by applying one of the document's OWN named scenarios. Fixture O uses
   *  it to carry the ancillary split through a −10% GDV stress end-to-end. */
  expected_scenarios?: Record<string, Record<string, unknown>>;
  /** R8/R9 (spec §14): the England/NI counterfactual for a non-English fixture —
   *  what the same document would cost under SDLT, and how far that difference
   *  travels. Hand-derived from fixtures/tax/acquisition-tax-tables.json. */
  jurisdiction_contrast?: {
    note: string;
    regime: string;
    england_ni_regime: string;
    england_ni_acquisition_tax_pence: number;
    acquisition_cost_delta_pence: number;
    total_development_cost_delta_pence: number;
    peak_debt_delta_pence: number;
  };
}

const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();

const fixtures: Fixture[] = fixtureFiles
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);

// The corpus is loaded by directory scan, so a fixture file that is deleted, renamed or
// never committed would silently reduce coverage instead of failing. This explicit roster
// is the "fixture list": adding a golden fixture means adding its stem here too.
const EXPECTED_FIXTURE_STEMS = [
  'a-all-cash',
  'f-dev-finance-12mo',
  'g-lender-valuation',
  'h-programme-scurve',
  'i-phased-sales',
  'j-blended-refinance',
  'k-sensitivity',
  'l-retain-all',
  'm-wales-jurisdiction',
  'n-area-bridge',
  'o-ancillary-value',
  'p-scotland-levered',
  'q-detailed-cost-plan',
  'r-vat-quarterly',
  's-dated-programme',
  't-investment-case',
  'u-investment-case-ltv-binds',
  'v-exhausted-reserve',
  'w-monitoring-on-site',
];

// Every fixture that carries its own `inputs` document, i.e. everything the
// runAppraisal loops below can run. Fixture K names a `base_fixture` instead of
// carrying inputs (spec §12, governance §2.1), so it is asserted by its own describe
// block at the end of this file rather than here.
const appraisalFixtures = fixtures.filter((f) => f.kind !== 'sensitivity');

// Minimal flat-key -> run-structure mapping for the fixture keys that are not direct
// AppraisalResultV2 properties. Every other expected_metrics key is a real, direct
// AppraisalResultV2 property, asserted below without this indirection.
//
// The mapper takes the whole AppraisalRun (widened in Release 3a from the previous
// cost_to_complete-only signature) so a pinnable quantity living outside `metrics` —
// like the ledger's funding gap — can be pinned without restructuring the harness.
const FLAT_KEYS: Record<string, (run: AppraisalRun) => unknown> = {
  // spec §5.10, Release 2b Task 6
  cost_to_complete_first_shortfall_month: (r) => r.metrics.cost_to_complete?.first_shortfall_month ?? null,
  cost_to_complete_max_shortfall_pence: (r) => r.metrics.cost_to_complete?.max_shortfall_pence ?? null,
  // spec §4.2 step 3 ("cost overruns never create facility"), Release 3a: the accumulated
  // unfunded cost. It is the headline behaviour of fixture H, so it must be pinned, but it
  // is a ledger total rather than a summary metric.
  funding_gap_pence: (r) => r.model.totals.funding_gap_pence,
  // spec §4.4.1 (calc 2.3.0), Release 3b: the phased-disposal redemption fields. Like
  // funding_gap_pence above, these are `model` properties rather than summary metrics, so
  // they reach the harness through the same AppraisalRun-wide mapper. The declining
  // schedule is pinned as two parallel flat arrays (months / balances) rather than an array
  // of objects, so the fixture JSON stays language-neutral for the Python mirror — the
  // model's own shape is Array<{ month, balance_pence }> and is projected here.
  redemption_balance_at_disposal_pence: (r) => r.model.redemption_balance_at_disposal_pence,
  redemption_schedule_months: (r) => r.model.redemption_schedule.map((e) => e.month),
  redemption_schedule_balances_pence: (r) => r.model.redemption_schedule.map((e) => e.balance_pence),
  // R9 spec §15.5, fixture O: gross sale receipts. GDV counts every unit's ancillary,
  // receipts count only the SOLD units' — under a blended exit the two figures must
  // differ by exactly the retained units' ancillary, and neither number alone can
  // prove that. A schedule total rather than a summary metric, hence the mapper.
  gross_sales_pence: (r) => r.schedule.totals.gross_sales_pence,
  // R10 spec §16, fixture Q: cost_plan.contingency and cost_plan.fees are ARRAYS of
  // objects, so a dotted `expected_metrics` path (which works fine for the scalar
  // cost_plan fields above it) cannot reach an individual line's base or amount —
  // the Python mirror's `_resolve_path` does `getattr(root, part)`, and a list has no
  // attribute named "0" or "general". These six mappers find a class by name so
  // fixture Q can pin all three contingency classes' resolved base AND amount, the
  // §16 "show the base" requirement discharged as an assertion rather than prose.
  cost_plan_contingency_general_base_pence: (r) =>
    r.metrics.cost_plan.contingency.find((c) => c.name === 'general')?.base_pence ?? null,
  cost_plan_contingency_general_amount_pence: (r) =>
    r.metrics.cost_plan.contingency.find((c) => c.name === 'general')?.amount_pence ?? null,
  cost_plan_contingency_existing_building_base_pence: (r) =>
    r.metrics.cost_plan.contingency.find((c) => c.name === 'existing_building')?.base_pence ?? null,
  cost_plan_contingency_existing_building_amount_pence: (r) =>
    r.metrics.cost_plan.contingency.find((c) => c.name === 'existing_building')?.amount_pence ?? null,
  cost_plan_contingency_abnormal_base_pence: (r) =>
    r.metrics.cost_plan.contingency.find((c) => c.name === 'abnormal')?.base_pence ?? null,
  cost_plan_contingency_abnormal_amount_pence: (r) =>
    r.metrics.cost_plan.contingency.find((c) => c.name === 'abnormal')?.amount_pence ?? null,
  // Same reasoning for the two percentage fee lines (spec §8 "fee base isolation"):
  // found by `basis` rather than `code`, since the fixture's whole point is that the
  // two bases resolve to different figures.
  cost_plan_fee_pct_construction_total_base_pence: (r) =>
    r.metrics.cost_plan.fees.find((f) => f.basis === 'pct_of_construction_total')?.base_pence ?? null,
  cost_plan_fee_pct_construction_total_amount_pence: (r) =>
    r.metrics.cost_plan.fees.find((f) => f.basis === 'pct_of_construction_total')?.amount_pence ?? null,
  cost_plan_fee_pct_base_build_base_pence: (r) =>
    r.metrics.cost_plan.fees.find((f) => f.basis === 'pct_of_base_build')?.base_pence ?? null,
  cost_plan_fee_pct_base_build_amount_pence: (r) =>
    r.metrics.cost_plan.fees.find((f) => f.basis === 'pct_of_base_build')?.amount_pence ?? null,
  // R11 spec §17.4, fixture R: the schedule's own construction spend curve, pinned
  // as a flat array so an explicit `programme` block (Ruling R16) that spread over
  // the wrong number of months is caught directly, before trusting any VAT figure
  // built on top of it.
  uses_construction_pence: (r) => r.schedule.uses.map((u) => u.construction_pence),
  // R11 spec §17.4's worked cycle, as three flat month-indexed arrays rather than
  // reaching into `metrics.vat.months` (an array of objects) with a dotted path —
  // the same reasoning as the six contingency/fee mappers above.
  vat_months_incurred_pence: (r) => r.metrics.vat.months.map((m) => m.incurred_pence),
  vat_months_reclaimed_pence: (r) => r.metrics.vat.months.map((m) => m.reclaimed_pence),
  vat_months_carry_pence: (r) => r.metrics.vat.months.map((m) => m.carry_pence),
  // R12 spec §18.10, fixture S: the derived ProgrammeResult. It hangs off the
  // SCHEDULE (`schedule.programme`), not off `metrics`, so a dotted
  // expected_metrics path cannot reach it at all — the same reasoning as
  // `funding_gap_pence` and the redemption arrays above. The per-phase figures
  // are pinned as four parallel flat arrays in `programme.phases[]` order
  // (which is the INPUT `phases[]` order) rather than as an array of objects,
  // keeping the fixture JSON language-neutral: the Python mirror holds a list
  // of `DerivedPhase` dataclasses here, and comparing a dataclass against a
  // dict would never pass.
  //
  // `programme_phase_ids` is not decoration. Without it the other three arrays
  // are positional against a shape nothing pins, so a reordering of `phases[]`
  // would silently re-key every start, finish and float.
  programme_finish_month: (r) => r.schedule.programme?.finish_month ?? null,
  programme_critical_path: (r) => r.schedule.programme?.critical_path ?? null,
  programme_phase_ids: (r) => r.schedule.programme?.phases.map((p) => p.id) ?? null,
  programme_phase_start_months: (r) => r.schedule.programme?.phases.map((p) => p.start_month) ?? null,
  programme_phase_finish_months: (r) => r.schedule.programme?.phases.map((p) => p.finish_month) ?? null,
  programme_phase_total_float_months:
    (r) => r.schedule.programme?.phases.map((p) => p.total_float_months) ?? null,
};

/** Resolves a dotted `expected_metrics` key (R9: `area_bridge.<field>`) against the
 *  metrics object. A plain key is just a one-segment path. */
function resolvePath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) => (acc == null ? acc : (acc as Record<string, unknown>)[part]),
    root,
  );
}

const versionOf = (fx: Fixture): number =>
  (fx.inputs as unknown as { inputs_version?: number }).inputs_version ?? 2;

describe('golden fixtures (shared with the Python engine)', () => {
  it('every expected fixture file is present in the shared corpus', () => {
    expect(fixtureFiles).toEqual(EXPECTED_FIXTURE_STEMS.map((s) => `${s}.json`));
  });

  function assertPins(run: AppraisalRun, pins: Record<string, unknown>, label: string) {
    for (const [key, expected] of Object.entries(pins)) {
      const mapper = FLAT_KEYS[key];
      const actual = mapper ? mapper(run) : resolvePath(run.metrics, key);
      expect(actual, `${label}: ${key}`).toEqual(expected);
    }
  }

  function assertExpectedMetrics(run: AppraisalRun, fx: Fixture, label: string) {
    assertPins(run, fx.expected_metrics, label);
  }

  for (const fx of appraisalFixtures) {
    it(fx.name, () => {
      assertExpectedMetrics(runAppraisal(fx.inputs), fx, fx.name);
    });
  }

  // R9 Task 12. A fixture may pin the appraisal produced by one of its OWN named
  // scenarios (spec §12.1). Fixture O uses this to carry the ancillary split all the
  // way through a −10% GDV stress: the stressed ancillary values are hand-derived, so
  // a scenario binding that stressed internal value alone — the pre-Task-7 behaviour —
  // fails here rather than passing on the internal figures.
  const scenarioFixtures = appraisalFixtures.filter((f) => f.expected_scenarios != null);

  it('at least one fixture pins a scenario appraisal', () => {
    // Non-vacuity: an `expected_scenarios` block dropped by an edit would otherwise
    // shrink the loop below to nothing rather than fail.
    expect(scenarioFixtures.map((f) => f.name)).toEqual(['O — ancillary value, blended exit, one unit sold and one retained']);
  });

  for (const fx of scenarioFixtures) {
    for (const [name, pins] of Object.entries(fx.expected_scenarios!)) {
      it(`${fx.name} — reproduces its hand-derived "${name}" scenario`, () => {
        const overrides = fx.inputs.scenarios[name as keyof typeof fx.inputs.scenarios];
        expect(overrides, `scenario ${name} must exist on the document`).toBeDefined();
        assertPins(runAppraisal(applyScenario(fx.inputs, overrides)), pins, `${fx.name}[${name}]`);
      });
    }
  }

  // R9: only the v5 fixtures. migrateInputsToV5 refuses a v6 document by design
  // (it would have to drop `areas` and every unit's `ancillary` block to produce
  // one), so a v6 fixture asserts the v6 property below instead of this one.
  const v5Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 5);
  const v6Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 6);
  // R10: symmetrically, migrateInputsToV6 refuses a v7 document by design (it would
  // have to drop `cost_plan` to produce one) — see RECOGNISED_INPUTS_VERSIONS_V6,
  // which stops at 6 — so a v7 fixture asserts the v7 property in the loop below
  // instead of the v6 one.
  const v7Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 7);
  // R11: symmetrically, migrateInputsToV7 refuses a v8 document by design (it would
  // have to drop `vat` to produce one) -- see RECOGNISED_INPUTS_VERSIONS_V7, which
  // stops at 7 -- so a v8 fixture asserts its own v8-specific properties instead of
  // the v7 one, in the it.each tables further below.
  const v8Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 8);
  // R12: fixture S is BORN at v9 -- it has no v8 antecedent, so every
  // migrate-to-vN loop below excludes it by the same design that excluded
  // fixture R from the v7 loops (migrateInputsToV8 refuses a v9 document:
  // RECOGNISED_INPUTS_VERSIONS_V8 stops at 8). Its own properties are asserted
  // by its pinned expected_metrics and by the v9-specific tests further down.
  const v9Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 9);
  // R13 Task 5b: the two v10-native investment-case fixtures (spec §19). R14
  // Task 2 adds a third — v-exhausted-reserve.json (spec §4) — also stored at
  // v10, since v11 does not exist until this release's later migration task.
  const v10Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 10);
  // R14 Task 8: fixture W is BORN at v11 -- the corpus's first v11-native
  // document (spec §20.2) -- so every migrate-to-vN loop below excludes it by
  // the same design that excluded T/U/V from the v9 loops.
  const v11Fixtures = appraisalFixtures.filter((f) => versionOf(f) === 11);

  it('every fixture is v5 through v11, and each group is non-empty', () => {
    expect(
      v5Fixtures.length + v6Fixtures.length + v7Fixtures.length
      + v8Fixtures.length + v9Fixtures.length + v10Fixtures.length
      + v11Fixtures.length,
    ).toBe(appraisalFixtures.length);
    expect(v5Fixtures.length).toBeGreaterThan(0);
    expect(v6Fixtures.map((f) => f.name).sort()).toEqual([
      'N — full area bridge, bridge-derived construction area, all-cash',
      'O — ancillary value, blended exit, one unit sold and one retained',
      'P — Scottish acquisition, LBTT non-residential, development finance',
    ]);
    expect(v7Fixtures.map((f) => f.name)).toEqual([
      'Q — detailed cost plan, three contingency classes, levered facility',
    ]);
    expect(v8Fixtures.map((f) => f.name)).toEqual([
      'R — VAT quarterly return cycle, purchase VAT chargeable, levered facility',
    ]);
    expect(v9Fixtures.map((f) => f.name)).toEqual([
      'S — fourteen-phase dated programme, slack phases, anchored two-tranche sale, tagged package',
    ]);
    expect(v10Fixtures.map((f) => f.name).sort()).toEqual([
      'T — retain-all with an investment case, DSCR binds',
      'U — retain-all with an investment case, LTV binds',
      'V — exhausted interest reserve, rolled-up development finance',
    ]);
    expect(v11Fixtures.map((f) => f.name)).toEqual([
      'W — monitoring statement on site, detailed cost plan, one ineligible package',
    ]);
  });

  // R12 spec §13 guard 1's FIXTURE REQUIREMENT, asserted rather than assumed.
  // A network in which every phase is critical makes the float column
  // untestable and the slip-asymmetry guard vacuous: "slipping a float-bearing
  // phase leaves the finish unchanged" has no witness to run on. The pinned
  // `programme_phase_total_float_months` array states the floats, but a pin can
  // be edited to match a regression; this derives the claim from the run.
  //
  // Both arms matter. Without the second, a network with NO critical phase at
  // all — an impossibility that would nonetheless mean the backward pass had
  // stopped working — would satisfy the first.
  it('the v9 corpus contains a phase with float >= 1 AND a critical phase (guard 1)', () => {
    expect(v9Fixtures.length).toBeGreaterThan(0);
    for (const fx of v9Fixtures) {
      const programme = runAppraisal(fx.inputs).schedule.programme;
      expect(programme, `${fx.name} must produce a derived programme block`).not.toBeNull();
      const floats = programme!.phases.map((p) => p.total_float_months);
      expect(Math.max(...floats), `${fx.name}: no phase carries float`).toBeGreaterThanOrEqual(1);
      expect(programme!.critical_path.length, `${fx.name}: no phase is critical`)
        .toBeGreaterThan(0);
      // And the critical path is exactly the zero-float set, in phases[] order —
      // the two are separately derived in programme.ts (a filter over the
      // topological order versus a per-phase subtraction) and must agree.
      expect(programme!.critical_path).toEqual(
        programme!.phases.filter((p) => p.total_float_months === 0).map((p) => p.id),
      );
    }
  });

  // R12 spec §18.6. Fixture S's two tranches carry a `month_offset` that
  // deliberately DISAGREES with their anchors (20/21 stored, 16/19 resolved),
  // so a dead anchor cannot hide behind an agreeing fallback. This states that
  // asymmetry as a property of the document rather than leaving it to the note.
  it('fixture S\'s sale tranches are anchored, and their stored month_offsets are NOT the resolved months', () => {
    const fx = v9Fixtures.find((f) => f.name.startsWith('S — '))!;
    const inputs = fx.inputs as unknown as {
      sales_phasing: { tranches: Array<{ month_offset: number; anchor: { phase_id: string; offset_months: number } | null }> };
    };
    const programme = runAppraisal(fx.inputs).schedule.programme!;
    const byId = new Map(programme.phases.map((p) => [p.id, p]));
    expect(inputs.sales_phasing.tranches).toHaveLength(2);
    for (const tr of inputs.sales_phasing.tranches) {
      expect(tr.anchor, 'every tranche must be anchored').not.toBeNull();
      const resolved = byId.get(tr.anchor!.phase_id)!.start_month + tr.anchor!.offset_months;
      expect(resolved).not.toBe(tr.month_offset);
    }
  });

  for (const fx of v5Fixtures) {
    // Mirrors Python's test_fixtures_reproduce_their_metrics_after_migration_to_v5.
    it(`${fx.name} — reproduces its metrics after migration to v5`, () => {
      // Release 3a identity guarantee (spec §6.1 / design §2.4), carried to v5 by R8
      // (spec §14): the migration chain is purely additive, so running a fixture's
      // inputs through the full normalisation chain must reproduce that fixture's
      // pinned expected_metrics unchanged, not merely "close". These fixtures are
      // already v5, so this exercises migrateInputsToV5's merge branch — which must
      // drop neither the programme block nor the R8 acquisition block.
      const v5 = migrateInputsToV5(fx.inputs as unknown as Record<string, unknown>);
      expect(v5.inputs_version).toBe(5);
      assertExpectedMetrics(runAppraisal(v5), fx, `${fx.name}[migrated-to-v5]`);
    });
  }

  // R10: restricted to the pre-v7 fixtures (v5Fixtures ∪ v6Fixtures) — migrateInputsToV6
  // refuses a v7 document, mirroring the v5Fixtures restriction above. The stronger,
  // corpus-wide statement is now the v7 loop immediately below. R11 widens the
  // exclusion to v7 or v8 -- migrateInputsToV6 refuses v8 by the same design
  // (RECOGNISED_INPUTS_VERSIONS_V6 stops at 6).
  // R13 Task 5b widens the exclusion once more to v10 -- migrateInputsToV6
  // refuses a v10 document identically. R14 Task 8 widens it once more to v11,
  // for the identical reason one version further on (`monitoring`).
  for (const fx of appraisalFixtures.filter((f) => ![7, 8, 9, 10, 11].includes(versionOf(f)))) {
    // R9: the same identity guarantee at the head of the chain — migrateInputsToV6
    // accepts a v5 document (upgrade path) and a v6 one (merge branch) alike. The
    // merge branch is the one that matters for the new fixtures: it must carry `areas`
    // and every unit's `ancillary` through untouched, and a merge that silently reset
    // either to the zeroed default would move fixture N's construction cost by
    // 16,170,000p and fixture O's GDV by 4,500,000p rather than pass.
    it(`${fx.name} — reproduces its metrics after migration to v6`, () => {
      const v6 = migrateInputsToV6(fx.inputs as unknown as Record<string, unknown>);
      expect(v6.inputs_version).toBe(6);
      assertExpectedMetrics(runAppraisal(v6), fx, `${fx.name}[migrated-to-v6]`);
    });
  }

  // R11: restricted to the pre-v8 fixtures -- migrateInputsToV7 refuses a v8
  // document by design (RECOGNISED_INPUTS_VERSIONS_V7 stops at 7). Fixture R (v8)
  // asserts its own identity guarantee in the v8 it.each table further below instead.
  // R13 Task 5b widens the exclusion once more to v10 -- migrateInputsToV7
  // refuses a v10 document identically. R14 Task 8 widens it once more to v11,
  // for the identical reason one version further on (`monitoring`).
  for (const fx of appraisalFixtures.filter((f) => ![8, 9, 10, 11].includes(versionOf(f)))) {
    // R10: the same identity guarantee one version further on, and the one that now
    // covers v5 through v7 — migrateInputsToV7 accepts v5, v6 and v7 documents alike
    // (upgrade, upgrade, merge). The merge branch matters for fixture Q: it must carry
    // `cost_plan` through untouched, and a merge that silently reset it to
    // DEFAULT_COST_PLAN would move fixture Q's construction cost by 6,040,000p
    // (the whole contingency total, since the base build alone survives via
    // costPlanFromLegacyCosts's fallback) rather than pass.
    it(`${fx.name} — reproduces its metrics after migration to v7`, () => {
      const v7 = migrateInputsToV7(fx.inputs as unknown as Record<string, unknown>);
      expect(v7.inputs_version).toBe(7);
      assertExpectedMetrics(runAppraisal(v7), fx, `${fx.name}[migrated-to-v7]`);
    });
  }

  // Fix round 2 (R8 Task 5). Every fixture in the corpus is now v5, so the loop
  // above proves only that "a v5 document merged onto v5 defaults reproduces its
  // pins". The property that matters for real data is the other one: *an old
  // stored document still reproduces its pins after normalisation* — every
  // persisted row in the database is v3 or v4, and nothing writes v5 yet. This
  // reverses the R8 additions and re-runs the whole corpus through the migration
  // chain from where it actually was before this release, restoring corpus-wide
  // coverage of that path (it was previously the `migrated-to-v4` loop's job).
  const R8_ACQUISITION_KEYS = [
    'jurisdiction', 'jurisdiction_source', 'jurisdiction_evidence_status',
    'acquisition_date', 'acquisition_tax_override_pence', 'acquisition_tax_override_reason',
  ];

  function asPreR8Document(inputs: AnyCalculatorInputs): Record<string, unknown> {
    const doc = JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
    const acq = doc.acquisition as Record<string, unknown>;
    for (const key of R8_ACQUISITION_KEYS) delete acq[key];
    // The pre-R8 version, derived structurally rather than hard-coded per stem:
    // the three v4 blocks arrived together in Release 3a, so a fixture carrying
    // `programme` was v4 and one without it was v3.
    doc.inputs_version = 'programme' in doc ? 4 : 3;
    return doc;
  }

  // R8 Task 12. The property above ("a pre-R8 document reproduces its pins") is only
  // well-defined for a fixture whose pinned figures are England/NI ones: the migration
  // stamps `england_ni` *by definition*, because that is what every legacy document
  // implicitly was. A non-English fixture has no pre-R8 form — stripping the R8 fields
  // does not recover an older document, it asserts a different property. So the loop
  // runs over the England/NI fixtures, and the excluded ones are covered by the
  // stronger assertion below rather than by silence.
  //
  // R9 narrows it further: a v6 fixture has no pre-R8 form either. `asPreR8Document`
  // stamps v3/v4, and migrating that back up would leave the R9 `areas` and `ancillary`
  // blocks at their zeroed defaults — a different document, not an older one.
  const jurisdictionOf = (fx: Fixture): string =>
    (fx.inputs.acquisition as unknown as Record<string, unknown>).jurisdiction as string
    ?? 'england_ni';
  const preR8Fixtures = appraisalFixtures.filter(
    (fx) => jurisdictionOf(fx) === 'england_ni' && versionOf(fx) === 5,
  );
  const nonEnglishFixtures = appraisalFixtures.filter((fx) => jurisdictionOf(fx) !== 'england_ni');

  it('the pre-R8 loop covers every England/NI v5 fixture and excludes only the v6, v7, v8, v9, v10, v11 and non-English ones', () => {
    // Without this, deleting a fixture's `jurisdiction` field — or mistyping it — would
    // quietly move it out of the loop above and reduce coverage without failing.
    expect(nonEnglishFixtures.map((f) => jurisdictionOf(f))).toEqual(['wales', 'scotland']);
    const excluded = appraisalFixtures.filter((fx) => !preR8Fixtures.includes(fx));
    expect(excluded.map((f) => f.name).sort()).toEqual([
      'M — Welsh acquisition, LTT non-residential, all-cash',
      'N — full area bridge, bridge-derived construction area, all-cash',
      'O — ancillary value, blended exit, one unit sold and one retained',
      'P — Scottish acquisition, LBTT non-residential, development finance',
      'Q — detailed cost plan, three contingency classes, levered facility',
      'R — VAT quarterly return cycle, purchase VAT chargeable, levered facility',
      'S — fourteen-phase dated programme, slack phases, anchored two-tranche sale, tagged package',
      'T — retain-all with an investment case, DSCR binds',
      'U — retain-all with an investment case, LTV binds',
      'V — exhausted interest reserve, rolled-up development finance',
      'W — monitoring statement on site, detailed cost plan, one ineligible package',
    ]);
    // Every exclusion is justified by one of the two stated reasons, not by silence.
    // R10 widens the second reason from "version === 6" to "version === 6 or 7", and
    // R11 widens it again to include 8: fixture R (v8), like fixture Q (v7) before
    // it, has no pre-R8 form — asPreR8Document stamps v3/v4, and migrating that back
    // up would leave the R9 areas/ancillary, the R10 cost_plan AND the R11 vat blocks
    // at their zeroed/legacy-derived/inert defaults, a different document.
    //
    // R12 widens it once more to include 9: fixture S is BORN at v9 and has no
    // pre-R8 form at all — it did not exist before R8, and stamping it v3/v4 would
    // additionally strip the R12 programme network the fixture is entirely about.
    //
    // R13 Task 5b widens it once more to include 10: fixtures T and U are BORN at
    // v10 for the same reason S was born at v9 — they did not exist before R8, and
    // stamping them v3/v4 would additionally strip the R13 investment case the
    // fixtures are entirely about. R14 Task 2 adds a third v10-native fixture, V,
    // for the same reason: it did not exist before R8 and is stored at v10 because
    // v11 does not exist yet (Task 6's gate migrates it).
    //
    // R14 Task 8 widens it once more to include 11: fixture W is BORN at v11 for
    // the same reason — it did not exist before R8, and stamping it v3/v4 would
    // additionally strip the R14 `monitoring` block and the detailed cost plan
    // the fixture is entirely about.
    //
    // Fix round 1, I3: this must enumerate the versions the exclusion is genuinely
    // about, NOT negate preR8Fixtures's own defining condition ("=== 5" flipped to
    // "!== 5") — that phrasing is the literal complement of how `excluded` was built,
    // so it is vacuously true for every member and can never fail. Enumerating
    // 6/7/8/9/10/11 keeps the check able to fail: it catches a fixture excluded for
    // a SEVENTH, unstated reason (e.g. a future non-v5..v11 fixture, or a change to
    // preR8Fixtures's own filter that this assertion was never updated to match).
    for (const fx of excluded) {
      expect(
        jurisdictionOf(fx) !== 'england_ni'
          || versionOf(fx) === 6 || versionOf(fx) === 7 || versionOf(fx) === 8
          || versionOf(fx) === 9 || versionOf(fx) === 10 || versionOf(fx) === 11,
        `${fx.name} is excluded from the pre-R8 loop for no stated reason`,
      ).toBe(true);
    }
  });

  for (const fx of preR8Fixtures) {
    // Mirrors Python's test_pre_r8_fixture_form_reproduces_its_metrics_after_migration.
    it(`${fx.name} — reproduces its metrics from its pre-R8 (v3/v4) form`, () => {
      const pre = asPreR8Document(fx.inputs);
      expect(pre.inputs_version).not.toBe(5);
      expect(R8_ACQUISITION_KEYS.some((k) => k in (pre.acquisition as object))).toBe(false);
      const v5 = migrateInputsToV5(pre);
      expect(v5.inputs_version).toBe(5);
      // The migration stamps what a legacy document honestly is: England/NI by
      // default, unconfirmed, no transaction date (spec §14).
      expect(v5.acquisition.jurisdiction).toBe('england_ni');
      expect(v5.acquisition.jurisdiction_source).toBe('migrated_default');
      expect(v5.acquisition.jurisdiction_evidence_status).toBe('unconfirmed');
      expect(v5.acquisition.acquisition_date).toBeNull();
      assertExpectedMetrics(runAppraisal(v5), fx, `${fx.name}[pre-R8 → v5]`);
    });
  }

  // R9 Task 12. The non-English fixtures get the *stronger* statement: switching the
  // document's jurisdiction to England/NI must change the acquisition tax, and change it
  // to precisely the England/NI figure on the same consideration. That is what makes the
  // fixture's jurisdiction load-bearing — a table edit, or a mis-wired call site that
  // quietly reverted to SDLT, fails here rather than passing because the two regimes
  // happened to agree.
  //
  // R8 wrote this with fixture M's figures hard-coded inside a loop over every non-English
  // fixture, and left a MAINTENANCE note saying that adding a second one meant rewriting
  // it. Fixture P is that second one, so it is rewritten: the expected pair and the three
  // deltas now come from each fixture's own hand-derived `jurisdiction_contrast` block.
  //
  // It also matters that the deltas are pinned SEPARATELY rather than asserted equal to
  // each other. Fixture M is all-cash, so its tax difference reaches TDC unchanged and
  // never touches peak debt. Fixture P is levered, so the extra tax exhausts committed
  // equity a month earlier and then compounds: its TDC delta (106,161p) is strictly
  // larger than its acquisition delta (100,000p). An engine that computed the right tax
  // but funded it wrongly would satisfy the first and fail the second — the interaction
  // R8's implementation report recorded as unpinned.
  function asEnglandNiDocument(inputs: AnyCalculatorInputs): AnyCalculatorInputs {
    const doc = JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
    (doc.acquisition as Record<string, unknown>).jurisdiction = 'england_ni';
    return doc as unknown as AnyCalculatorInputs;
  }

  for (const fx of nonEnglishFixtures) {
    it(`${fx.name} — its England/NI twin is a different appraisal`, () => {
      const contrast = fx.jurisdiction_contrast;
      expect(contrast, `${fx.name} must carry a jurisdiction_contrast block`).toBeDefined();
      const nativeRun = runAppraisal(fx.inputs);
      const englishRun = runAppraisal(asEnglandNiDocument(fx.inputs));

      expect(nativeRun.metrics.acquisition_tax.regime).toBe(contrast!.regime);
      expect(englishRun.metrics.acquisition_tax.regime).toBe(contrast!.england_ni_regime);
      expect(englishRun.metrics.acquisition_tax_pence)
        .toBe(contrast!.england_ni_acquisition_tax_pence);
      // Non-vacuity: the two regimes must actually disagree on this consideration.
      expect(contrast!.acquisition_cost_delta_pence).toBeGreaterThan(0);
      // The difference must reach the headline cost stack, not stop at the metrics
      // object — this is the two-call-site defect R8 Task 5 found, pinned.
      expect(englishRun.metrics.acquisition_cost_pence - nativeRun.metrics.acquisition_cost_pence)
        .toBe(contrast!.acquisition_cost_delta_pence);
      expect(
        englishRun.metrics.total_development_cost_pence
        - nativeRun.metrics.total_development_cost_pence,
      ).toBe(contrast!.total_development_cost_delta_pence);
      expect(englishRun.metrics.peak_debt_pence - nativeRun.metrics.peak_debt_pence)
        .toBe(contrast!.peak_debt_delta_pence);
    });
  }

  for (const fx of nonEnglishFixtures.filter((f) => versionOf(f) === 5)) {
    // R8's original route to the same statement, kept for the v5 non-English fixtures
    // because it additionally proves the migration stamps `england_ni` on a document
    // that never said otherwise. Now driven off the contrast block rather than
    // hard-coded, so it survives the next non-English fixture unchanged.
    it(`${fx.name} — its pre-R8 form is a different, England/NI, appraisal`, () => {
      const contrast = fx.jurisdiction_contrast!;
      const v5 = migrateInputsToV5(asPreR8Document(fx.inputs));
      expect(v5.acquisition.jurisdiction).toBe('england_ni');
      const englishRun = runAppraisal(v5);
      const nativeRun = runAppraisal(fx.inputs);

      expect(englishRun.metrics.acquisition_tax_pence)
        .toBe(contrast.england_ni_acquisition_tax_pence);
      expect(nativeRun.metrics.acquisition_tax_pence)
        .toBe(fx.expected_metrics.acquisition_tax_pence);
      expect(englishRun.metrics.acquisition_tax.regime).toBe(contrast.england_ni_regime);
      expect(nativeRun.metrics.acquisition_tax.regime).toBe(contrast.regime);
      expect(englishRun.metrics.acquisition_cost_pence - nativeRun.metrics.acquisition_cost_pence)
        .toBe(contrast.acquisition_cost_delta_pence);
      expect(
        englishRun.metrics.total_development_cost_pence
        - nativeRun.metrics.total_development_cost_pence,
      ).toBe(contrast.total_development_cost_delta_pence);
    });
  }

  // Negative control (fixture H's precedent, Release 3a — a pinned key that no assertion
  // actually reaches is a copy-paste false pass, not coverage).
  //
  // THE CONVENTION THIS BLOCK KEEPS: every key in FLAT_KEYS is negative-controlled by at
  // least one fixture here. Adding a mapper means adding an entry below. Nothing enforces
  // that mechanically, so it is stated here rather than left to be inferred — R9 added
  // three mapped pins and had to be told to come back for this.
  //
  // The three redemption keys added in Release 3b reach the run through FLAT_KEYS rather than through
  // AppraisalResultV2, so a typo in a mapper (or a key silently absent from the mapper
  // table) would compare `undefined` against `undefined` for a fixture that happened not to
  // pin it, and pass. This flips each mapped key to a deliberately wrong value and asserts
  // the loop FAILS. If any of these stops throwing, the corresponding pin has gone inert.
  //
  // Run over BOTH fixtures that pin all three redemption keys, because they exercise
  // opposite sides of the same mappers (Release 3b Task 8): fixture I's redemption balance
  // is 0 and its three-entry schedule ends at 0, while fixture J's is non-zero and its
  // two-entry schedule ends non-zero. A mapper that returned a constant, or dropped the
  // final entry, could satisfy one fixture's control while failing the other's.
  const negativeControls: Array<{ namePrefix: string; wrongValues: Record<string, unknown> }> = [
    {
      namePrefix: 'I — phased sell_all',
      wrongValues: {
        redemption_balance_at_disposal_pence: 1,                    // truly 0
        redemption_schedule_months: [9, 10],                        // truly [9, 10, 11]
        redemption_schedule_balances_pence: [53431299, 10782708, 1], // truly [..., 0]
        funding_gap_pence: 1,                                       // truly 0
        peak_debt_pence: 53431300,                                  // truly 53431299 (direct key)
      },
    },
    {
      namePrefix: 'J — blended exit',
      wrongValues: {
        redemption_balance_at_disposal_pence: 4946601,              // truly 4946600
        redemption_schedule_months: [9, 10],                        // truly [9, 11]
        redemption_schedule_balances_pence: [53431299, 4946601],    // truly [..., 4946600]
        funding_gap_pence: 1,                                       // truly 0
        peak_debt_pence: 53431300,                                  // truly 53431299 (direct key)
      },
    },
    // R9 Task 12 fix round 1. The block above states its own convention — every FLAT_KEYS
    // mapper is negative-controlled — and R9 added mappers without extending it, which
    // quietly breaks that convention for the next person who trusts it. Both new fixtures
    // that exercise a new mapper get a control.
    //
    // Fixture O is the one that matters for `gross_sales_pence`: under a blended exit GDV
    // and receipts are DIFFERENT numbers (74,500,000 vs 32,000,000), so a mapper wired to
    // the wrong total would be caught. A control on a sell_all fixture could not tell the
    // two apart.
    {
      namePrefix: 'O — ancillary value',
      wrongValues: {
        gross_sales_pence: 74500000,   // truly 32000000 — and 74500000 is this fixture's
                                       // GDV, i.e. precisely the wrong total a mis-wired
                                       // mapper would return
      },
    },
    // Fixture P's cost-to-complete pair used to hold spec §5.10's C1 defect (a phantom
    // shortfall from double-counting rolled-up interest against the net facility). R14
    // closed C1 (spec §5.10 rewritten, calc 2.13.0): the reserve credit clears the series
    // at every month, so the true pins are null / 0 and the old phantom figures (1 /
    // 392483) are now what the negative control must catch instead.
    {
      namePrefix: 'P — Scottish acquisition',
      wrongValues: {
        gross_sales_pence: 143999999,                  // truly 144000000
        cost_to_complete_first_shortfall_month: 1,     // truly null — R14 closed C1; 1 was calc ≤2.12.0's phantom
        cost_to_complete_max_shortfall_pence: 392483,  // truly 0 — the old phantom figure is the control
        funding_gap_pence: 1,                          // truly 0 — the ledger draws exactly
                                                       // as intended, unrelated to the C1 fix
        peak_debt_pence: 70601817,                     // truly 70601816 (direct key)
      },
    },
    // R10 Task 11 fix round 1 (the same convention the block above states): fixture Q
    // adds ten new FLAT_KEYS mappers (the three contingency classes' base and amount,
    // and the two percentage fee lines' base and amount), and every one needs a
    // control here or the convention silently breaks for the next reader who trusts
    // it. One entry covers all ten — poisoning `general`'s base with `existing_building`'s
    // figure (and so on) rather than an arbitrary wrong number, so a control failure
    // reads as "found the wrong line" rather than "found a typo".
    {
      namePrefix: 'Q — detailed cost plan',
      wrongValues: {
        cost_plan_contingency_general_base_pence: 23000000,       // truly 47000000
        cost_plan_contingency_general_amount_pence: 2350001,      // truly 2350000
        cost_plan_contingency_existing_building_base_pence: 47000000, // truly 23000000
        cost_plan_contingency_existing_building_amount_pence: 3450001, // truly 3450000
        cost_plan_contingency_abnormal_base_pence: 47000000,      // truly 3000000
        cost_plan_contingency_abnormal_amount_pence: 240001,      // truly 240000
        cost_plan_fee_pct_construction_total_base_pence: 47000000, // truly 53040000
        cost_plan_fee_pct_construction_total_amount_pence: 795601, // truly 795600
        cost_plan_fee_pct_base_build_base_pence: 53040000,        // truly 47000000
        cost_plan_fee_pct_base_build_amount_pence: 2820001,       // truly 2820000
      },
    },
    // R11 (the same convention this block states): fixture R adds four new FLAT_KEYS
    // array mappers (the schedule's construction spend curve, and the VAT engine's
    // three month-indexed arrays). Each wrong value is a plausible REAL mistake — a
    // shifted programme window, a swapped incurred-VAT month, the two periods'
    // reclaims swapped, a one-pence slip at the peak carry — not an arbitrary wrong
    // number, so a control failure reads as "found the wrong month/line" rather than
    // "found a typo".
    {
      namePrefix: 'R — VAT quarterly',
      wrongValues: {
        // truly [0, 25000000, 25000000, 25000000, 25000000, 0, 0] — shifted one month
        // later, the exact shape an unset `programme` block (auto windows) would give.
        uses_construction_pence: [0, 0, 25000000, 25000000, 25000000, 25000000, 0],
        // truly [10000000, 5000000, 5000000, 5000000, 5000000, 0, 0] — months 0/1 swapped.
        vat_months_incurred_pence: [5000000, 10000000, 5000000, 5000000, 5000000, 0, 0],
        // truly [0, 0, 0, 20000000, 0, 0, 10000000] — the two periods' reclaims swapped.
        vat_months_reclaimed_pence: [0, 0, 0, 10000000, 0, 0, 20000000],
        // truly [10000000, 15000000, 20000000, 5000000, 10000000, 10000000, 0] — the
        // peak off by one penny.
        vat_months_carry_pence: [10000000, 15000000, 19999999, 5000000, 10000000, 10000000, 0],
      },
    },
    // R12 (the same convention this block states): fixture S adds six new FLAT_KEYS
    // mappers for the derived ProgrammeResult. Each wrong value is a plausible REAL
    // regression rather than an arbitrary wrong number:
    //   - finish_month 21 is what §18.2's maximum gives if the MILESTONE arm is
    //     dropped, i.e. `max(finish)` over duration>=1 phases alone — the programme
    //     would then be reported as finishing before its own maturity_tail;
    //   - the critical path with `construction` removed is what the successor-only
    //     late-finish rule produces (§18.4's correction): its SS successor
    //     `marketing` would lend it a float of 2 it does not have;
    //   - the float array with marketing at 0 is a wholly-critical network, the
    //     state guard 1 exists to reject;
    //   - the start array with marketing at 8 is an SS lag read as 0 rather than 3;
    //   - the finish array with practical_completion at 17 is a milestone given a
    //     one-month duration;
    //   - the id array with `design` and `procurement` transposed is the reordering
    //     that would silently re-key the three positional arrays above.
    {
      namePrefix: 'S — fourteen-phase dated programme',
      wrongValues: {
        programme_finish_month: 21,
        programme_critical_path: [
          'acquisition', 'planning', 'conditions', 'strip_out', 'testing',
          'building_control', 'practical_completion', 'unit_completions', 'sales', 'maturity_tail',
        ],
        programme_phase_ids: [
          'acquisition', 'planning', 'conditions', 'procurement', 'design', 'strip_out',
          'construction', 'testing', 'building_control', 'practical_completion',
          'marketing', 'unit_completions', 'sales', 'maturity_tail',
        ],
        programme_phase_start_months: [0, 1, 4, 1, 5, 6, 8, 14, 15, 16, 8, 16, 18, 21],
        programme_phase_finish_months: [1, 4, 6, 5, 7, 8, 14, 15, 16, 17, 15, 18, 21, 21],
        programme_phase_total_float_months: [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    },
    // R14 (the same convention this block states): fixture V is the release's own
    // hand-derived positive case for the reserve-headroom correction (spec §4), so
    // its five pins each get a pin ± 1 control, matching every other fixture's
    // convention exactly (see docs/financial-model/test-cases.md §20.1 for the
    // worksheet these pins come from).
    {
      namePrefix: 'V — exhausted interest reserve',
      wrongValues: {
        gdv_pence: 30000001,                          // truly 30000000
        peak_debt_pence: 12445220,                     // truly 12445219 (direct key)
        funding_gap_pence: 704022,                     // truly 704021
        cost_to_complete_first_shortfall_month: 2,     // truly 1
        cost_to_complete_max_shortfall_pence: 949241,  // truly 949240
      },
    },
    // R14 Task 8 (the same convention this block states): fixture W is the release's
    // golden case for the §20.2 monitoring statement and the cross-engine
    // penny-agreement carrier, so its pins get pin ± 1 controls too (see
    // docs/financial-model/test-cases.md §20.2 for the worksheet they come from).
    // W's four R14-specific pins are held back until Task 9 wires their FLAT_KEYS
    // mappers -- when they land, they belong here as well. Mirrors
    // tests/test_financial_model_fixtures.py's _NEGATIVE_CONTROLS entry for W.
    {
      namePrefix: 'W — monitoring statement on site',
      wrongValues: {
        gdv_pence: 45000001,                           // truly 45000000
        peak_debt_pence: 14188794,                     // truly 14188793 (direct key)
        funding_gap_pence: 1,                          // truly 0
        cost_to_complete_first_shortfall_month: 1,     // truly null (no shortfall)
        cost_to_complete_max_shortfall_pence: 1,       // truly 0
        // The §4.2(b) ratio, pinned through the dotted path rather than the flat key
        // Task 9 adds. 11/12 is not representable, so the control is a neighbouring
        // double rather than "the pin + 1".
        'cost_plan.lender_eligible_ratio': 0.9166666666666667,
      },
    },
  ];

  for (const { namePrefix, wrongValues } of negativeControls) {
    it(`negative control (${namePrefix}): a deliberately-wrong value for each mapped key fails`, () => {
      const fx = fixtures.find((f) => f.name.startsWith(namePrefix));
      expect(fx, `fixture "${namePrefix}" must be in the corpus`).toBeDefined();
      const run = runAppraisal(fx!.inputs);

      for (const [key, wrong] of Object.entries(wrongValues)) {
        const poisoned: Fixture = {
          ...fx!,
          expected_metrics: { ...fx!.expected_metrics, [key]: wrong },
        };
        expect(
          () => assertExpectedMetrics(run, poisoned, 'negative-control'),
          `wrong ${key} must fail`,
        ).toThrow();
      }
    });
  }

  // R9 Task 3 — the acceptance gate for the v5→v6 migration, mirrored in
  // tests/test_migrate_v6.py::test_v6_migration_moves_no_existing_figure.
  //
  // "Purely additive" has to be a tested claim, not an assertion: migration
  // writes the manual basis with a zeroed bridge, so the cost area stays
  // `conversion_costs.total_construction_sqm` and every figure must be
  // byte-identical either side of it. If one moves, the migration is wrong —
  // not the fixture.
  //
  // R10: restricted to the pre-v7 fixtures — migrateInputsToV6 refuses a v7 document
  // by design (RECOGNISED_INPUTS_VERSIONS_V6 stops at 6), mirroring the v5Fixtures/
  // v6Fixtures restriction above. The stronger, corpus-wide gate is the v7 table below.
  // R11 widens the exclusion to v7 or v8 -- migrateInputsToV6 refuses v8 the same way.
  // R13 Task 5b widens the exclusion once more to v10 -- migrateInputsToV6
  // refuses a v10 document identically (it would have to drop `vat`,
  // `programme`'s v9 shape, `refinance`'s v10 narrowing AND `investment_case`
  // to produce a v6 one). R14 Task 8 widens it once more to v11 (`monitoring`).
  it.each(appraisalFixtures.filter((f) => ![7, 8, 9, 10, 11].includes(versionOf(f))).map((f) => f.name))(
    'migrating %s to v6 moves no computed figure',
    (name) => {
      const fx = appraisalFixtures.find((f) => f.name === name)!;
      const before = runAppraisal(fx.inputs);
      const migrated = migrateInputsToV6(fx.inputs as unknown as Record<string, unknown>);
      const after = runAppraisal(migrated);

      expect(migrated.inputs_version).toBe(6);

      // Fix round 2. The before/after comparison below cannot see this yet: no
      // engine module reads `areas` until Task 4 wires it into the cost stack,
      // so a migration that wrongly SYNTHESISED a bridge (e.g. from
      // `conversion_costs.total_construction_sqm`) would move no figure today
      // and would sail through a purely numeric gate — then silently change
      // every appraisal the moment Task 4 lands. Asserted by value rather than
      // against DEFAULT_AREA_BRIDGE: comparing the migration's output to the
      // constant it was built from could not catch that constant itself
      // becoming non-zero. Mirrors _assert_zeroed_r9_blocks in
      // tests/test_migrate_v6.py.
      //
      // R9 Task 12: this half applies to a document that is being UPGRADED. A fixture
      // that is already v6 goes through migrateInputsToV6's merge branch instead, where
      // the claim is the mirror image — the blocks it carries must survive untouched.
      // Zeroing them there would be just as wrong, and the numeric gate below would not
      // see it for fixture P (a zeroed bridge on the manual basis computes the same
      // figures), so it is asserted structurally too.
      if (versionOf(fx) === 6) {
        expect(migrated.areas).toEqual((fx.inputs as unknown as { areas: unknown }).areas);
        expect(migrated.unit_mix.units.map((u) => u.ancillary)).toEqual(
          (fx.inputs.unit_mix.units as unknown as Array<{ ancillary: unknown }>)
            .map((u) => u.ancillary),
        );
      } else {
        const { basis, ...areaFigures } = migrated.areas;
        expect(basis).toBe('manual');
        for (const [field, value] of Object.entries(areaFigures)) {
          expect(value, `areas.${field} must migrate zeroed, not synthesised`).toBe(0);
        }
        for (const unit of migrated.unit_mix.units) {
          for (const [field, value] of Object.entries(unit.ancillary)) {
            expect(value, `unit ${unit.id} ancillary.${field} must migrate zeroed`).toBe(0);
          }
        }
      }

      expect(after.metrics).toEqual(before.metrics);
      // The metrics object is the headline, but a migration defect could
      // equally move a ledger or schedule figure the metrics never surface.
      expect(after.model).toEqual(before.model);
      expect(after.schedule).toEqual(before.schedule);
    },
  );

  // R10 Task 11 — the acceptance gate for the v6→v7 migration, mirrored in
  // tests/test_migrate_v7.py's test_v7_migration_moves_no_existing_figure (added
  // fix round 1, I2 — this comment previously claimed that mirror existed when it
  // did not; test_migrate_v7.py had no fixture-corpus scan, no run_appraisal call
  // and no before/after comparison until then). The same shape as the v6 table
  // above, one version further on: migrateInputsToV7 accepts v5, v6 and v7
  // documents alike (RECOGNISED_INPUTS_VERSIONS_V7 = 1–7), and refuses v8 by the
  // same design (R11) -- fixture R (v8) is excluded here and gets its own gate in
  // the v8 table below.
  // R13 Task 5b widens the exclusion once more to v10 -- migrateInputsToV7
  // refuses a v10 document identically (it would have to drop `refinance`'s
  // v10 narrowing and `investment_case` to produce a v7 one). R14 Task 8
  // widens it once more to v11 (`monitoring`).
  it.each(appraisalFixtures.filter((f) => ![8, 9, 10, 11].includes(versionOf(f))).map((f) => f.name))(
    'migrating %s to v7 moves no computed figure',
    (name) => {
      const fx = appraisalFixtures.find((f) => f.name === name)!;
      const before = runAppraisal(fx.inputs);
      const migrated = migrateInputsToV7(fx.inputs as unknown as Record<string, unknown>);
      const after = runAppraisal(migrated);

      expect(migrated.inputs_version).toBe(7);

      // Structural half, mirroring the v6 table's areas/ancillary check: a fixture
      // that is already v7 (fixture Q) goes through the merge branch, where the claim
      // is that `cost_plan` survives untouched — silently resetting it to
      // DEFAULT_COST_PLAN would move Q's construction cost by 6,040,000p (the whole
      // contingency total) and the numeric gate below would still catch it, but this
      // makes the *construction* of the bug visible rather than just its symptom. A
      // fixture being UPGRADED (v5/v6) must instead get exactly the plan
      // costPlanFromLegacyCosts derives from its own conversion_costs — the same
      // function the engine's pre-v7 fallback uses, per cost-plan.ts's own docstring
      // on why a second, divergent copy would be unsafe.
      if (versionOf(fx) === 7) {
        expect(migrated.cost_plan).toEqual((fx.inputs as unknown as { cost_plan: unknown }).cost_plan);
      } else {
        expect(migrated.cost_plan).toEqual(costPlanFromLegacyCosts(fx.inputs.conversion_costs));
      }

      expect(after.metrics).toEqual(before.metrics);
      expect(after.model).toEqual(before.model);
      expect(after.schedule).toEqual(before.schedule);
    },
  );

  // R11 Task 10 (spec §17.11) — the same acceptance gate one version further on,
  // mirrored in tests/test_migrate_v8.py::test_v8_migration_moves_no_existing_figure.
  //
  // R9 recorded that a gate of this shape can be PROVABLY BLIND: where the
  // migration synthesises a block no engine consumes, "the figures did not
  // move" is guaranteed by construction and the gate cannot fail. Here the
  // numeric half IS meaningful — the VAT engine is live and reads
  // `vat.registered`, so a migration writing `registered: true` would move
  // every fixture. But the numeric half alone still cannot tell a block written
  // CORRECTLY from one written merely harmlessly, so the structural half below
  // asserts what §17.11 actually specifies: six rows in declared order at zero,
  // every override null, and the two deleted contingency fields gone.
  //
  // R11: restricted to the PRE-EXISTING (pre-v8) fixtures. Fixture R already IS a
  // v8 document carrying a LIVE vat block, so migrateInputsToV8 takes the
  // MERGE-onto-defaults branch for it rather than the inert upgrade write this
  // gate is about -- the structural assertions below (`registered: false`, every
  // rate 0) would fail for it not because the migration is wrong but because they
  // are asserting the wrong claim about an already-registered document. Fixture
  // R's own identity-through-merge property is asserted separately, below.
  // R13 Task 5b widens the exclusion once more to v10 -- migrateInputsToV8
  // refuses a v10 document identically (it would have to drop `refinance`'s
  // v10 narrowing and `investment_case` to produce a v8 one). R14 Task 8
  // widens it once more to v11 (`monitoring`); `preV8Fixtures` therefore stays
  // at 12, since fixture W was never inside this gate.
  const preV8Fixtures = appraisalFixtures.filter((f) => ![8, 9, 10, 11].includes(versionOf(f)));

  it.each(preV8Fixtures.map((f) => f.name))(
    'migrating %s to v8 moves no computed figure, and writes the specified block',
    (name) => {
      const fx = preV8Fixtures.find((f) => f.name === name)!;
      const before = runAppraisal(fx.inputs);
      const migrated = migrateInputsToV8(fx.inputs as unknown as Record<string, unknown>);
      const after = runAppraisal(migrated);

      expect(migrated.inputs_version).toBe(8);

      // Structural half — §17.11's write, asserted directly.
      expect(migrated.vat.registered).toBe(false);
      expect(migrated.vat.treatments.map((t) => t.category)).toEqual([...VAT_CHARGE_CATEGORIES]);
      expect(migrated.vat.treatments).toHaveLength(6);
      for (const t of migrated.vat.treatments) {
        expect(t.rate_pct).toBe(0);
        expect(t.recoverable_pct).toBe(0);
        expect(t.recovery_basis).toBe('unconfirmed');
        expect(t.evidence_status).toBe('unconfirmed');
      }
      expect(migrated.vat.purchase.vendor_opted_to_tax).toBe(false);
      expect(migrated.vat.purchase.togc_treatment).toBe('unconfirmed');
      for (const p of migrated.cost_plan.packages) expect(p.vat_override).toBeNull();
      for (const f of migrated.cost_plan.fee_lines) expect(f.vat_override).toBeNull();
      for (const c of migrated.cost_plan.contingency) {
        expect('basis' in c).toBe(false);
        expect('package_ids' in c).toBe(false);
      }
      // Fixture Q is already v7 and carries a real package schedule; the merge
      // branch must bring it through untouched apart from the two subtractions
      // above, exactly as the v7 gate asserts for `cost_plan` as a whole.
      if (versionOf(fx) === 7) {
        const savedPlan = (fx.inputs as unknown as { cost_plan: { packages: unknown[] } }).cost_plan;
        expect(migrated.cost_plan.packages).toHaveLength(savedPlan.packages.length);
        expect(migrated.cost_plan.mode).toBe('detailed');
      }

      // Numeric half.
      expect(after.metrics).toEqual(before.metrics);
      expect(after.model).toEqual(before.model);
      expect(after.schedule).toEqual(before.schedule);
    },
  );

  // Non-vacuity guard, mirroring test_migrate_v7.py::test_v7_migration_moves_no_
  // existing_figure's `assert len(names) == 12` (fix round 1, M5: this comment
  // previously said 12 while the Python side still said 11, because the true v7
  // corpus-wide Python gate did not exist yet — see I2 above). The corpus is
  // loaded by directory scan, so a fixture that is deleted, renamed or never
  // committed would silently shrink the it.each tables above to nothing rather
  // than failing.
  it('runs the migration identity gates over the whole pipeline corpus, not an empty one', () => {
    expect(preV8Fixtures).toHaveLength(12);
  });

  // Fixture R's OWN identity guarantee: it is already v8, so migrateInputsToV8
  // merges it onto v8 defaults (RECOGNISED_INPUTS_VERSIONS_V8 = 1–8) rather than
  // writing the inert block, and that merge must carry its LIVE vat block through
  // untouched -- exactly the claim the v6/v7 tables above assert for `areas` and
  // `cost_plan` on a fixture that is already at the target version.
  for (const fx of v8Fixtures) {
    it(`${fx.name} — reproduces its metrics after migration to v8 (merge branch)`, () => {
      const migrated = migrateInputsToV8(fx.inputs as unknown as Record<string, unknown>);
      expect(migrated.inputs_version).toBe(8);
      expect(migrated.vat).toEqual((fx.inputs as unknown as { vat: unknown }).vat);
      assertExpectedMetrics(runAppraisal(migrated), fx, `${fx.name}[migrated-to-v8]`);
    });
  }

  // Ruling R38 (spec §17.11, "The migration must add no validation issue
  // either"). Twin of tests/test_migrate_v8.py::test_v8_migration_adds_and_
  // removes_no_validation_issue.
  //
  // The numeric gate above could never have caught R38's defect, because the
  // figures genuinely did not move: the migration wrote
  // `first_period_end_month: 2` onto every document while `registered: false`
  // kept the engine dormant, so no number changed — and yet every stored
  // appraisal with `term_months <= 2` acquired a HARD ERROR, which makes
  // report_safe false and marks the report DRAFT.
  //
  // The assertion is "the SAME issues", not "no errors": a document that was
  // already invalid must stay invalid in the same way.
  //
  // ONE exemption, named rather than absorbed into a loose comparison. §17.9
  // SPECIFIES a warning for "`registered: false` with a non-zero construction
  // cost". A pre-v8 document has no `vat` block and so no VAT issue at all, so
  // that warning can only ever appear AFTER migration — unavoidable by
  // construction, and the correct disclosure. It is confined to WARNINGS on
  // that one field, because severity carries the consequence: an ERROR marks
  // the report DRAFT, a warning does not. The ERROR set is compared with no
  // exemption at all, and nothing may be REMOVED.
  // Pinned as the WHOLE issue string, not a (severity, field) prefix. Keying on
  // the pair and probing with `some` would swallow a SECOND, different warning
  // on `vat.registered` -- the exemption has to name one message, not a field.
  const MIGRATION_DISCLOSURE = 'warning vat.registered '
    + 'The VAT engine is switched off (vat.registered: false), but this document has a '
    + 'non-zero construction cost. Input VAT on construction and fees will be reported as '
    + 'zero throughout, including any that would otherwise be recoverable.';

  function issueKeys(issues: ValidationIssue[]): string[] {
    return issues.map((i) => `${i.severity} ${i.field} ${i.message}`).sort();
  }

  /** Returns the exempted additions, so callers can assert non-vacuity. */
  function assertIssueSetsAgree(before: string[], after: string[], name: string): string[] {
    const removed = before.filter((i) => !after.includes(i));
    expect(removed, `${name}: migration to v8 REMOVED a validation issue`).toEqual([]);

    const errorsBefore = before.filter((i) => i.startsWith('error '));
    const errorsAfter = after.filter((i) => i.startsWith('error '));
    expect(
      errorsAfter,
      `${name}: migration to v8 changed the ERROR set — an error marks the report DRAFT (R38)`,
    ).toEqual(errorsBefore);

    const added = after.filter((i) => !before.includes(i));
    const unexpected = added.filter((i) => i !== MIGRATION_DISCLOSURE);
    expect(
      unexpected,
      `${name}: migration to v8 added an issue other than §17.9's inert-engine disclosure`,
    ).toEqual([]);

    const exempted = added.filter((i) => i === MIGRATION_DISCLOSURE);
    expect(
      exempted.length,
      `${name}: the §17.9 exemption covers at most ONE issue`,
    ).toBeLessThanOrEqual(1);
    return exempted;
  }

  // R11: restricted to preV8Fixtures for the same reason as the numeric/structural
  // gate above -- fixture R is already registered:true, so §17.9's "registered:
  // false with non-zero construction cost" disclosure can never fire for it either
  // side of the merge, and the cross-check below (which assumes every fixture here
  // WAS registered:false pre-migration) would be asserting the wrong claim.
  it.each(preV8Fixtures.map((f) => f.name))(
    'migrating %s to v8 adds and removes no validation issue',
    (name) => {
      const fx = preV8Fixtures.find((f) => f.name === name)!;
      const before = issueKeys(validateInputs(fx.inputs));
      const migrated = migrateInputsToV8(fx.inputs as unknown as Record<string, unknown>);
      const after = issueKeys(validateInputs(migrated));

      const exempted = assertIssueSetsAgree(before, after, name);

      // Cross-check the exemption against §17.9's own condition rather than
      // trusting it: the disclosure must appear exactly where a non-zero
      // RESOLVED construction cost makes it true, and nowhere else.
      //
      // Minor 4 (whole-branch review): this used to check
      // `migrated.conversion_costs.total_construction_sqm > 0`, which is a
      // PROXY, not §17.9's own condition — validation.ts's warning actually
      // reads `resolvedCostPlan.construction_total_pence !== 0`, and in
      // detailed mode the base build is derived from `cost_plan.packages`,
      // not from `total_construction_sqm` at all. The two quantities agree on
      // every fixture in this corpus today (this is latent, not yet
      // observed), so the proxy previously read as correct. Recomputed here
      // exactly as validation.ts does, so a future fixture where the two
      // diverge is actually caught.
      const resolvedConstructionTotal = computeCostPlan(
        migrated,
        areaBridge(migrated).developed_area_sqm,
        migrated.unit_mix.units.length,
      ).construction_total_pence;
      expect(exempted.length === 1)
        .toBe(resolvedConstructionTotal !== 0);
    },
  );

  // Non-vacuity, corpus-wide (spec §17.11 names it; the Python twin asserts
  // `disclosed > 0`). `it.each` above runs one test per fixture, so none of them
  // can see whether the carve-out is exercised ANYWHERE -- if §17.9's warning
  // stopped firing entirely, every per-fixture case would still pass while the
  // exemption silently became dead weight.
  it('exercises the §17.9 exemption on at least one fixture, so the carve-out is not dead', () => {
    const disclosed = preV8Fixtures.filter((fx) => {
      const before = issueKeys(validateInputs(fx.inputs));
      const after = issueKeys(validateInputs(
        migrateInputsToV8(fx.inputs as unknown as Record<string, unknown>),
      ));
      return after.filter((i) => !before.includes(i)).includes(MIGRATION_DISCLOSURE);
    });
    expect(disclosed.length).toBeGreaterThan(0);
  });

  // The synthetic case the fixture corpus does not contain, and the exact shape
  // R38 was written for: `first_period_end_month` defaults to 2, so a short term
  // is the document where an ungated return-cycle bound fires.
  //
  // BOTH terms, per §17.11 (R39). Term 2 is the `>=`-versus-`>` boundary: the
  // migration writes `first_period_end_month: 2`, so a rule re-weakened to
  // `> term_months`, or a gate re-narrowed to something like
  // `registered || term_months >= 2`, FAILS at term 2 and PASSES at term 1. A
  // term-1-only case would let either regression back in.
  it.each([1, 2])('adds no validation issue to a %i-month document (R38)', (termMonths) => {
    const v7 = migrateInputsToV7({ inputs_version: 1 });
    const source = JSON.parse(JSON.stringify({
      ...v7, finance: { ...v7.finance, term_months: termMonths },
    })) as Record<string, unknown>;

    const before = issueKeys(validateInputs(source as unknown as AnyCalculatorInputs));
    const migrated = migrateInputsToV8(source);
    const after = issueKeys(validateInputs(migrated));

    // Non-vacuity: the migrated document really does carry the block whose
    // bound would fire, on a term short enough to trip it.
    expect(migrated.vat.registered).toBe(false);
    expect(migrated.vat.first_period_end_month).toBe(2);
    expect(migrated.finance.term_months).toBe(termMonths);
    expect(migrated.vat.first_period_end_month).toBeGreaterThanOrEqual(termMonths);

    assertIssueSetsAgree(before, after, `synthetic ${termMonths}-month document`);
    expect(after.some((i) => i.includes('vat.first_period_end_month'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R12 Task 8 (spec §18.7, guard 6 of §13) — the v8 → v9 migration identity
// gates. This is the release's main protection for real stored appraisal
// data: gate 1 proves no computed figure moves, gate 2 proves validateInputs
// returns the SAME issue set either side of migration. Gate 2 exists because
// of a real defect (R11): a migration that moved no number gave every
// short-term document a hard validation error from a block the engine
// otherwise ignored, silently downgrading its report to DRAFT while gate 1
// stayed green throughout. Gate 1 cannot see that axis; gate 2 is written
// for exactly it.
//
// R12 Task 12b — what gate 1 proves NOW. Task 8's exclusion of the two
// programme-bearing fixtures is gone (the network arms it existed for are
// wired: Tasks 9–12a), so the gate runs over every fixture with a v8
// antecedent and covers BOTH of the migration's arms:
//
//   (a) the five additive no-ops — `phase_id: null` on every cost package
//       and fee line, `anchor: null` on every sales-phasing tranche and on
//       refinance, `phase_slip_phase_id: null` / `phase_slip_months: 0` on
//       all four scenarios — move no computed figure. Every fixture in
//       scope exercises this arm.
//
//   (b) the three-package → precedence-network conversion moves no computed
//       figure either. Exercised by `h-programme-scurve` and
//       `r-vat-quarterly`, the only two in-scope fixtures whose stored
//       `programme` is non-null (asserted below, so this claim cannot go
//       vacuous if a fixture is edited). This holds because migration
//       writes no per-line `phase_id`: every cost line resolves to its
//       category default, the (phase, category) bucket total IS the
//       category total, and the derived-window spread is bit-identical to
//       the legacy arm's single spread.
//
// What gate 1 still does NOT compare is `schedule.programme` itself — null
// on the v8 side, the derived network on the v9 side. That block is a v9
// addition with no v8 counterpart, so there is nothing to be identical to;
// it is pinned by the programme fixtures' own expectations and by Task
// 9–12a's derivation tests, not here.
//
// Fixture stems, correlated by index with `fixtures` (both built off the
// same `fixtureFiles` scan above) rather than parsed from the human-readable
// `name` field, which carries no stem at all.
const fixtureStemsByFixture = new Map(fixtures.map((fx, i) => [fx, fixtureFiles[i].replace(/\.json$/, '')]));
const fixtureByStem = new Map(fixtures.map((fx, i) => [fixtureFiles[i].replace(/\.json$/, ''), fx]));

// Rule 2 (Task 8's TEMPORARY exclusion of `h-programme-scurve` and
// `r-vat-quarterly`) is DELETED here, Task 12b. It existed because both
// engines were deliberately made to fail loudly on a populated v9 programme
// network before the network arms were wired; Tasks 9–12a wired them, so
// the exclusion has served its purpose and the two programme-bearing
// fixtures are now the most valuable documents in this gate's scope — they
// are the only ones that make the migration's network conversion execute.
// Rule 3 (the exclusion is self-policing) goes with it; an empty exclusion
// needs no policing, and the test below now polices the opposite property.

// Rule 1 (RETAINED): only fixtures whose STORED inputs_version is 8 or below
// have a v8 antecedent to migrate from — migrateInputsToV8 called on an
// already-v9 document would throw, and there would be nothing to compare.
// No v9-tagged fixture exists yet; a later release adds one, so the filter
// stays.
const migrationV9GateFixtures = appraisalFixtures.filter((fx) => versionOf(fx) <= 8);

// The two fixtures whose stored `programme` is non-null, and therefore the
// only ones for which migration builds a precedence network at all. Named
// here so the gate can assert they are IN scope rather than merely hoping.
const PROGRAMME_BEARING_STEMS = ['h-programme-scurve', 'r-vat-quarterly'] as const;

// Fix round 1, Finding 6: keyed by file STEM, not the human-readable `name`
// field. Two fixtures sharing a display name would silently shadow one
// another under a find-by-name lookup; stems are already unique (they are
// filenames) and are already how the exclusion list above is expressed.
const GATE_FIXTURE_STEMS = migrationV9GateFixtures.map((fx) => fixtureStemsByFixture.get(fx)!);

function loadFixture(stem: string): Fixture {
  const fx = fixtureByStem.get(stem);
  if (!fx || !migrationV9GateFixtures.includes(fx)) {
    throw new Error(`loadFixture: "${stem}" is not in the v9 migration gate's fixture set`);
  }
  return fx;
}

// PROGRAMME_FIELD_ALIASES is imported from migrate.ts (Task 6/7), where it is
// DERIVED from PACKAGE_TO_PHASE, not redefined here: a second, hand-written
// copy could gain a fourth entry without anything failing, which is exactly
// the property the exemption must not have. Declared ahead of
// `stripVersionFields` because gate 1 now needs it too (Finding 2).
const canonicalIssue = (i: ValidationIssue) => ({
  severity: i.severity,
  field: PROGRAMME_FIELD_ALIASES[i.field] ?? i.field,
  message: i.message,
});
// Fix round 1, Finding 4: sorts the FULL (severity, field, message) triple.
// Sorting on field+message alone let two issues that share a field and
// message but differ in severity order differently on the two sides of a
// comparison, which is a spurious failure this gate must not produce.
const sortIssuesForV9Gate = (xs: ValidationIssue[]) =>
  xs.map(canonicalIssue)
    .sort((a, b) => (a.severity + a.field + a.message).localeCompare(b.severity + b.field + b.message));

// Task 12b. Gate 2 used to assert exact issue-set equality. With the two
// programme-bearing fixtures in scope that assertion is WRONG, not merely
// strict: the legacy three-package validation arm has NO OVERRUN RULE AT
// ALL, so a migrated document legitimately reports errors its v8 antecedent
// could never have produced. (Both fixtures breach the sale-tail rule at all
// three synthetic terms on BOTH sides — that part still matches exactly; it
// is only the overrun errors that are new.)
//
// The exemption is a NAMED LIST of v9-only RULES, asserted below to hold
// exactly one entry — the same self-policing discipline
// PROGRAMME_FIELD_ALIASES already carries. It is deliberately NOT the same
// kind of thing as that alias map: an alias is a field RENAME across the
// boundary, where the rule fires identically on both sides; this list is for
// rules that exist on one side only.
/** The overrun rule's MESSAGE shape (spec §18.8), kept separate from the
 *  predicate below. The "overrun really fires" control keys on this alone and
 *  then asserts severity and field independently: a control that reused the
 *  whole predicate could not tell a rule that stopped firing from a predicate
 *  that had been narrowed past it. */
const OVERRUN_MESSAGE_RE =
  /^Programme finishes month -?\d+; facility term is -?\d+\. Phase '.+' ends -?\d+ months after maturity\.$/;

type CanonicalIssue = ReturnType<typeof canonicalIssue>;

const V9_ONLY_VALIDATION_RULES: Record<string, (i: CanonicalIssue) => boolean> = {
  // spec §18.8. A phase whose derived finish runs past facility maturity.
  // It is a property of the DERIVED network, and the legacy arm derives
  // nothing, so there is no v8 counterpart to compare against.
  //
  // Fix round 1, Finding 2: keyed on ALL THREE of the keys a ValidationIssue
  // actually has, not on the message alone. There is no stable rule id in
  // either engine, so message text is unavoidable — but an unrelated field
  // emitting this shape, or this rule downgraded to a warning, must NOT be
  // exempted. Both would be a real change across the migration boundary and
  // gate 2 exists to see them.
  overrun: (i) => i.severity === 'error'
    && i.field.startsWith('programme.phases.')
    && OVERRUN_MESSAGE_RE.test(i.message),
};

const isV9OnlyRuleIssue = (i: CanonicalIssue) =>
  Object.values(V9_ONLY_VALIDATION_RULES).some((matches) => matches(i));

/** Property 3's comparison, extracted (fix round 1, Finding 1) so that its
 *  ONE-SIDEDNESS can be tested directly rather than asserted in prose.
 *
 *  The v9-only exemption is applied to the `after` side ONLY. A v9-only-rule
 *  issue appearing on the `before` side would mean a LEGACY rule had started
 *  emitting a shape it has no business emitting — that must fail the
 *  comparison, not be quietly dropped alongside its v9 twin.
 *
 *  This matters more than it reads: the pre-migration side carries no such
 *  issue on any case today, so a "tidy-up" to a symmetric filter would be a
 *  SILENT no-op. R11 was defined by a guard that died from being widened, so
 *  the one-sidedness is pinned by its own synthetic test below.
 *
 *  Returns the pair rather than a boolean so a gate failure still prints a
 *  readable diff. */
function compareExV9Only(beforeIssues: ValidationIssue[], afterIssues: ValidationIssue[]) {
  return {
    before: sortIssuesForV9Gate(beforeIssues),
    after: sortIssuesForV9Gate(afterIssues).filter((i) => !isV9OnlyRuleIssue(i)),
  };
}

const hardIssues = (xs: ValidationIssue[]) => xs.filter((i) => i.severity === 'error');

/** Gate 1 compares the WHOLE computed result, not a hand-picked list of
 *  metrics — a chosen list is a guard that only watches what its author
 *  remembered.
 *
 *  Fix round 1, Finding 2: `AppraisalRun` has six members. Four are compared
 *  here — `metrics`, `model`, `schedule`, `reconciliation` — and two are
 *  deliberately left out, named rather than silently dropped: `inputs`
 *  differs by construction (it IS the migrated document, v8 shape vs v9
 *  shape), and `validation` is covered by gate 2 below, which already
 *  asserts on it directly with the alias canonicalisation this comparison
 *  would otherwise have to duplicate. `reconciliation.issues` gets that same
 *  canonicalisation here, because `reconciliation` carries `report_safe` —
 *  the DRAFT flag this whole task exists to protect — and a programme-field
 *  alias could in principle appear inside it too.
 *
 *  `calc_version` (2.10.0 vs 2.11.0) and the new `schedule.programme` block
 *  legitimately differ and are the only two fields stripped out of the four
 *  compared members. Since Task 12b removed the exclusion, `schedule.programme`
 *  really does differ for the two programme-bearing fixtures — null on the v8
 *  side, the derived network on the v9 side — because it is a v9 addition with
 *  no v8 counterpart. Everything the network FEEDS (the monthly spend, the
 *  facility, every metric) is inside the comparison and must be identical. */
function stripVersionFields(run: AppraisalRun): unknown {
  const { calc_version: _calc_version, ...metrics } = run.metrics;
  const { programme: _programme, ...schedule } = run.schedule;
  const reconciliation = { ...run.reconciliation, issues: sortIssuesForV9Gate(run.reconciliation.issues) };
  return {
    metrics, model: run.model, schedule, reconciliation,
  };
}

function withTermMonths(inputs: AnyCalculatorInputs, termMonths: number): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
  (doc.finance as Record<string, unknown>).term_months = termMonths;
  return doc;
}

/** Every gate-2 case: each in-scope fixture at its STORED term, plus the same
 *  fixture at synthetic terms 1, 2 and 3. The three properties below each run
 *  over the whole list, so a defect that only shows at a short term is caught
 *  by the same assertion as one that shows at the stored term. */
const V9_GATE_CASES: Array<[string, Record<string, unknown>]> = GATE_FIXTURE_STEMS.flatMap((stem) => {
  const raw = loadFixture(stem);
  const cases: Array<[string, Record<string, unknown>]> = [
    [`${stem} @ stored term`, JSON.parse(JSON.stringify(raw.inputs)) as Record<string, unknown>],
  ];
  for (const term of [1, 2, 3]) cases.push([`${stem} @ term ${term}`, withTermMonths(raw.inputs, term)]);
  return cases;
});

describe('v8 → v9 migration gate scope — spec §18.7 Rule 1', () => {
  it('the gate fixture set is non-empty and excludes ONLY v9-born fixtures', () => {
    // Fix round 1, Finding 3: a PINNED FLOOR, not `> 0`. The equality below
    // compares `!(version <= 8)` against `version > 8` — both derived from
    // the same expression — so it catches an ADDED second filter clause (its
    // purpose) but not a NARROWED one (`<= 7`), which moves both sides
    // together. The floor is what catches a silently shrinking corpus: 13 is
    // today's count and the corpus only ever grows.
    expect(GATE_FIXTURE_STEMS.length).toBeGreaterThanOrEqual(13);
    const excluded = appraisalFixtures.filter((fx) => !migrationV9GateFixtures.includes(fx));
    // The only legitimate reason to be out of scope is having no v8
    // antecedent. Today that set is empty; when a v9-born fixture is added
    // this still passes, and any OTHER exclusion fails.
    expect(excluded.map((fx) => fixtureStemsByFixture.get(fx))).toEqual(
      appraisalFixtures.filter((fx) => versionOf(fx) > 8).map((fx) => fixtureStemsByFixture.get(fx)),
    );
  });

  it('both programme-bearing fixtures are IN scope, and really do carry a legacy programme', () => {
    // The point of Task 12b. If either of these ever drops out of scope —
    // by exclusion, by being re-stamped v9, or by losing its `programme`
    // block — the migration's network conversion silently stops being
    // covered by gate 1, which is the state Task 8 shipped and this task
    // exists to end.
    for (const stem of PROGRAMME_BEARING_STEMS) {
      expect(GATE_FIXTURE_STEMS).toContain(stem);
      const raw = loadFixture(stem);
      expect((raw.inputs as unknown as { programme?: unknown }).programme).not.toBeNull();
      expect((raw.inputs as unknown as { programme?: unknown }).programme).toBeDefined();
      // And migration really does build a network from it.
      const migrated = migrateInputsToV9(raw.inputs as unknown as Record<string, unknown>) as unknown as
        { programme: { phases: unknown[] } | null };
      expect(migrated.programme?.phases).toHaveLength(3);
    }
    // And no OTHER in-scope fixture carries one — so the two named above are
    // exhaustive, not merely examples.
    const bearing = GATE_FIXTURE_STEMS.filter(
      (stem) => (loadFixture(stem).inputs as unknown as { programme?: unknown }).programme != null,
    );
    expect(bearing.sort()).toEqual([...PROGRAMME_BEARING_STEMS].sort());
  });
});

// Task 12b: this gate now proves BOTH arms of the migration move no computed
// figure — the five additive no-ops on every fixture, and the three-package →
// precedence-network conversion on the two programme-bearing ones. See the
// file-level comment above for the full statement.
// Task 16 falsifiability audit (gate 1). Single-line change that kills this
// guard: schedule.ts's `resolvedPhaseId`, `return phaseId ?? network
// .category_phase_ids[category];` -> `return phaseId ?? network
// .category_phase_ids.construction;`. Verified: 2 of the 13 cases fail — the
// two programme-bearing fixtures (h-programme-scurve, r-vat-quarterly),
// whose migrated networks resolve professional/statutory to their own
// category default and so shift window when that default is silently
// overridden — the other 11 (no `programme` block) are correctly unaffected.
// Reverted after confirming the guard, and the rest of this file, pass again
// clean. (Task 12b's own review additionally perturbed
// `construction.duration_months + 1` post-migration and found it moves
// profit on both programme-bearing fixtures — a second, independent
// confirmation this gate is live, not vacuous.)
describe('v8 → v9 migration identity — spec §18.7 gate 1 (numeric, both migration arms)', () => {
  it.each(GATE_FIXTURE_STEMS)('%s: every computed figure is penny-identical', (stem) => {
    const raw = loadFixture(stem);
    const before = runAppraisal(migrateInputsToV8(raw.inputs as unknown as Record<string, unknown>));
    const after = runAppraisal(migrateInputsToV9(raw.inputs as unknown as Record<string, unknown>));
    expect(stripVersionFields(after)).toEqual(stripVersionFields(before));
  });
});

// Task 16 falsifiability audit (gate 2). Single-line change that kills
// property 3 below: `compareExV9Only`'s `after: sortIssuesForV9Gate
// (afterIssues).filter((i) => !isV9OnlyRuleIssue(i))` -> dropping the
// `.filter(...)` entirely (no exemption applied at all). Task 12b's fix
// round 1 (Finding 1) made and ran exactly this class of mutation — widening
// the filter to strip the v9-only issue from BOTH sides instead of just
// `after` — and it failed exactly one test,
// "property 3's comparison is ONE-SIDED", and nothing else; dropping the
// filter outright is a strict superset of that same widening and fails
// property 3 itself on every case where the overrun rule fires (both
// programme-bearing fixtures at their short synthetic terms). This task's own
// mutation of the `overrun` predicate (see "the overrun rule really fires",
// below) is the same falsifiability discipline applied to the OTHER moving
// part of this gate — the rule-membership predicate rather than the
// one-sidedness of its application.
describe('v8 → v9 migration identity — spec §18.7 gate 2 (validation)', () => {
  it('the alias map has EXACTLY three entries, and each maps name → same name', () => {
    // The bound. R11's lesson was that an exemption must be narrow BY
    // CONSTRUCTION, not by intention — this test is the construction, and
    // because the map is derived from PACKAGE_TO_PHASE it constrains the
    // migration's phase ids at the same time.
    expect(Object.keys(PROGRAMME_FIELD_ALIASES)).toHaveLength(3);
    expect(Object.keys(PROGRAMME_FIELD_ALIASES).sort())
      .toEqual(['programme.packages.construction', 'programme.packages.professional',
                'programme.packages.statutory']);
    for (const [from, to] of Object.entries(PROGRAMME_FIELD_ALIASES)) {
      // The alias is legitimate ONLY because migration writes id = package name.
      expect(to).toBe(from.replace('.packages.', '.phases.'));
    }
  });

  it('the v9-only rule list has EXACTLY one entry, named', () => {
    // Same discipline as the alias map above, for a different kind of
    // exemption. An unpoliced list of "rules we do not compare" is a gate
    // that stops gating one rule at a time.
    expect(Object.keys(V9_ONLY_VALIDATION_RULES)).toEqual(['overrun']);
  });

  // The three properties. R11's actual failure: the v8 migration gave every
  // document a block whose default made every term<=2 appraisal a hard
  // error, so the migration silently downgraded them to DRAFT while the
  // numeric gate stayed green. Terms 1–3 are run alongside each fixture's
  // stored term because that is where the interesting behaviour lives; term
  // 3 goes one step further than R11's own boundary, so a rule re-narrowed
  // to a fixed "<= 2" cutoff would still be caught.
  it.each(V9_GATE_CASES)('%s: property 1 — a valid document never becomes INVALID', (_label, doc) => {
    const before = hardIssues(validateInputs(migrateInputsToV8(doc)));
    if (before.length > 0) return; // premise false; property 2 covers this case
    // UNCONDITIONAL — no v9-only-rule exemption applies here. This is the
    // historical defect: a document that validated clean before migration
    // and reports DRAFT after it.
    expect(hardIssues(validateInputs(migrateInputsToV9(doc)))).toEqual([]);
  });

  it.each(V9_GATE_CASES)('%s: property 2 — an invalid document never becomes VALID', (_label, doc) => {
    const before = hardIssues(validateInputs(migrateInputsToV8(doc)));
    if (before.length === 0) return; // premise false; property 1 covers this case
    // Also UNCONDITIONAL, and it catches a real sibling of the R11 defect:
    // v9 treats a zero-duration phase as a legal milestone where the legacy
    // arm rejected `duration < 1`, so a migration could silently UPGRADE a
    // broken document to report-safe.
    expect(hardIssues(validateInputs(migrateInputsToV9(doc))).length).toBeGreaterThan(0);
  });

  it.each(V9_GATE_CASES)('%s: property 3 — issue sets equal, except v9-only rules', (_label, doc) => {
    const { before, after } = compareExV9Only(
      validateInputs(migrateInputsToV8(doc)), validateInputs(migrateInputsToV9(doc)),
    );
    expect(after).toEqual(before);
  });

  it("property 3's comparison is ONE-SIDED — a v9-only issue on the BEFORE side fails it", () => {
    // Fix round 1, Finding 1a. Synthetic, because no real case can produce
    // this shape on the before side — which is precisely why a symmetric
    // filter would be a silent no-op over the corpus and needs a test that
    // dies on the refactor rather than a comment asking nobody to do it.
    const overrunShaped: ValidationIssue = {
      severity: 'error',
      field: 'programme.phases.construction',
      message: "Programme finishes month 7; facility term is 3. Phase 'Construction' ends 4 months after maturity.",
    };
    const shared: ValidationIssue = { severity: 'warning', field: 'vat.registered', message: 'shared' };
    expect(isV9OnlyRuleIssue(overrunShaped)).toBe(true); // the predicate really recognises it

    // AFTER side carries it → exempted, comparison AGREES. The exemption
    // doing its job; without this half, deleting the filter outright would
    // still pass the half below.
    const onAfter = compareExV9Only([shared], [shared, overrunShaped]);
    expect(onAfter.after).toEqual(onAfter.before);

    // BEFORE side carries it → NOT exempted, comparison DISAGREES. A
    // symmetric filter strips it here too and makes these equal, so this
    // assertion fails on exactly the refactor that would weaken the gate.
    const onBefore = compareExV9Only([shared, overrunShaped], [shared]);
    expect(onBefore.after).not.toEqual(onBefore.before);
  });

  it('no PRE-migration document in the corpus carries a v9-only-rule issue', () => {
    // Fix round 1, Finding 1b: the invariant that makes the one-sidedness
    // above safe today, asserted directly instead of assumed. The day a
    // legacy rule starts emitting the overrun shape, this fails loudly.
    // Checked on the CANONICALISED before side, because that is what the
    // comparison actually sees (a legacy `programme.packages.*` field is
    // aliased to `programme.phases.*` before any predicate runs).
    const offenders = V9_GATE_CASES
      .filter(([, doc]) => sortIssuesForV9Gate(validateInputs(migrateInputsToV8(doc))).some(isV9OnlyRuleIssue))
      .map(([label]) => label);
    expect(offenders).toEqual([]);
  });

  it('the three properties are not vacuous over the corpus', () => {
    // Property 1's premise, property 2's premise, and property 3's exemption
    // must each be satisfied by at least one case — otherwise a property can
    // pass by never applying to anything.
    let cleanBefore = 0; let dirtyBefore = 0; let exempted = 0;
    for (const [, doc] of V9_GATE_CASES) {
      if (hardIssues(validateInputs(migrateInputsToV8(doc))).length === 0) cleanBefore += 1;
      else dirtyBefore += 1;
      exempted += validateInputs(migrateInputsToV9(doc)).filter(isV9OnlyRuleIssue).length;
    }
    expect(cleanBefore).toBeGreaterThan(0);
    expect(dirtyBefore).toBeGreaterThan(0);
    expect(exempted).toBeGreaterThan(0);
  });

  it('the overrun rule really fires — excluding it from gate 2 cannot hide a dead rule', () => {
    // Without this, property 3's exemption would keep passing if the overrun
    // rule were deleted, broken, or reworded out of its own predicate.
    // Fixture H's migrated network finishes month 7; at a 3-month term all
    // three phases run past maturity.
    const shortened = withTermMonths(loadFixture('h-programme-scurve').inputs, 3);
    const issues = validateInputs(migrateInputsToV9(shortened));
    // Fix round 1, Finding 2: selected by MESSAGE SHAPE alone, then severity
    // and field asserted independently. Selecting with the full predicate
    // would make those two assertions tautological, and a predicate narrowed
    // past the real rule would then look like a rule that still fires.
    const overruns = issues.filter((i) => OVERRUN_MESSAGE_RE.test(i.message));
    expect(overruns).toHaveLength(3);
    expect(overruns.every((i) => i.severity === 'error')).toBe(true);
    expect(overruns.map((i) => i.field).sort()).toEqual([
      'programme.phases.construction', 'programme.phases.professional', 'programme.phases.statutory',
    ]);
    // ... and the predicate really does cover every one of them, so property
    // 3's exemption and the rule that fires are the same set, not two sets
    // that merely overlap.
    expect(overruns.every(isV9OnlyRuleIssue)).toBe(true);
    // Task 12b's deferred gap (Task 16): the assertion above only proves the
    // predicate is a SUPERSET of the message-shaped set over THESE three
    // fields — it would not notice a `field.startsWith('programme.phases.')`
    // check replaced by an enumeration of exactly these three ids, which
    // would pass every assertion above by coincidence (this fixture's phases
    // happen to BE that trio). Two synthetic checks close that: the
    // predicate must accept a phase id this fixture does not have (proving
    // it matches by PREFIX, not by enumerating known ids)...
    const arbitraryPhaseOverrun: CanonicalIssue = {
      severity: 'error',
      field: 'programme.phases.some-other-phase-id-not-in-this-fixture',
      message: "Programme finishes month 7; facility term is 3. Phase 'Other' ends 4 months after maturity.",
    };
    expect(isV9OnlyRuleIssue(arbitraryPhaseOverrun)).toBe(true);
    // ...and must reject the identical severity+message on a field OUTSIDE
    // `programme.phases.` — otherwise the field check could be replaced with
    // `true` and nothing above would notice.
    expect(isV9OnlyRuleIssue({ ...arbitraryPhaseOverrun, field: 'sales_phasing.tranches.0' })).toBe(false);
    // Each phase quotes ITS OWN lateness, not the programme's (Task 9's fix
    // round 1, Finding 1) — so the exemption is not swallowing a rule that
    // has silently degenerated to one message repeated three times.
    expect(new Set(overruns.map((i) => i.message)).size).toBe(3);
    // And it does NOT fire at the stored term: a predicate that matched
    // everything would satisfy the assertions above just as well.
    expect(validateInputs(migrateInputsToV9(
      loadFixture('h-programme-scurve').inputs as unknown as Record<string, unknown>,
    )).filter(isV9OnlyRuleIssue)).toEqual([]);
  });

  it('a term-2 document from a GATED fixture really does produce a genuine short-term issue', () => {
    // Fix round 1, Finding 3 (Task 8): the original version of this control
    // asserted on fixture H, and the error satisfying it was the temporary
    // "v9 programme network... not yet implemented" placeholder that Task 9
    // deletes, at which point the control would have silently stopped
    // testing anything. It proved neither that a GATED document produces
    // issues, nor that a short-term RULE is what fires.
    //
    // This version uses fixture I, which carries a `sales_phasing` block
    // whose three tranches sit at months 9/10/11 of a 12-month term.
    // Shortened to a 2-month term, `term - 1 = 1`, so every tranche breaches
    // sales_phasing's own permanent term bound — a rule with nothing to do
    // with programme scaffolding, and one that is NOT on the v9-only list,
    // so property 3 compares it on both sides.
    const raw = loadFixture('i-phased-sales');
    const shortened = withTermMonths(raw.inputs, 2);
    const issues = validateInputs(migrateInputsToV9(shortened));
    const tailIssues = issues.filter(
      (i) => i.severity === 'error' && i.field.startsWith('sales_phasing.tranches'),
    );
    expect(tailIssues.length).toBeGreaterThan(0);
    expect(tailIssues.every((i) => i.message === 'Tranche month must be a whole month between 0 and 1.')).toBe(true);
    // Sanity: this must not be satisfied by the scaffolding placeholder the
    // original control (mistakenly) relied on.
    expect(issues.some((i) => i.message.includes('not yet implement'))).toBe(false);
  });
});

describe('Fixture K — sensitivity suite (spec §12)', () => {
  interface SensitivityFixture {
    name: string;
    kind: 'sensitivity';
    base_fixture: string;
    config: SensitivityConfig;
    expected_derived_inputs: Record<string, Record<string, number>>;
    expected_base: Record<string, number | string[]>;
    expected_corner_cells: Array<Record<string, number | string[]>>;
    expected_tornado_order: string[];
    expected_tornado_spans_pence: Record<string, number>;
    invalid_case: {
      note: string;
      config: SensitivityConfig;
      expected_unmeasured_rows: number[];
      expected_measured_rows: number[];
      expected_unmeasured_error: { severity: string; field: string; message: string };
    };
  }

  const k = JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'k-sensitivity.json'), 'utf-8'),
  ) as SensitivityFixture;

  const baseInputs = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${k.base_fixture}.json`), 'utf-8'),
  ).inputs as AnyCalculatorInputs;

  const result = runSensitivity(baseInputs, k.config);

  // Hand-derived: the per-axis derived inputs (§12.1 disjointness makes these per axis,
  // not per cell). A lever-composition bug shows up here first.
  it('applies each lever to the hand-derived value', () => {
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.gdv)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: Number(step),
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
        phase_slip_phase_id: null,
        phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
      });
      expect(levered.unit_mix.units.every((u) => u.estimated_value_pence === expected)).toBe(true);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.construction_cost)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: Number(step), timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
        phase_slip_phase_id: null,
        phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
      });
      expect(levered.conversion_costs.construction_cost_per_sqm_pence).toBe(expected);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.timeline)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: Number(step),
        interest_rate_adjustment_pct: 0,
        phase_slip_phase_id: null,
        phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
      });
      expect(levered.finance.term_months).toBe(expected);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.interest_rate)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: Number(step),
        phase_slip_phase_id: null,
        phase_slip_months: 0,
        exit_yield_adjustment_pct: 0,
        operating_cost_adjustment_pct: 0,
        vacancy_adjustment_pct: 0,
      });
      expect(levered.finance.annual_interest_rate_pct).toBe(expected);
    }
  });

  // Hand-derived: reused verbatim from Fixture F (§12.5). `toEqual`, not `toBe`: the
  // `flags` pin is an array, and `toBe`'s reference equality would fail against any
  // freshly-built array even when its contents match — a pin that could never bite.
  it('reports the hand-derived base case', () => {
    for (const [key, expected] of Object.entries(k.expected_base)) {
      expect(result.base[key as keyof typeof result.base]).toEqual(expected);
    }
  });

  // Hand-derived: two corners worked through on a worksheet
  // (docs/financial-model/test-cases.md, "Fixture K — sensitivity suite").
  it('reports the hand-derived corner cells', () => {
    for (const corner of k.expected_corner_cells) {
      // Matched by filter-and-count rather than `.find`, mirroring the Python assertion:
      // a matrix that enumerated a grid position twice would silently satisfy a
      // first-match lookup, and a corner assertion that can pass against a duplicated
      // cell is not pinning the position it names.
      const matches = result.matrix
        .flat()
        .filter((c) => c.row_step === corner.row_step && c.col_step === corner.col_step);
      expect(matches, `corner ${corner.row_step}/${corner.col_step}`).toHaveLength(1);
      const found = matches[0] as unknown as Record<string, unknown>;
      for (const [key, expected] of Object.entries(corner)) {
        if (key === 'row_step' || key === 'col_step') continue;
        expect(found[key], `corner ${corner.row_step}/${corner.col_step} → ${key}`).toEqual(expected);
      }
    }
  });

  // Hand-derived: spans and the resulting order.
  it('reports the hand-derived tornado spans and order', () => {
    expect(result.tornado.map((b) => b.lever)).toEqual(k.expected_tornado_order);
    for (const bar of result.tornado) {
      expect(bar.span_pence).toBe(k.expected_tornado_spans_pence[bar.lever]);
    }
  });

  // Identity-asserted, not snapshotted: §12.3 *defines* a cell as this expression, so
  // the assertion is the contract. Wrong composition or enumeration is already caught
  // by the hand-derived derived-inputs and corners above.
  it('defines every remaining cell as the levered appraisal (spec §12.3)', () => {
    result.config.rows.steps.forEach((rowStep, ri) => {
      result.config.cols.steps.forEach((colStep, ci) => {
        const expected = runAppraisal(applyScenario(baseInputs, {
          label: '',
          gdv_adjustment_pct: colStep,
          construction_cost_adjustment_pct: rowStep,
          timeline_adjustment_months: 0,
          interest_rate_adjustment_pct: 0,
          phase_slip_phase_id: null,
          phase_slip_months: 0,
          exit_yield_adjustment_pct: 0,
          operating_cost_adjustment_pct: 0,
          vacancy_adjustment_pct: 0,
        })).metrics;
        const cell = result.matrix[ri][ci];
        expect(cell.profit_pence).toBe(expected.profit_pence);
        expect(cell.profit_on_cost_pct).toBe(expected.profit_on_cost_pct);
        expect(cell.ltgdv_developer_pct).toBe(expected.ltgdv_developer_pct);
        expect(cell.peak_debt_pence).toBe(expected.peak_debt_pence);
        expect(cell.flags).toEqual(expected.flags.map((f) => f.code));
      });
    });
  });

  // Hand-derived (§12.7): 12 + (−12) = 0 < 1, so that row is unmeasured; 12 + (−11) = 1,
  // which is legal, so that row must still measure. The measured row is the half that
  // matters — a rule that marked everything unmeasured would satisfy the other half alone.
  it('does not measure the positions §12.7 excludes, and still measures the boundary', () => {
    const ic = k.invalid_case;
    const r = runSensitivity(baseInputs, ic.config);

    for (const step of ic.expected_unmeasured_rows) {
      const row = r.matrix.find((cells) => cells[0].row_step === step);
      expect(row, `row ${step}`).toBeDefined();
      for (const cell of row!) {
        expect(cell.profit_pence, `row ${step} profit`).toBeNull();
        expect(cell.peak_debt_pence, `row ${step} peak debt`).toBeNull();
        expect(cell.flags, `row ${step} flags`).toEqual([]);
        expect(cell.validation_errors, `row ${step} errors`).toContainEqual(
          ic.expected_unmeasured_error,
        );
      }
    }

    for (const step of ic.expected_measured_rows) {
      const row = r.matrix.find((cells) => cells[0].row_step === step);
      expect(row, `row ${step}`).toBeDefined();
      for (const cell of row!) {
        expect(cell.validation_errors, `row ${step} errors`).toEqual([]);
        expect(cell.profit_pence, `row ${step} profit`).not.toBeNull();
      }
    }
  });
});
