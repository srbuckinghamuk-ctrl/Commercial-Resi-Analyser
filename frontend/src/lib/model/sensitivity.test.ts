import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_SENSITIVITY_CONFIG, LEVER_ORDER, MAX_AXIS_STEPS, validateSensitivityConfig,
} from './sensitivity';
import { runAppraisal } from './index';
import { runSensitivity } from './sensitivity';
import type { SensitivityConfig } from './sensitivity';
import type { AnyCalculatorInputs } from './finance-types';

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

const FIXTURE_F = resolve(__dirname, '../../../../fixtures/financial-model/f-dev-finance-12mo.json');

function fixtureFInputs(): AnyCalculatorInputs {
  return JSON.parse(readFileSync(FIXTURE_F, 'utf-8')).inputs as AnyCalculatorInputs;
}

describe('runSensitivity (spec §12.3, §12.4, §12.5)', () => {
  it('produces a matrix shaped by the config axes', () => {
    const result = runSensitivity(fixtureFInputs());
    expect(result.matrix).toHaveLength(5);
    expect(result.matrix.every((row) => row.length === 5)).toBe(true);
    expect(result.matrix[0][0].row_step).toBe(-5);
    expect(result.matrix[0][0].col_step).toBe(-15);
    expect(result.matrix[4][4].row_step).toBe(15);
    expect(result.matrix[4][4].col_step).toBe(5);
  });

  it('echoes the resolved config back', () => {
    expect(runSensitivity(fixtureFInputs()).config).toEqual(DEFAULT_SENSITIVITY_CONFIG);
  });

  // Spec §12.5: the all-levers-zero measurement is the unadjusted appraisal.
  it('reports a base case identical to the unadjusted appraisal', () => {
    const inputs = fixtureFInputs();
    const plain = runAppraisal(inputs).metrics;
    const { base } = runSensitivity(inputs);
    expect(base.profit_pence).toBe(plain.profit_pence);
    expect(base.profit_on_cost_pct).toBe(plain.profit_on_cost_pct);
    expect(base.profit_on_gdv_pct).toBe(plain.profit_on_gdv_pct);
    expect(base.irr_annual_pct).toBe(plain.irr_annual_pct);
    expect(base.ltgdv_developer_pct).toBe(plain.ltgdv_developer_pct);
    expect(base.peak_debt_pence).toBe(plain.peak_debt_pence);
    expect(base.flags).toEqual(plain.flags.map((f) => f.code));
  });

  it('places the base case at the zero/zero grid position too', () => {
    const { base, matrix, config } = runSensitivity(fixtureFInputs());
    const ri = config.rows.steps.indexOf(0);
    const ci = config.cols.steps.indexOf(0);
    expect(matrix[ri][ci].profit_pence).toBe(base.profit_pence);
  });

  it('gives one tornado bar per configured range, sorted by span descending', () => {
    const { tornado } = runSensitivity(fixtureFInputs());
    expect(tornado).toHaveLength(4);
    const spans = tornado.map((b) => b.span_pence);
    expect([...spans].sort((a, b) => b - a)).toEqual(spans);
    expect(spans.every((s) => s >= 0)).toBe(true);
  });

  it('orders bars independently of the order the ranges were configured in', () => {
    // §12.4's ordering must be a property of the spans and the lever tie-break, never
    // of the caller's array order — otherwise the two engines could disagree simply
    // because one built its config differently.
    const inputs = fixtureFInputs();
    const forward = runSensitivity(inputs, {
      ...DEFAULT_SENSITIVITY_CONFIG,
      tornado: [
        { lever: 'gdv', low: -10, high: 10 },
        { lever: 'construction_cost', low: -10, high: 10 },
      ],
    });
    const reversed = runSensitivity(inputs, {
      ...DEFAULT_SENSITIVITY_CONFIG,
      tornado: [
        { lever: 'construction_cost', low: -10, high: 10 },
        { lever: 'gdv', low: -10, high: 10 },
      ],
    });
    expect(forward.tornado.map((b) => b.lever)).toEqual(reversed.tornado.map((b) => b.lever));
  });

  // Spec §12.2 made constructive: the committed facility is identical in every cell,
  // so a stressed cell reports facility_exceeded rather than quietly borrowing more.
  it('never re-sizes the facility, whatever the cell', () => {
    const inputs = fixtureFInputs();
    const { matrix } = runSensitivity(inputs);
    const basePeak = runAppraisal(inputs).metrics.peak_debt_pence;
    const worst = matrix[4][0]; // cost +15%, GDV −15%
    expect(worst.peak_debt_pence).toBeGreaterThanOrEqual(basePeak);
    // The committed facility is an input, so the only way a cell can exceed it is a flag.
    // Fixture F is a development-finance deal, so this is always a real number at
    // runtime; the schema types it nullable only for funding sources that lack a
    // committed facility (e.g. cash deals), which Fixture F is not.
    const committed = inputs.finance.committed_net_facility_pence as number;
    if (worst.peak_debt_pence > committed) {
      // Spec §12.2, verbatim: a stressed cell raises "facility_exceeded and/or
      // funding_gap, and that flag is the finding" — either flag satisfies the
      // invariant. Capitalised interest/fees can occupy net-to-gross facility
      // headroom (peak debt above the committed *net* facility) without breaching
      // the committed *gross* facility, in which case the finding surfaces as
      // funding_gap alone; that is spec-compliant, not a missing flag.
      expect(
        worst.flags.includes('facility_exceeded') || worst.flags.includes('funding_gap'),
      ).toBe(true);
    }
  });

  it('throws on an invalid config rather than computing a misleading grid', () => {
    expect(() => runSensitivity(fixtureFInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'gdv', steps: [0] },
    })).toThrow(/different levers/);
  });
});
