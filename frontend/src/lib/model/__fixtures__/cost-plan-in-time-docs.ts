/**
 * R15b spec §24.3. The shared cost-plan-in-time document builders. `docS()`
 * loads fixture S (fixtures/financial-model/s-dated-programme.json) via
 * `migrateInputsToV16` (R16b Task 2 moved this on from `migrateInputsToV15`,
 * which itself moved it on from `migrateInputsToV14`, spec §25.7, which
 * itself moved it on from `migrateInputsToV13`, spec §24.8) — never a
 * hand-authored default object. `docZ()` (R15b Task 7) loads
 * fixture Z (fixtures/financial-model/z-cost-plan-in-time.json) the same way
 * — "S plus Z's changes, and no other" (design §13) is now a stored golden
 * fixture, not a runtime mutation of `docS()`'s output; the fixture's
 * `inputs` was produced by running the pre-Task-7 mutating builder once
 * (test-cases.md §24.1). `migrateInputsToV16` on an already-v14 document
 * (this fixture's own stored version) merges onto v16 defaults, writing the
 * four Sec 25.1 lever fields at their identity zero and rebuilding
 * `conversion_costs` to its five kept fields (Sec 26.1) — the same
 * discipline every other loader in this file uses. Twin of
 * `tests/fixtures_cost_plan_in_time.py`, using this language's own naming
 * convention for the same functions (camelCase here, snake_case there).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV16 } from '../migrate';
import type { CalculatorInputsV16 } from '../finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

const loadFixture = (stem: string): CalculatorInputsV16 =>
  migrateInputsToV16(JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')).inputs);

export function docS(): CalculatorInputsV16 {
  return loadFixture('s-dated-programme');
}

/** Design §13: S plus Z's changes, and no other (test-cases.md §24.1). */
export function docZ(): CalculatorInputsV16 {
  return loadFixture('z-cost-plan-in-time');
}

/** Z with the QS provenance kept but the allowance cleared: months_from_base
 *  and the latest-midpoint fields are still published, every inflation_pence
 *  is 0 and every inflation_factor is null. */
export function docZNoAllowance(): CalculatorInputsV16 {
  const d = docZ();
  d.cost_plan.qs = { ...d.cost_plan.qs!, inflation: null };
  return d;
}
