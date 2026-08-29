#!/usr/bin/env node
// R16b spec §26.6. Fails the build if the entry chunk's STATIC import closure
// exceeds the ceiling, or if any file in that closure carries one of the
// three vendor markers. Dynamic imports are outside the closure by design.
// The byte sum covers every file in the closure (`.js` AND `.css` -- a
// vendor library can ship CSS of its own, e.g. `leaflet.css`, and a sum that
// only counted script bytes would silently undercount the closure); the
// marker scan stays `.js`-only, since the three banners are JS identifiers
// that would never appear in a stylesheet.
//
//   node scripts/assert-bundle.mjs [--dist <dir>] [--ceiling <bytes>]
//
// Pre-split measurement, 29 August 2026: 1,646 kB entry (491 kB gzip).
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 512,000 bytes derives from the ORIGINAL (.js-only) measurement: 448.7 kB
// on 29 August 2026, rounded up to the next 50 kB (450 kB) plus 50 kB
// headroom. Review round 2 (minor 6) added the closure's `.css` files
// (e.g. a vendor stylesheet) to the byte sum, which the original figure
// did not include; re-measured the same day at 460.6 kB / 471,629 bytes
// (.js + .css) -- still under this ceiling, so the ceiling itself is
// unchanged (raised only if a re-measurement exceeds it).
export const CEILING_BYTES = 512000;
export const MARKERS = ['jsPDF', 'SheetJS', 'leaflet-container'];

export function checkBundle(distDir, ceiling = CEILING_BYTES, markers = MARKERS) {
  const manifest = JSON.parse(readFileSync(resolve(distDir, '.vite/manifest.json'), 'utf-8'));
  const entries = Object.keys(manifest).filter((k) => manifest[k].isEntry);
  if (entries.length !== 1) throw new Error(`expected exactly one entry chunk, found ${entries.length}: ${entries.join(', ')}`);
  const closure = new Set();
  const stack = [entries[0]];
  while (stack.length > 0) {
    const key = stack.pop();
    if (closure.has(key)) continue;
    closure.add(key);
    for (const dep of manifest[key].imports ?? []) stack.push(dep);
  }
  let bytes = 0;
  const offenders = [];
  const files = [];
  for (const key of closure) {
    const file = manifest[key].file;
    if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
    const abs = resolve(distDir, file);
    bytes += statSync(abs).size;
    files.push(file);
    if (!file.endsWith('.js')) continue; // the marker scan stays JS-only
    const src = readFileSync(abs, 'utf-8');
    for (const marker of markers) if (src.includes(marker)) offenders.push(`${file}: ${marker}`);
  }
  // A chunk's manifest entry can also list its own CSS under `css: [...]`
  // (not `imports`), so a stylesheet reachable only that way would never be
  // visited by the closure walk above, which follows `imports` alone.
  for (const key of closure) {
    for (const cssFile of manifest[key].css ?? []) {
      if (files.includes(cssFile)) continue;
      bytes += statSync(resolve(distDir, cssFile)).size;
      files.push(cssFile);
    }
  }
  return { bytes, files, offenders, ok: bytes <= ceiling && offenders.length === 0 };
}

function main(argv) {
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1]; };
  const distDir = resolve(arg('--dist', resolve(dirname(fileURLToPath(import.meta.url)), '../dist')));
  const ceiling = Number(arg('--ceiling', CEILING_BYTES));
  const result = checkBundle(distDir, ceiling);
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`[assert-bundle] entry static closure: ${kb(result.bytes)} over ${result.files.length} file(s); ceiling ${kb(ceiling)}`);
  if (result.offenders.length > 0) console.error(`[assert-bundle] vendor code reachable statically from the entry:\n  ${result.offenders.join('\n  ')}`);
  if (result.bytes > ceiling) console.error(`[assert-bundle] entry closure exceeds the ceiling by ${kb(result.bytes - ceiling)}`);
  process.exit(result.ok ? 0 : 1);
}

// R16b spec §26 minor 2. On win32, `resolve(process.argv[1])`'s drive letter
// follows the invoking shell's cwd casing (often lowercase), while
// `fileURLToPath(import.meta.url)`'s comes from the OS and is typically
// uppercase -- a strict `===` would then miss the match and this guard
// would silently exit 0 instead of running main(), on Windows only.
const invoked = process.argv[1] ? resolve(process.argv[1]) : null;
const self = fileURLToPath(import.meta.url);
const isMain = invoked !== null
  && (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self);
if (isMain) main(process.argv.slice(2));
