import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

/**
 * R12 Task 18b, spec §18.7. THE guard that would have caught R12 shipping
 * inert. R14 Task 14 (spec §20.1, guard 8) moves the version chain it derives
 * from to v11.
 *
 * Every arm R14 built — the funding-side correction, the draw cap, and the
 * monitoring statement and its surfaces — is reachable only from a v11
 * document. If a production entry point keeps calling the v10 migration, no
 * user ever holds a v11 document, none of that code is reachable, and roughly
 * four thousand tests stay green while proving it all works in a world nobody
 * inhabits. That is not a hypothetical: R10 shipped exactly this split in the
 * other direction (server on v7, client on v6) and made every saved appraisal
 * unloadable, and R9, R11, R12 and R13 each recorded a version of it.
 *
 * R13b Task 15 (spec §22.9) moves the version chain it derives from again, to
 * v12: the unit-sales ledger's every arm is reachable only from a v12
 * document, so the same failure mode — a production entry point left calling
 * v11 while the rest of the boundary moves on — applies here exactly as it
 * did to v10/v11.
 *
 * **If this test failed and you are looking for what to do**: a production file
 * calls `migrateInputsToV{N}` for an N that is not the newest migration this
 * module offers. Either move that call site to the newest one, or — if you are
 * deliberately adding a new version — move ALL of them, in ONE commit, together
 * with the Python half (`tests/test_entry_point_guard.py`) and the server
 * (`app/api/app.py`). The persistence boundary is one thing with several
 * halves; each `migrateInputsToV{N}` refuses a v{N+1} document by design (spec
 * §3.5), so a boundary split across two versions is not a degraded state, it is
 * a broken one.
 *
 * The rule is written as "every production call site names the NEWEST
 * migration", derived from the migration module itself, rather than as "nobody
 * names v8". A hand-written "not v8" rule goes vacuous the moment v10 exists —
 * it would pass a release that left every entry point on v9 — and a guard that
 * silently stops guarding is the failure mode this file exists to prevent.
 */

const FRONTEND_SRC = resolve(__dirname, '../..');

/** The migration module defines the versions; it is exempt from its own rule,
 *  as is the barrel that re-exports them for the tests and gates that call the
 *  older entry points deliberately (the migration identity gates use the v8
 *  entry point as the "before" side of a before/after comparison).
 *
 *  R13 Task 5b (moved to v11 by R14 Task 14): `lib/model/__fixtures__/
 *  investment-case-docs.ts` is also exempt -- not because it calls an old
 *  version (it calls the migration matching the fixture version it loads --
 *  v11, for its investment-case/monitoring fixtures -- correctly), but
 *  because it is not a PRODUCTION entry point at all. This guard's own
 *  stated purpose is "if a production entry point keeps calling the old
 *  migration, no user ever holds a [new] document" -- a `__fixtures__` file
 *  is imported only by `.test.ts` files (mirroring Jest/Vitest's own
 *  `__mocks__`/`__snapshots__` convention for test-only code) and reaches no
 *  user at all. Without this exemption the file would still pass the "calls
 *  only the newest version" test below (it does) but would fail the
 *  file-enumeration test's exact pinned list, for a reason that has nothing
 *  to do with a stale call site -- exactly the kind of false positive this
 *  guard must not produce, or a real offender risks being lost in the noise.
 *
 *  R13 Task 18 (moved to v11 by R14 Task 14): `lib/report-qa/memo-fixtures.ts`
 *  is exempt for the identical reason. Task 16 gave it a migration call (it
 *  too calls the migration matching the fixture version it loads -- v11, for
 *  its monitoring fixtures), so it is not a stale-call-site offender either
 *  way -- the question is only whether it belongs in the file-enumeration
 *  list at all. Its own header comment already states "Test-support only;
 *  not imported by the application", and grepping every import of it in this
 *  tree confirms that: every consumer is a `.test.ts`/`.test.tsx` file
 *  (`memo-release-gate.test.ts`, `quick-report-gate.test.ts`,
 *  `report-provenance.test.ts`, `AcquisitionPage.test.tsx`). It fails the
 *  `__fixtures__` naming convention only because it predates that
 *  convention, not because it reaches a user -- it does not. Exempting it
 *  keeps the pinned enumeration list naming only files a real user's browser
 *  can load.
 *
 *  R13b Task 15: `lib/model/__fixtures__/unit-sales-docs.ts` is exempt for
 *  the same reason again -- it calls the migration matching the fixture
 *  version it loads, `migrateInputsToV12`, to build fixture X (the
 *  unit-sales-ledger document) as test support, and is imported only by
 *  `.test.ts` files, so it reaches no user either.
 *
 *  R15 Task 3: `lib/model/__fixtures__/due-diligence-docs.ts` is exempt for
 *  the same reason once more -- it calls the migration matching the fixture
 *  version it loads, `migrateInputsToV13`, to build fixture Y (the
 *  due-diligence document) as test support, and is imported only by
 *  `.test.ts` files. */
