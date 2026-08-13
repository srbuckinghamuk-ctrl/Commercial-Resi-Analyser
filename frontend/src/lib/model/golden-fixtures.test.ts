import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import type { AppraisalResultV2, CalculatorInputsV2 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

interface Fixture {
  name: string;
  kind: 'pipeline';
  inputs: CalculatorInputsV2;
  // Two flat keys (cost_to_complete_first_shortfall_month, cost_to_complete_max_shortfall_pence)
  // are not real AppraisalResultV2 keys — they're a fixture-authoring convenience mapped onto
  // the nested `cost_to_complete` summary below (spec §5.10, Release 2b Task 6).
  expected_metrics: Partial<AppraisalResultV2> & Record<string, unknown>;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);

// Minimal flat-key -> nested-summary mapping for the two cost-to-complete fixture keys
// (spec §5.10, Release 2b Task 6). Every other expected_metrics key is a real, direct
// AppraisalResultV2 property, asserted below without this indirection.
const COST_TO_COMPLETE_FLAT_KEYS: Record<string, (s: AppraisalResultV2['cost_to_complete']) => unknown> = {
  cost_to_complete_first_shortfall_month: (s) => s?.first_shortfall_month ?? null,
  cost_to_complete_max_shortfall_pence: (s) => s?.max_shortfall_pence ?? null,
};

describe('golden fixtures (shared with the Python engine)', () => {
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
