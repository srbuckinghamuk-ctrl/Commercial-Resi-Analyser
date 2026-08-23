import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CALC_VERSION } from './finance-types';

/**
 * R13. Spec §1.6 lists every inputs version the model supports. It has been
 * missed TWICE RUNNING — R11 shipped without v8 in the list and R12 caught it —
 * and no test has ever read it. This is that test.
 *
 * The rule is written as "the newest version this build defines appears in the
 * list", derived from the migration module itself rather than hard-coded, so
 * it does not go vacuous the moment v11 exists. TypeScript's own type union
 * (`AnyCalculatorInputs`) is erased at compile time and unavailable to a
 * runtime test; `migrate.ts`'s exported `migrateInputsToV{N}` functions are
 * the same fact in a form a test can read, and `entry-point-guard.test.ts`
 * already establishes this exact pattern for the same module.
 */
const MIGRATE_SOURCE = readFileSync(
  resolve(__dirname, 'migrate.ts'), 'utf-8',
);

function newestInputsVersion(): number {
  const found = [...MIGRATE_SOURCE.matchAll(/export function migrateInputsToV(\d+)\s*\(/g)]
    .map((m) => Number(m[1]));
  return Math.max(...found);
}

const SPEC = readFileSync(
  resolve(__dirname, '../../../../docs/financial-model/calculation-specification.md'), 'utf-8',
);

describe('spec §1.6 versioning', () => {
  it('lists the newest inputs version', () => {
    const section = SPEC.split('### 1.6 Versioning')[1].split('\n## ')[0];
    expect(section).toMatch(new RegExp(`\\bv${newestInputsVersion()}\\b`));
  });

  it('names the current calc version', () => {
    expect(SPEC).toContain(CALC_VERSION);
  });
});
