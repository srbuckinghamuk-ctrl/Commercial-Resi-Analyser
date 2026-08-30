import { describe, it, expect } from 'vitest';
import {
  AREA_UNITS,
  SQFT_PER_SQM,
  areaUnitLabel,
  displayArea,
  entryAreaToSqm,
  entryRateToPencePerSqm,
  formatAreaBoth,
  formatAreaValue,
  formatAreaWithUnit,
  formatRatePence,
  ratePerSqftToPerSqm,
  ratePerSqmToPerSqft,
  rateUnitLabel,
  sqftToSqm,
  sqmToSqft,
} from './area-units';

/**
 * Spec §27.2's worked figures. No `toBe` on a float anywhere here: every
 * numeric assertion is `toBeCloseTo` at a stated precision, or an exact
 * comparison of a value that is an integer by construction.
 */
describe('area units (spec §27.2)', () => {
  it('carries the exact constant', () => {
    expect(SQFT_PER_SQM).toBeCloseTo(10.7639104167097, 13);
    expect(AREA_UNITS).toEqual(['metric', 'imperial']);
  });

  it('620 m² is 6,673.62445836 ft² (8 dp)', () => {
    // 620 × 10.7639104167097 = 6,673.6244583600…; spec §27.2's "6,673.62445835…"
    // is that figure truncated, not rounded, so the 8-dp pin is …836.
    expect(sqmToSqft(620)).toBeCloseTo(6673.62445836, 8);
  });

  it('1 ft² is 0.09290304 m² (8 dp)', () => {
    expect(sqftToSqm(1)).toBeCloseTo(0.09290304, 8);
  });

  it('125,000 p/m² is 11,612.88 p/ft² (6 dp)', () => {
    // 125,000 / 10.7639104167097 = 11,612.880000000023. (Spec §27.2's prose
    // prints "11,612.8125…", which is not this quotient; the constant is the
    // authority and this pin is computed from it.)
    expect(ratePerSqmToPerSqft(125_000)).toBeCloseTo(11612.88, 6);
  });

  it('the area × rate product is the same in either unit before the one rounding', () => {
    const metric = 620 * 125_000;
    const imperial = sqmToSqft(620) * ratePerSqmToPerSqft(125_000);
    expect(Math.abs(imperial - metric)).toBeLessThan(1e-6);
    expect(Math.round(imperial)).toBe(77_500_000);
    expect(Math.round(imperial)).toBe(Math.round(metric));
  });

  it('a rate round-trips in both directions to within 1e-9 relative', () => {
    for (const rate of [125_000, 1, 0.37, 98_765_432.1]) {
      const viaSqft = ratePerSqftToPerSqm(ratePerSqmToPerSqft(rate));
      expect(Math.abs(viaSqft - rate) / rate).toBeLessThan(1e-9);
      const viaSqm = ratePerSqmToPerSqft(ratePerSqftToPerSqm(rate));
      expect(Math.abs(viaSqm - rate) / rate).toBeLessThan(1e-9);
    }
    for (const area of [620, 100, 0.5]) {
      expect(Math.abs(sqftToSqm(sqmToSqft(area)) - area) / area).toBeLessThan(1e-9);
    }
  });

  it('1,000 alternating display conversions never touch the canonical value', () => {
    // The canonical is a const: nothing in the loop can assign to it, and the
    // converter only ever reads it. What the test pins is that each render
    // computes from the canonical afresh — the display values are consistent
    // across the run and the canonical is bit-identical at the end.
    const canonical = 620;
    const firstMetric = displayArea(canonical, 'metric');
    const firstImperial = displayArea(canonical, 'imperial');
    for (let i = 0; i < 1000; i++) {
      const unit = i % 2 === 0 ? 'imperial' : 'metric';
      const shown = displayArea(canonical, unit);
      expect(shown).toBeCloseTo(unit === 'imperial' ? firstImperial : firstMetric, 12);
    }
    expect(Object.is(canonical, 620)).toBe(true);
    expect(firstMetric).toBe(620); // metric display is the canonical itself, untouched
    expect(firstImperial).toBeCloseTo(6673.62445836, 8);
  });

  it('labels', () => {
    expect(areaUnitLabel('metric')).toBe('m²');
    expect(areaUnitLabel('imperial')).toBe('ft²');
    expect(rateUnitLabel('metric')).toBe('£/m²');
    expect(rateUnitLabel('imperial')).toBe('£/ft²');
  });

  it('formats the area in the display unit with grouping and fixed decimals', () => {
    expect(formatAreaValue(620, 'metric')).toBe('620.0');
    expect(formatAreaValue(620, 'imperial')).toBe('6,673.6');
    expect(formatAreaValue(620, 'imperial', 2)).toBe('6,673.62');
    expect(formatAreaValue(620, 'metric', 0)).toBe('620');
    expect(formatAreaWithUnit(620, 'metric')).toBe('620.0 m²');
    expect(formatAreaWithUnit(620, 'imperial')).toBe('6,673.6 ft²');
    expect(formatAreaBoth(620, 'metric')).toBe('620.0 m² (6,673.6 ft²)');
    expect(formatAreaBoth(620, 'imperial')).toBe('6,673.6 ft² (620.0 m²)');
  });

  it('formats a canonical pence/m² rate in pounds per display unit', () => {
    expect(formatRatePence(125_000, 'metric')).toBe('£1,250/m²');
    expect(formatRatePence(125_000, 'imperial')).toBe('£116.13/ft²');
    // Metric keeps the pence only when there are pence to keep.
    expect(formatRatePence(125_050, 'metric')).toBe('£1,250.50/m²');
    // Imperial is always 2 dp, even when the quotient happens to be whole.
    expect(formatRatePence(0, 'imperial')).toBe('£0.00/ft²');
  });

  it('entry: an imperial area is stored to 4 dp of m², a metric one untouched', () => {
    // 1076.39 / 10.7639104167097 = 99.9999032256… → 99.9999 at the stated
    // entry precision (not 100.0000: 100 m² is 1,076.39104… ft²). Computed
    // with Python before being pinned here; the Python twin pins the same.
    expect(entryAreaToSqm(1076.39, 'imperial')).toBeCloseTo(99.9999, 10);
    expect(entryAreaToSqm(1076.391, 'imperial')).toBeCloseTo(100.0, 10);
    expect(entryAreaToSqm(SQFT_PER_SQM, 'imperial')).toBeCloseTo(1.0, 10);
    // Four decimals, no more: the stored figure × 1e4 is an integer.
    expect(Number.isInteger(Math.round(entryAreaToSqm(1076.39, 'imperial') * 1e4))).toBe(true);
    expect(Math.round(entryAreaToSqm(1076.39, 'imperial') * 1e4)).toBe(999_999);
    expect(entryAreaToSqm(620.123456, 'metric')).toBe(620.123456);
  });

  it('entry: an imperial rate is stored unrounded, a metric one untouched', () => {
    expect(entryRateToPencePerSqm(125_000, 'metric')).toBe(125_000);
    expect(entryRateToPencePerSqm(11612.88, 'imperial')).toBeCloseTo(125_000, 6);
    // Unrounded: the converted figure is a float, not snapped to whole pence.
    expect(entryRateToPencePerSqm(1, 'imperial')).toBeCloseTo(10.7639104167097, 12);
  });
});
