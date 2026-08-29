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

  it('pairs the newest inputs version with the current calc version on §1.6\'s status line', () => {
    const section = SPEC.split('### 1.6 Versioning')[1].split('\n## ')[0];
    const escaped = CALC_VERSION.replace(/\./g, '\\.');
    expect(section).toMatch(new RegExp(`\\(\\*\\*inputs v${newestInputsVersion()}\\*\\*\\) = calc ${escaped}\\+`));
  });

  // R16 finding 4 (this task's addendum). "The status line" is the document's
  // own opening `**Status:** Authoritative. Calculation version \`X\`.` sentence
  // near the top of the file, distinct from the §1.6 versioning-list pairing
  // above -- a whole-file substring check (the old assertion) would pass even
  // if THIS line went stale beside a fresh changelog entry.
  it('names the current calc version on the document\'s own status line', () => {
    const escaped = CALC_VERSION.replace(/\./g, '\\.');
    expect(SPEC).toMatch(new RegExp(`\\*\\*Status:\\*\\* Authoritative\\. Calculation version \`${escaped}\`\\.`));
  });
});
