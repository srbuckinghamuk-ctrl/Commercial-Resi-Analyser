/**
 * R15b spec §24.3. The shared cost-plan-in-time document builders. `docS()`
 * loads fixture S (fixtures/financial-model/s-dated-programme.json) via
 * `migrateInputsToV17` (R17 Task 3 moved this on from `migrateInputsToV16`,
 * spec §27.7, which itself moved it on from `migrateInputsToV15`, spec §26.1,
 * which itself moved it on from `migrateInputsToV14`, spec §25.7, which
 * itself moved it on from `migrateInputsToV13`, spec §24.8) — never a
 * hand-authored default object. `docZ()` (R15b Task 7) loads
 * fixture Z (fixtures/financial-model/z-cost-plan-in-time.json) the same way
 * — "S plus Z's changes, and no other" (design §13) is now a stored golden
 * fixture, not a runtime mutation of `docS()`'s output; the fixture's
 * `inputs` was produced by running the pre-Task-7 mutating builder once
 * (test-cases.md §24.1). `migrateInputsToV17` on an already-v14 document
 * (this fixture's own stored version) merges onto v17 defaults, writing the
 * four Sec 25.1 lever fields at their identity zero, rebuilding
 * `conversion_costs` to its five kept fields (Sec 26.1) and writing
 * `elemental_benchmark` null, every package's `benchmark_origin` null and
 * the due-diligence record arrays empty (Sec 27.7) — the same
 * discipline every other loader in this file uses. Twin of
 * `tests/fixtures_cost_plan_in_time.py`, using this language's own naming
 * convention for the same functions (camelCase here, snake_case there).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV17 } from '../migrate';
import type { CalculatorInputsV17 } from '../finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

const loadFixture = (stem: string): CalculatorInputsV17 =>
  migrateInputsToV17(JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')).inputs);

export function docS(): CalculatorInputsV17 {
  return loadFixture('s-dated-programme');
}

/** Design §13: S plus Z's changes, and no other (test-cases.md §24.1). */
export function docZ(): CalculatorInputsV17 {
  return loadFixture('z-cost-plan-in-time');
}

/** Z with the QS provenance kept but the allowance cleared: months_from_base
 *  and the latest-midpoint fields are still published, every inflation_pence
 *  is 0 and every inflation_factor is null. */
export function docZNoAllowance(): CalculatorInputsV17 {
  const d = docZ();
  d.cost_plan.qs = { ...d.cost_plan.qs!, inflation: null };
  return d;
}
