/**
 * R15b spec §24.3. The shared cost-plan-in-time document builders. `docS()`
 * loads fixture S (fixtures/financial-model/s-dated-programme.json) via
 * `migrateInputsToV14` (R15b Task 6 moved this on from `migrateInputsToV13`,
 * spec §24.8) — never a hand-authored default object. `docZ()` (R15b Task 7)
 * loads fixture Z (fixtures/financial-model/z-cost-plan-in-time.json) the
 * same way — "S plus Z's changes, and no other" (design §13) is now a stored
 * golden fixture, not a runtime mutation of `docS()`'s output; the fixture's
 * `inputs` was produced by running the pre-Task-7 mutating builder once
 * (test-cases.md §24.1). `migrateInputsToV14` on an already-v14 document is a
 * no-op merge (`isV14` is true, so the merge-onto-defaults branch runs and
 * reproduces the same document) — the same discipline every other loader in
 * this file uses. Twin of `tests/fixtures_cost_plan_in_time.py`, using this
 * language's own naming convention for the same functions (camelCase here,
 * snake_case there).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV14 } from '../migrate';
import type { CalculatorInputsV14 } from '../finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

const loadFixture = (stem: string): CalculatorInputsV14 =>
  migrateInputsToV14(JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')).inputs);

export function docS(): CalculatorInputsV14 {
  return loadFixture('s-dated-programme');
}

/** Design §13: S plus Z's changes, and no other (test-cases.md §24.1). */
export function docZ(): CalculatorInputsV14 {
  return loadFixture('z-cost-plan-in-time');
}

/** Z with the QS provenance kept but the allowance cleared: months_from_base
 *  and the latest-midpoint fields are still published, every inflation_pence
 *  is 0 and every inflation_factor is null. */
export function docZNoAllowance(): CalculatorInputsV14 {
  const d = docZ();
  d.cost_plan.qs = { ...d.cost_plan.qs!, inflation: null };
  return d;
}
