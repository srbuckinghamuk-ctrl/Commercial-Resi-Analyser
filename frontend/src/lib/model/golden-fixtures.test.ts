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
  expected_metrics: Partial<AppraisalResultV2>;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);

describe('golden fixtures (shared with the Python engine)', () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      const run = runAppraisal(fx.inputs);
      for (const [key, expected] of Object.entries(fx.expected_metrics)) {
        expect(run.metrics[key as keyof AppraisalResultV2], key).toEqual(expected);
      }
    });
  }
});
