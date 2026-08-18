/** Percentage to 2 dp; null when the denominator is zero (spec §1.5).
 *
 * Extracted from metrics.ts in R9 so `areas.ts` can use it without an import
 * cycle (metrics.ts imports areas.ts for the area-bridge output block).
 * metrics.ts re-exports it, so every existing importer is unaffected. */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}