const EXEMPT = new Set([
  'lib/model/migrate.ts',
  'lib/model/index.ts',
  'lib/model/__fixtures__/investment-case-docs.ts',
  'lib/model/__fixtures__/unit-sales-docs.ts',
  'lib/model/__fixtures__/due-diligence-docs.ts',
  'lib/report-qa/memo-fixtures.ts',
]);

const MIGRATE_SOURCE = readFileSync(resolve(FRONTEND_SRC, 'lib/model/migrate.ts'), 'utf-8');

/** Every `migrateInputsToV{N}` the module actually exports, newest last. */
function exportedEntryPointVersions(): number[] {
  const found = [...MIGRATE_SOURCE.matchAll(/export function migrateInputsToV(\d+)\s*\(/g)]
    .map((m) => Number(m[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

const VERSIONS = exportedEntryPointVersions();
const NEWEST = VERSIONS[VERSIONS.length - 1];

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const rel = relative(FRONTEND_SRC, full).replace(/\\/g, '/');
      if (EXEMPT.has(rel)) continue;
      out.push(rel);
    }
  };
  walk(FRONTEND_SRC);
  return out.sort();
}

/**
 * The versions a file actually USES, as opposed to mentions. A call
 * (`migrateInputsToV8(`) or an import of the name is a use; this repo's
 * comments narrate the boundary's history by name across several releases and
 * that prose is worth keeping, so it is not counted.
 */
function usedVersions(source: string): number[] {
  const uses: number[] = [];
  for (const m of source.matchAll(/\bmigrateInputsToV(\d+)\s*\(/g)) uses.push(Number(m[1]));
  for (const line of source.split('\n')) {
    if (!/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line) && !/^\s*migrateInputsToV/.test(line)) continue;
    for (const m of line.matchAll(/\bmigrateInputsToV(\d+)\b/g)) uses.push(Number(m[1]));
  }
  return [...new Set(uses)];
}

describe('inputs-version entry points (spec §18.7)', () => {
  it('the migration module exports the version chain this guard is derived from', () => {
    // Non-vacuity, part 1. If the regex above stopped matching, VERSIONS would
    // be empty and every assertion below would pass over nothing.
    expect(VERSIONS.length).toBeGreaterThan(1);
    expect(NEWEST).toBe(12);
    expect(VERSIONS).toContain(11);
  });

  it('enumerates the production files that actually hold the entry points', () => {
    // Non-vacuity, part 2. A guard that enumerated an empty file list, or lost
    // the three files the boundary lives in, would pass while guarding nothing.
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(20);
    const withUses = files.filter((f) => usedVersions(readFileSync(resolve(FRONTEND_SRC, f), 'utf-8')).length > 0);
    expect(withUses).toEqual([
      'components/ConversionCalculator.tsx',
      'components/ExportPage.tsx',
    ]);
  });

  it('no production file calls anything but the newest migration entry point', () => {
    const offenders: string[] = [];
    for (const rel of productionFiles()) {
      const source = readFileSync(resolve(FRONTEND_SRC, rel), 'utf-8');
      for (const version of usedVersions(source)) {
        if (version !== NEWEST) offenders.push(`${rel}: migrateInputsToV${version}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('detects a stale call site when one is present (the guard proves itself)', () => {
    // Without this, a `usedVersions` that quietly stopped matching anything
    // would make the assertion above pass on every file in the tree.
    expect(usedVersions("import { migrateInputsToV8 } from '../lib/model';")).toEqual([8]);
    expect(usedVersions('const x = migrateInputsToV8(raw, project);')).toEqual([8]);
    expect(usedVersions('// R11 Task 10 moved this to migrateInputsToV8, one version back')).toEqual([]);
  });
});
