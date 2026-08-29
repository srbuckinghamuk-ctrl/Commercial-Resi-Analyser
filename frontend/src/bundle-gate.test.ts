import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = resolve(__dirname, '../scripts/assert-bundle.mjs');

/** A synthetic dist: `entry` statically imports `shared`; `lazy` is reachable
 *  only through dynamicImports. `entryCssBody` (minor 6), when given, is the
 *  entry's own stylesheet, wired the way Vite's manifest actually carries it
 *  -- a `css` array on the entry's manifest node, not `imports`. */
function makeDist(opts: { sharedBody: string; lazyBody: string; entryCssBody?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-gate-'));
  mkdirSync(join(dir, '.vite'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/entry.js'), 'console.log("entry")');
  writeFileSync(join(dir, 'assets/shared.js'), opts.sharedBody);
  writeFileSync(join(dir, 'assets/lazy.js'), opts.lazyBody);
  const entryNode: Record<string, unknown> = { file: 'assets/entry.js', isEntry: true, imports: ['_shared'], dynamicImports: ['_lazy'] };
  if (opts.entryCssBody !== undefined) {
    writeFileSync(join(dir, 'assets/entry.css'), opts.entryCssBody);
    entryNode.css = ['assets/entry.css'];
  }
  writeFileSync(join(dir, '.vite/manifest.json'), JSON.stringify({
    'src/main.tsx': entryNode,
    _shared: { file: 'assets/shared.js' },
    _lazy: { file: 'assets/lazy.js' },
  }));
  return dir;
}

function run(dir: string, ceiling: number): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, '--dist', dir, '--ceiling', String(ceiling)], { encoding: 'utf-8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

describe('assert-bundle.mjs (spec §26.6)', () => {
  it('passes a clean closure under the ceiling, with a vendor marker only in a dynamic chunk', () => {
    const dir = makeDist({ sharedBody: 'export const a = 1;', lazyBody: 'export const j = "jsPDF";' });
    expect(run(dir, 10_000).code).toBe(0);
  });
  it('fails when the static closure exceeds the ceiling', () => {
    const dir = makeDist({ sharedBody: 'x'.repeat(5_000), lazyBody: '' });
    const r = run(dir, 4_000);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/exceeds the ceiling/);
  });
  it('fails when a vendor marker is reachable statically', () => {
    const dir = makeDist({ sharedBody: 'const cls = "leaflet-container";', lazyBody: '' });
    const r = run(dir, 10_000);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/leaflet-container/);
  });

  // Review round 2 (minor 6): the byte sum used to count `.js` files only, so
  // a vendor stylesheet reachable from the entry's own `css` manifest array
  // (e.g. leaflet.css) was invisible to the ceiling check entirely.
  it('counts the entry stylesheet toward the ceiling', () => {
    const dir = makeDist({ sharedBody: 'export const a = 1;', lazyBody: '', entryCssBody: 'x'.repeat(5_000) });
    // JS alone (entry.js + shared.js) is a few dozen bytes; only the CSS
    // pushes the closure over a 4,000-byte ceiling.
    const r = run(dir, 4_000);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/exceeds the ceiling/);
  });

  it('does not scan the stylesheet for vendor markers', () => {
    // The banners are JS identifiers; a CSS class NAMED `leaflet-container`
    // is the class React-Leaflet's own bundle sets on its container element,
    // not a violation -- the marker scan stays JS-only by design.
    const dir = makeDist({ sharedBody: 'export const a = 1;', lazyBody: '', entryCssBody: '.leaflet-container { position: relative; }' });
    const r = run(dir, 10_000);
    expect(r.code).toBe(0);
  });
});
