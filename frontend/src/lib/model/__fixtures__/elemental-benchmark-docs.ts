/**
 * R17 spec §27. The shared elemental-benchmark document builders. `docAB()`
 * loads fixture AB (fixtures/financial-model/ab-elemental-benchmark.json)
 * via `migrateInputsToV17` — never a hand-authored default object — exactly
 * as `cost-plan-in-time-docs.ts` loads Z. Fixture AB is Z plus a `user_qs`
 * benchmark set of seven fictional rates (TEST FIXTURE — NOT MARKET DATA),
 * seven selections, one prior application and the QS base date aligned to
 * the currentisation date (the apply seam, §27.3). `docABWithoutBenchmark()`
 * is the advisory-proof twin: the same document with `elemental_benchmark`
 * nulled, whose metrics must equal AB's on every ledger figure. Twin of
 * `tests/fixtures_elemental_benchmark.py`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV17 } from '../migrate';
import type { CalculatorInputsV17 } from '../finance-types';
import type { ElementalBenchmarkSet, SchemeElementalBenchmark } from '../elemental-benchmark';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

export function rawAB(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'ab-elemental-benchmark.json'), 'utf-8')).inputs;
}

export function docAB(): CalculatorInputsV17 {
  return migrateInputsToV17(rawAB());
}

/** The advisory proof's twin: the benchmark block removed, the applied
 *  kitchens package left in place (its `benchmark_origin` is then orphaned,
 *  which spec §27.5 rule 13 reports as a validation error — the METRICS are
 *  what this twin exists to compare, and they must not move). */
export function docABWithoutBenchmark(): CalculatorInputsV17 {
  return { ...docAB(), elemental_benchmark: null };
}

export function abSet(): ElementalBenchmarkSet {
  return docAB().elemental_benchmark!.set;
}

export function abBlock(): SchemeElementalBenchmark {
  return docAB().elemental_benchmark!;
}

/** AB with one change to the benchmark block, keeping every other field. */
export function docABWith(mutate: (block: SchemeElementalBenchmark) => void): CalculatorInputsV17 {
  const doc = docAB();
  const block = JSON.parse(JSON.stringify(doc.elemental_benchmark)) as SchemeElementalBenchmark;
  mutate(block);
  return { ...doc, elemental_benchmark: block };
}
