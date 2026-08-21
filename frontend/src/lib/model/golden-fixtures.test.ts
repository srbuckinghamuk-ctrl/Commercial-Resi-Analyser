import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import {
  migrateInputsToV5, migrateInputsToV6, migrateInputsToV7, migrateInputsToV8,
} from './migrate';
import { costPlanFromLegacyCosts } from './cost-plan';
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

  it('every fixture is v5, v6 or v7, and each group is non-empty', () => {
    expect(v5Fixtures.length + v6Fixtures.length + v7Fixtures.length).toBe(appraisalFixtures.length);
    expect(v5Fixtures.length).toBeGreaterThan(0);
    expect(v6Fixtures.map((f) => f.name).sort()).toEqual([
      'N — full area bridge, bridge-derived construction area, all-cash',
      'O — ancillary value, blended exit, one unit sold and one retained',
      'P — Scottish acquisition, LBTT non-residential, development finance',
    ]);
    expect(v7Fixtures.map((f) => f.name)).toEqual([
      'Q — detailed cost plan, three contingency classes, levered facility',
    ]);
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
  // corpus-wide statement is now the v7 loop immediately below.
  for (const fx of appraisalFixtures.filter((f) => versionOf(f) !== 7)) {
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

  for (const fx of appraisalFixtures) {
    // R10: the same identity guarantee one version further on, and the one that now
    // covers the WHOLE corpus — migrateInputsToV7 accepts v5, v6 and v7 documents alike
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

  it('the pre-R8 loop covers every England/NI v5 fixture and excludes only the v6, v7 and non-English ones', () => {
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
    ]);
    // Every exclusion is justified by one of the two stated reasons, not by silence.
    // R10 widens the second reason from "version === 6" to "version === 6 or 7":
    // fixture Q (v7) has no pre-R8 form for the same reason N/O/P (v6) do not —
    // asPreR8Document stamps v3/v4, and migrating that back up would leave the R9
    // areas/ancillary AND the R10 cost_plan blocks at their zeroed/legacy-derived
    // defaults, a different document.
    //
    // Fix round 1, I3: this must enumerate the versions the exclusion is genuinely
    // about, NOT negate preR8Fixtures's own defining condition ("=== 5" flipped to
    // "!== 5") — that phrasing is the literal complement of how `excluded` was built,
    // so it is vacuously true for every member and can never fail. Enumerating 6/7
    // keeps the check able to fail: it catches a fixture excluded for a THIRD,
    // unstated reason (e.g. a future non-v5/v6/v7 fixture, or a change to
    // preR8Fixtures's own filter that this assertion was never updated to match).
    for (const fx of excluded) {
      expect(
        jurisdictionOf(fx) !== 'england_ni' || versionOf(fx) === 6 || versionOf(fx) === 7,
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
    // Fixture P holds spec §5.10's deferred-defect figures. They are documented in the
    // spec and in test-cases §14.9, so they must be pinned by something that fails when
    // the behaviour changes — otherwise the deferral relies on someone remembering to
    // re-check the prose.
    {
      namePrefix: 'P — Scottish acquisition',
      wrongValues: {
        gross_sales_pence: 143999999,                  // truly 144000000
        cost_to_complete_first_shortfall_month: 2,     // truly 1
        cost_to_complete_max_shortfall_pence: 392484,  // truly 392483
        funding_gap_pence: 1,                          // truly 0 — the counter-example's
                                                       // other half: a shortfall WITH no gap
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
  it.each(appraisalFixtures.filter((f) => versionOf(f) !== 7).map((f) => f.name))(
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
  // above, one version further on, and now corpus-wide again: migrateInputsToV7
  // accepts v5, v6 and v7 documents alike (RECOGNISED_INPUTS_VERSIONS_V7 = 1–7).
  it.each(appraisalFixtures.map((f) => f.name))(
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
  it.each(appraisalFixtures.map((f) => f.name))(
    'migrating %s to v8 moves no computed figure, and writes the specified block',
    (name) => {
      const fx = appraisalFixtures.find((f) => f.name === name)!;
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
    expect(appraisalFixtures).toHaveLength(12);
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
      });
      expect(levered.unit_mix.units.every((u) => u.estimated_value_pence === expected)).toBe(true);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.construction_cost)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: Number(step), timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.conversion_costs.construction_cost_per_sqm_pence).toBe(expected);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.timeline)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: Number(step),
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.finance.term_months).toBe(expected);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.interest_rate)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: Number(step),
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
