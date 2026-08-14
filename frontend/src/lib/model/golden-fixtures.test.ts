import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import { migrateInputsToV4 } from './migrate';
import type { AppraisalRun } from './index';
import type { AnyCalculatorInputs, AppraisalResultV2 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

interface Fixture {
  name: string;
  // 'programme' marks a fixture whose `inputs` carry a non-null `programme` block
  // (spec §6.1, calc 2.2.0) — h-programme-scurve.json, Release 3a. It is a label
  // only: every fixture, whatever its kind, runs through the same `runAppraisal`
  // assertion loop below.
  kind: 'pipeline' | 'programme';
  // Widened from CalculatorInputsV2 in Release 3a: the corpus now mixes v3 and v4
  // documents, and `runAppraisal` takes the union directly (no downcast adapter).
  inputs: AnyCalculatorInputs;
  // Most keys are real AppraisalResultV2 properties. A few are not — they're a
  // fixture-authoring convenience mapped onto other parts of the run by FLAT_KEYS below
  // (the two cost_to_complete_* summary keys, spec §5.10; and funding_gap_pence, which
  // lives on the ledger totals rather than on the metrics object, spec §4.2).
  expected_metrics: Partial<AppraisalResultV2> & Record<string, unknown>;
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
];

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
};

describe('golden fixtures (shared with the Python engine)', () => {
  it('every expected fixture file is present in the shared corpus', () => {
    expect(fixtureFiles).toEqual(EXPECTED_FIXTURE_STEMS.map((s) => `${s}.json`));
  });

  function assertExpectedMetrics(run: AppraisalRun, fx: Fixture, label: string) {
    for (const [key, expected] of Object.entries(fx.expected_metrics)) {
      const mapper = FLAT_KEYS[key];
      const actual = mapper ? mapper(run) : run.metrics[key as keyof AppraisalResultV2];
      expect(actual, `${label}: ${key}`).toEqual(expected);
    }
  }

  for (const fx of fixtures) {
    it(fx.name, () => {
      assertExpectedMetrics(runAppraisal(fx.inputs), fx, fx.name);
    });
  }

  for (const fx of fixtures) {
    // Mirrors Python's test_pre_v4_fixtures_reproduce_their_metrics_after_migration_to_v4.
    it(`${fx.name} — reproduces its metrics after migration to v4`, () => {
      // Release 3a identity guarantee (spec §6.1 / design §2.4): the v3 → v4 migration
      // is purely additive, so running a fixture's inputs through the full normalisation
      // chain — exactly what app.py now does on every request — must reproduce that
      // fixture's pinned expected_metrics unchanged, not merely "close". Fixture H is
      // already v4; migrating it is a no-op merge onto v4 defaults, which is itself worth
      // asserting (the merge must not drop its programme block).
      const v4 = migrateInputsToV4(fx.inputs as unknown as Record<string, unknown>);
      expect(v4.inputs_version).toBe(4);
      assertExpectedMetrics(runAppraisal(v4), fx, `${fx.name}[migrated-to-v4]`);
    });
  }
});
