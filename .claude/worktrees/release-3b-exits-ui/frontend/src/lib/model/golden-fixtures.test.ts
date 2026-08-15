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
  // (spec §6.1, calc 2.2.0) — h-programme-scurve.json, Release 3a; 'phased-sales'
  // one whose `inputs` carry a non-null `sales_phasing` block (spec §4.4.1, calc
  // 2.3.0) — i-phased-sales.json, Release 3b; 'refinance' one carrying a non-null
  // `refinance` block (spec §4.5, calc 2.3.0) — j-blended-refinance.json, which
  // carries both blocks and a `blended` exit route. All are labels only: every
  // fixture, whatever its kind, runs through the same `runAppraisal` assertion
  // loop below.
  kind: 'pipeline' | 'programme' | 'phased-sales' | 'refinance';
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
  'i-phased-sales',
  'j-blended-refinance',
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
  // spec §4.4.1 (calc 2.3.0), Release 3b: the phased-disposal redemption fields. Like
  // funding_gap_pence above, these are `model` properties rather than summary metrics, so
  // they reach the harness through the same AppraisalRun-wide mapper. The declining
  // schedule is pinned as two parallel flat arrays (months / balances) rather than an array
  // of objects, so the fixture JSON stays language-neutral for the Python mirror — the
  // model's own shape is Array<{ month, balance_pence }> and is projected here.
  redemption_balance_at_disposal_pence: (r) => r.model.redemption_balance_at_disposal_pence,
  redemption_schedule_months: (r) => r.model.redemption_schedule.map((e) => e.month),
  redemption_schedule_balances_pence: (r) => r.model.redemption_schedule.map((e) => e.balance_pence),
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

  // Negative control (fixture H's precedent, Release 3a — a pinned key that no assertion
  // actually reaches is a copy-paste false pass, not coverage). The three redemption keys
  // added in Release 3b reach the run through FLAT_KEYS rather than through
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
});
