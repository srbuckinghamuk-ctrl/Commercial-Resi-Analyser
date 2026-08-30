/**
 * Area units — the exact m² ⇄ ft² conversion and the display helpers around
 * it (R17, spec §27.2). Exact twin of `app/financial_model/area_units.py`;
 * `tests/test_area_units.py` pins the constant literal equal across the two
 * by reading this file's source text.
 *
 * The canonical basis is metric and never changes: a document stores m² and
 * pence per m² only. Imperial is a *display* unit — every conversion in this
 * module is applied to the canonical figure at render time and its result is
 * never written back, so N toggles produce the same stored value as zero
 * toggles. The only entry-time conversions are `entryAreaToSqm` (a typed ft²
 * area, stored to 4 dp of m² — the stated entry precision) and
 * `entryRateToPencePerSqm` (a typed £/ft² rate, stored unrounded). Money is
 * rounded once, at the amount boundary, and never here.
 *
 * NOT the lender-valuation constant. `model/lender-valuation.ts` carries its
 * own `SQFT_PER_SQM = 10.7639`: that is the `global_per_sqft` basis' *stored
 * calculation convention* — a calculation input that moves `lender_gdv_pence`
 * on fixture G if touched — and it is deliberately left as it is (spec §27.9
 * limitation 6). Do not "fix" either one to match the other.
 */

/** Square feet per square metre, exact to the digits given (spec §27.2). */
export const SQFT_PER_SQM = 10.7639104167097;

export type AreaUnit = 'metric' | 'imperial';

export const AREA_UNITS: readonly AreaUnit[] = ['metric', 'imperial'];

// --- the four conversions: float, unrounded --------------------------------

export function sqmToSqft(sqm: number): number {
  return sqm * SQFT_PER_SQM;
}

export function sqftToSqm(sqft: number): number {
  return sqft / SQFT_PER_SQM;
}

/** A rate per m² (any numerator: pence, pounds) to the same numerator per ft². */
export function ratePerSqmToPerSqft(ratePerSqm: number): number {
  return ratePerSqm / SQFT_PER_SQM;
}

/** A rate per ft² (any numerator) to the same numerator per m². */
export function ratePerSqftToPerSqm(ratePerSqft: number): number {
  return ratePerSqft * SQFT_PER_SQM;
}

// --- labels -----------------------------------------------------------------

export function areaUnitLabel(unit: AreaUnit): 'm²' | 'ft²' {
  return unit === 'imperial' ? 'ft²' : 'm²';
}

export function rateUnitLabel(unit: AreaUnit): '£/m²' | '£/ft²' {
  return unit === 'imperial' ? '£/ft²' : '£/m²';
}

function otherUnit(unit: AreaUnit): AreaUnit {
  return unit === 'imperial' ? 'metric' : 'imperial';
}

// --- display (render-time; the canonical m² figure is the argument) --------

/** The canonical m² figure in the display unit, unrounded. */
export function displayArea(sqm: number, unit: AreaUnit): number {
  return unit === 'imperial' ? sqmToSqft(sqm) : sqm;
}

/** `'620.0'` / `'6,673.6'` — en-GB grouping, fixed `dp` decimals. */
export function formatAreaValue(sqm: number, unit: AreaUnit, dp = 1): string {
  return displayArea(sqm, unit).toLocaleString('en-GB', {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}

/** `'620.0 m²'` / `'6,673.6 ft²'`. */
export function formatAreaWithUnit(sqm: number, unit: AreaUnit, dp = 1): string {
  return `${formatAreaValue(sqm, unit, dp)} ${areaUnitLabel(unit)}`;
}

/** Primary unit with the other in brackets: `'620.0 m² (6,673.6 ft²)'`
 *  (spec §27.2: "displays print the primary unit and the other unit in
 *  secondary text"). */
export function formatAreaBoth(sqm: number, unit: AreaUnit, dp = 1): string {
  return `${formatAreaWithUnit(sqm, unit, dp)} (${formatAreaWithUnit(sqm, otherUnit(unit), dp)})`;
}

/**
 * A canonical pence-per-m² rate printed in pounds per display unit:
 * `'£1,250/m²'` (metric, whole pounds printed without decimals; otherwise 2 dp)
 * or `'£116.13/ft²'` (imperial, always 2 dp — a converted rate is never whole).
 * The ft² rate is only ever printed, never stored.
 */
export function formatRatePence(pencePerSqm: number, unit: AreaUnit): string {
  const pounds = (unit === 'imperial' ? ratePerSqmToPerSqft(pencePerSqm) : pencePerSqm) / 100;
  const dp = unit === 'metric' && Number.isInteger(pounds) ? 0 : 2;
  const money = pounds.toLocaleString('en-GB', {
    style: 'currency', currency: 'GBP', minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
  return `${money}/${areaUnitLabel(unit)}`;
}

// --- entry (the only conversions whose result is stored) -------------------

/**
 * A typed area in the entry unit to canonical m². Metric passes through
 * untouched; imperial converts with `sqftToSqm` and rounds to 4 dp of m² —
 * the entry precision the UI states (spec §27.2). `Math.round` on `x × 1e4`
 * is half-up toward +∞, the same rule as the Python twin's `money_round`.
 */
export function entryAreaToSqm(value: number, unit: AreaUnit): number {
  if (unit === 'metric') return value;
  return Math.round(sqftToSqm(value) * 1e4) / 1e4;
}

/** A typed rate in pence per entry unit to canonical pence per m², unrounded
 *  for imperial (spec §27.2: rounding happens only at the amount boundary). */
export function entryRateToPencePerSqm(pence: number, unit: AreaUnit): number {
  return unit === 'metric' ? pence : ratePerSqftToPerSqm(pence);
}
