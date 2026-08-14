import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
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
  // Two flat keys (cost_to_complete_first_shortfall_month, cost_to_complete_max_shortfall_pence)
  // are not real AppraisalResultV2 keys — they're a fixture-authoring convenience mapped onto
  // the nested `cost_to_complete` summary below (spec §5.10, Release 2b Task 6).
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

// Minimal flat-key -> nested-summary mapping for the two cost-to-complete fixture keys
// (spec §5.10, Release 2b Task 6). Every other expected_metrics key is a real, direct
// AppraisalResultV2 property, asserted below without this indirection.
const COST_TO_COMPLETE_FLAT_KEYS: Record<string, (s: AppraisalResultV2['cost_to_complete']) => unknown> = {
  cost_to_complete_first_shortfall_month: (s) => s?.first_shortfall_month ?? null,
  cost_to_complete_max_shortfall_pence: (s) => s?.max_shortfall_pence ?? null,
};

describe('golden fixtures (shared with the Python engine)', () => {
  it('every expected fixture file is present in the shared corpus', () => {
    expect(fixtureFiles).toEqual(EXPECTED_FIXTURE_STEMS.map((s) => `${s}.json`));
  });

  for (const fx of fixtures) {
    it(fx.name, () => {
      const run = runAppraisal(fx.inputs);
      for (const [key, expected] of Object.entries(fx.expected_metrics)) {
        const mapper = COST_TO_COMPLETE_FLAT_KEYS[key];
        const actual = mapper ? mapper(run.metrics.cost_to_complete) : run.metrics[key as keyof AppraisalResultV2];
        expect(actual, key).toEqual(expected);
      }
    });
  }
});
