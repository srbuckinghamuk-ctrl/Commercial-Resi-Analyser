#!/usr/bin/env node
// R16b spec §26.6. Fails the build if the entry chunk's STATIC import closure
// exceeds the ceiling, or if any file in that closure carries one of the
// three vendor markers. Dynamic imports are outside the closure by design.
//
//   node scripts/assert-bundle.mjs [--dist <dir>] [--ceiling <bytes>]
//
// Pre-split measurement, 29 August 2026: 1,646 kB entry (491 kB gzip).
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CEILING_BYTES = 512000; // measured 448.7 kB on 29 August 2026; next-50-kB + 50 kB headroom
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
    if (!file.endsWith('.js')) continue;
    const abs = resolve(distDir, file);
    bytes += statSync(abs).size;
    files.push(file);
    const src = readFileSync(abs, 'utf-8');
    for (const marker of markers) if (src.includes(marker)) offenders.push(`${file}: ${marker}`);
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
