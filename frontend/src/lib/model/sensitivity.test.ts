import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SENSITIVITY_CONFIG, LEVER_ORDER, MAX_AXIS_STEPS, validateSensitivityConfig,
} from './sensitivity';
import type { SensitivityConfig } from './sensitivity';

/** A deep copy of the defaults, so a test that mutates one field cannot leak into another. */
function config(overrides: Partial<SensitivityConfig> = {}): SensitivityConfig {
  return {
    rows: { ...DEFAULT_SENSITIVITY_CONFIG.rows, steps: [...DEFAULT_SENSITIVITY_CONFIG.rows.steps] },
    cols: { ...DEFAULT_SENSITIVITY_CONFIG.cols, steps: [...DEFAULT_SENSITIVITY_CONFIG.cols.steps] },
    tornado: DEFAULT_SENSITIVITY_CONFIG.tornado.map((r) => ({ ...r })),
    ...overrides,
  };
}

describe('sensitivity defaults (spec §12.3, §12.4)', () => {
  it('pins the normative default grid', () => {
    expect(DEFAULT_SENSITIVITY_CONFIG.rows).toEqual({
      lever: 'construction_cost', steps: [-5, 0, 5, 10, 15],
    });
    expect(DEFAULT_SENSITIVITY_CONFIG.cols).toEqual({
      lever: 'gdv', steps: [-15, -10, -5, 0, 5],
    });
  });

  it('pins the normative default tornado ranges', () => {
    expect(DEFAULT_SENSITIVITY_CONFIG.tornado).toEqual([
      { lever: 'gdv', low: -10, high: 10 },
      { lever: 'construction_cost', low: -10, high: 10 },
      { lever: 'timeline', low: -3, high: 3 },
      { lever: 'interest_rate', low: -1, high: 1 },
    ]);
  });

  it('pins the tie-break lever order', () => {
    expect(LEVER_ORDER).toEqual(['gdv', 'construction_cost', 'timeline', 'interest_rate']);
  });

  it('accepts the defaults without complaint', () => {
    expect(validateSensitivityConfig(DEFAULT_SENSITIVITY_CONFIG)).toEqual([]);
  });
});

describe('validateSensitivityConfig (spec §12.6)', () => {
  it('rejects an empty axis', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'construction_cost', steps: [] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.rows.steps');
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('rejects a non-finite step', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'construction_cost', steps: [0, NaN] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.rows.steps');
  });

  it(`rejects more than ${MAX_AXIS_STEPS} steps on an axis`, () => {
    const steps = Array.from({ length: MAX_AXIS_STEPS + 1 }, (_, k) => k);
    const issues = validateSensitivityConfig(config({ cols: { lever: 'gdv', steps } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.cols.steps');
  });

  it('rejects both axes naming the same lever', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'gdv', steps: [0] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.cols.lever');
  });

  it('rejects a lever appearing twice in the tornado', () => {
    const issues = validateSensitivityConfig(config({
      tornado: [{ lever: 'gdv', low: -10, high: 10 }, { lever: 'gdv', low: -5, high: 5 }],
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.tornado');
  });

  it('rejects a tornado range whose low is not below its high', () => {
    const issues = validateSensitivityConfig(config({
      tornado: [{ lever: 'gdv', low: 10, high: 10 }],
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.tornado');
  });

  // The engine is month-indexed (§1.3): a fractional term has no meaning in the ledger.
  // This rule is also what keeps the Python mirror's int() narrowing of
  // `timeline_adjustment_months` from ever seeing a value it would truncate.
  it('rejects a fractional timeline step', () => {
    const issues = validateSensitivityConfig(config({ rows: { lever: 'timeline', steps: [0, 3.5] } }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.rows.steps');
  });

  it('rejects a fractional timeline tornado bound', () => {
    const issues = validateSensitivityConfig(config({
      tornado: [{ lever: 'timeline', low: -3, high: 3.5 }],
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.tornado');
  });

  it('accepts a whole-month timeline axis', () => {
    expect(validateSensitivityConfig(config({ rows: { lever: 'timeline', steps: [-3, 0, 3] } }))).toEqual([]);
  });
});
