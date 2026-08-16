import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_SENSITIVITY_CONFIG, LEVER_ORDER, MAX_AXIS_STEPS, validateSensitivityConfig,
} from './sensitivity';
import { runAppraisal } from './index';
import { runSensitivity } from './sensitivity';
import { applyScenario } from './apply-scenario';
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

  // §12.6: an axis or tornado lever must be one of the four §12.1 levers. Without
  // this, an unknown AXIS lever silently no-ops that axis (both engines "agree" on a
  // wrong answer), and an unknown TORNADO lever crashes the Python mirror inside
  // LEVER_ORDER.index() — see the sibling test in test_financial_model_sensitivity.py.
  it('rejects an axis naming an unknown lever', () => {
    const issues = validateSensitivityConfig(config({
      rows: { lever: 'GDV' as SensitivityConfig['rows']['lever'], steps: [0] },
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.rows.lever');
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('rejects a tornado bar naming an unknown lever', () => {
    const issues = validateSensitivityConfig(config({
      tornado: [{ lever: 'GDV' as SensitivityConfig['tornado'][number]['lever'], low: -10, high: 10 }],
    }));
    expect(issues.map((i) => i.field)).toContain('sensitivity.tornado');
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
    // §12.7: a span is null only when an endpoint is unmeasured, which cannot happen for
    // Fixture F under the default tornado (its 9-month floor is a legal term) — see the
    // §12.7 cell-validity tests below for the null case, pinned on fixtures I and J.
    expect([...spans].sort((a, b) => (b as number) - (a as number))).toEqual(spans);
    // No cast here: `null >= 0` is `true` in JavaScript, so `(s as number) >= 0` would
    // silently accept a null span. Spelling out the null check keeps this assertion at
    // its original strength.
    expect(spans.every((s) => s !== null && s >= 0)).toBe(true);
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
  //
  // What was learned running this against Fixture F: the worst corner (construction_cost
  // +15%, gdv −15%) drives peak_debt_pence to 63,448,870p, which breaches the committed
  // *net* facility (60,000,000p) but not the committed *gross* facility (66,000,000p).
  // `facility_exceeded` (monthly-engine.ts:264) is gated on the gross facility, because
  // capitalised interest/fees are allowed to occupy the net-to-gross headroom without
  // tripping it — capitalisation adds straight to the closing balance and never passes
  // through the net-capped draw. The shortfall against the net facility (the ceiling that
  // actually gates new cash draws) is what shows up, correctly, as `funding_gap`. So for
  // this fixture the deterministic, reproducible flag is `funding_gap`, not
  // `facility_exceeded` — asserting the specific flag (rather than "either flag") keeps
  // this test able to catch a regression that quietly loosens the *gross* facility for
  // stressed cells, which an either-flag assertion could not.
  //
  // Round-2 fix: the peak-debt and profit comparisons below are strict (> / <), not
  // loose (>= / <=). A non-strict comparison is satisfied by equality, and equality is
  // exactly what a no-op regression produces: if every lever silently stopped being
  // applied, the "worst corner" cell would degenerate to being numerically identical to
  // the base case, `>=`/`<=` would pass on that equality, and the conditional
  // funding_gap assertion below would never even run (Fixture F's base peak debt already
  // sits under the committed net facility, so the degenerated worst corner would too).
  // This was found empirically, not theoretically: patching `measure` to discard its
  // `levers` argument and rerunning the suite left every test passing under `>=`.
  // Construction cost +15% strictly increases spend and GDV −15% strictly reduces sale
  // proceeds, so both peak debt and profit are guaranteed to move under a
  // correctly-applied worst corner — `>`/`<` is safe here and fails, as required, under
  // the no-op.
  it('never re-sizes the facility, whatever the cell', () => {
    const inputs = fixtureFInputs();
    const { matrix } = runSensitivity(inputs);
    const base = runAppraisal(inputs).metrics;
    const worst = matrix[4][0]; // cost +15%, GDV −15%
    expect(worst.peak_debt_pence).toBeGreaterThan(base.peak_debt_pence);
    // A more direct proof the levers were actually applied: cost up and GDV down cannot
    // leave profit unchanged, whereas a no-op regression leaves it identical.
    expect(worst.profit_pence).toBeLessThan(base.profit_pence);
    // The committed facility is an input, so the only way a cell can exceed it is a flag.
    // Fixture F is a development-finance deal, so this is always a real number at
    // runtime; the schema types it nullable only for funding sources that lack a
    // committed facility (e.g. cash deals), which Fixture F is not.
    const committed = inputs.finance.committed_net_facility_pence as number;
    // §12.7: worst is a cost/GDV cell, never a timeline position, so it is always
    // measured for Fixture F — the null branch belongs to the §12.7 tests above.
    if (worst.peak_debt_pence !== null && worst.peak_debt_pence > committed) {
      expect(worst.flags).toContain('funding_gap');
    }

    // The constructive form of §12.2, independent of any flag: the levered document
    // itself must carry the same committed facility and the same raised equity as the
    // base document. This fails if and only if a lever actually reached one of these
    // fields — it cannot be satisfied by accident the way a flag-based check could.
    const levered = applyScenario(inputs, {
      label: '',
      gdv_adjustment_pct: worst.col_step,
      construction_cost_adjustment_pct: worst.row_step,
      timeline_adjustment_months: 0,
      interest_rate_adjustment_pct: 0,
    });
    expect(levered.finance.committed_net_facility_pence).toBe(inputs.finance.committed_net_facility_pence);
    expect(levered.finance.committed_gross_facility_pence).toBe(inputs.finance.committed_gross_facility_pence);
    expect(levered.finance.day_one_advance_pence).toBe(inputs.finance.day_one_advance_pence);
    expect(levered.equity_sources).toEqual(inputs.equity_sources);
  });

  it('throws on an invalid config rather than computing a misleading grid', () => {
    expect(() => runSensitivity(fixtureFInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      rows: { lever: 'gdv', steps: [0] },
    })).toThrow(/different levers/);
  });

  // Before the closed-set check existed, an unknown tornado lever reached
  // LEVER_ORDER.indexOf() in the tie-break comparator, which returns -1 rather than
  // throwing — so the TS mirror "succeeded" silently while the Python mirror crashed
  // uncaught inside LEVER_ORDER.index(). Both engines must now reject it the same way.
  it('throws on an unknown tornado lever rather than mis-sorting silently', () => {
    expect(() => runSensitivity(fixtureFInputs(), {
      ...DEFAULT_SENSITIVITY_CONFIG,
      tornado: [{ lever: 'GDV' as SensitivityConfig['tornado'][number]['lever'], low: -10, high: 10 }],
    })).toThrow(/Invalid sensitivity config/);
  });

  // Mirrors app/financial_model/sensitivity.py's _default_config() factory: the
  // default config must never be handed out by reference, or a caller mutating
  // `result.config` would poison every later default-config call for the process.
  // See test_run_sensitivity_default_config_is_not_shared in
  // tests/test_financial_model_sensitivity.py for the Python-side pin.
  it('does not leak a mutation of the default config into later runs', () => {
    const inputs = fixtureFInputs();
    const first = runSensitivity(inputs);
    expect(first.config.cols.steps).toEqual(DEFAULT_SENSITIVITY_CONFIG.cols.steps);

    first.config.cols.steps.push(10);

    const second = runSensitivity(inputs);
    expect(second.config.cols.steps).toEqual([-15, -10, -5, 0, 5]);
    expect(second.matrix[0]).toHaveLength(5);
    // The shared module-level constant itself must also be untouched.
    expect(DEFAULT_SENSITIVITY_CONFIG.cols.steps).toEqual([-15, -10, -5, 0, 5]);
  });
});

// ── Release 5: §12.7 cell validity ──
describe('runSensitivity — §12.7 cell validity', () => {
  // A 12-month base: a −12 timeline step empties the term, which validation
  // rejects at error severity ("Term must be a whole number of months, at
  // least 1."). Before R5 the suite clamped to one month and reported numbers.
  it('does not measure a position whose levered document fails validation', () => {
    const cfg = config();
    cfg.rows = { lever: 'timeline', steps: [-12] };
    cfg.cols = { lever: 'gdv', steps: [0] };
    const cell = runSensitivity(fixtureFInputs(), cfg).matrix[0][0];

    expect(cell.validation_errors.length).toBeGreaterThan(0);
    expect(cell.validation_errors.every((e) => e.severity === 'error')).toBe(true);
    expect(cell.validation_errors.some((e) => e.field === 'finance.term_months')).toBe(true);
    expect(cell.profit_pence).toBeNull();
    expect(cell.peak_debt_pence).toBeNull();
    expect(cell.profit_on_cost_pct).toBeNull();
    expect(cell.profit_on_gdv_pct).toBeNull();
    expect(cell.irr_annual_pct).toBeNull();
    expect(cell.ltgdv_developer_pct).toBeNull();
    expect(cell.flags).toEqual([]);
  });

  // The boundary, from the measured side. −11 leaves exactly one month, which
  // is legal, so it must still be a real measurement.
  it('measures a position that leaves exactly one month of term', () => {
    const cfg = config();
    cfg.rows = { lever: 'timeline', steps: [-11] };
    cfg.cols = { lever: 'gdv', steps: [0] };
    const cell = runSensitivity(fixtureFInputs(), cfg).matrix[0][0];

    expect(cell.validation_errors).toEqual([]);
    expect(cell.profit_pence).not.toBeNull();
  });

  // Warnings must not invalidate: Fixture F carries one on
  // conversion_costs.total_construction_sqm, and every cell of the default
  // grid inherits it.
  it('treats a warning-carrying document as measured', () => {
    const result = runSensitivity(fixtureFInputs());
    for (const cell of result.matrix.flat()) {
      expect(cell.validation_errors).toEqual([]);
      expect(cell.profit_pence).not.toBeNull();
    }
  });

  // §12.2: a stress cell raising a covenant flag is a valid measurement, and
  // the flag is the finding. Keying validity off reconciliation would break this.
  it('measures a flagged cell rather than treating the flag as invalidity', () => {
    const result = runSensitivity(fixtureFInputs());
    const flagged = result.matrix.flat().filter((c) => c.flags.length > 0);
    expect(flagged.length).toBeGreaterThan(0);
    for (const cell of flagged) {
      expect(cell.validation_errors).toEqual([]);
      expect(cell.profit_pence).not.toBeNull();
    }
  });

  it('gives a tornado bar with an unmeasured endpoint a null span', () => {
    const cfg = config();
    cfg.tornado = [
      { lever: 'gdv', low: -10, high: 10 },
      { lever: 'timeline', low: -12, high: 3 },
    ];
    const bars = runSensitivity(fixtureFInputs(), cfg).tornado;
    const timeline = bars.find((b) => b.lever === 'timeline')!;
    expect(timeline.span_pence).toBeNull();
    expect(timeline.low.validation_errors.length).toBeGreaterThan(0);
    expect(timeline.high.validation_errors).toEqual([]);
  });

  // §12.4: spanless bars sort after every bar with a span, in LEVER_ORDER.
  it('orders spanless bars last', () => {
    const cfg = config();
    cfg.tornado = [
      { lever: 'timeline', low: -12, high: 3 },
      { lever: 'interest_rate', low: -1, high: 1 },
      { lever: 'gdv', low: -10, high: 10 },
    ];
    const bars = runSensitivity(fixtureFInputs(), cfg).tornado;
    expect(bars[bars.length - 1].lever).toBe('timeline');
    expect(bars[bars.length - 1].span_pence).toBeNull();
    expect(bars.slice(0, -1).every((b) => b.span_pence !== null)).toBe(true);
  });

  // The single-spanless-bar case above can't distinguish "sorts last" from "sorts last
  // in LEVER_ORDER" — with only one null-span bar, any tie-break would look identical.
  // Two invalidating levers closes that: gdv at -100% drives every unit's
  // estimated_value_pence to zero (validation's "positive value" rule), so its low
  // endpoint is unmeasured exactly like timeline's. Both must sort after every bar with
  // a real span, and gdv (index 0) must sort before timeline (index 2) in LEVER_ORDER —
  // this is the assertion the Python mirror's sort key must match too.
  it('orders two spanless bars relative to each other by LEVER_ORDER', () => {
    const cfg = config();
    cfg.tornado = [
      { lever: 'timeline', low: -12, high: 3 },
      { lever: 'interest_rate', low: -1, high: 1 },
      { lever: 'gdv', low: -100, high: 10 },
      { lever: 'construction_cost', low: -10, high: 10 },
    ];
    const bars = runSensitivity(fixtureFInputs(), cfg).tornado;

    const spanless = bars.filter((b) => b.span_pence === null).map((b) => b.lever);
    expect(spanless).toEqual(['gdv', 'timeline']);
    // Both spanless bars sit at the tail, in that same relative order.
    expect(bars.slice(-2).map((b) => b.lever)).toEqual(['gdv', 'timeline']);
    // Every bar ahead of them has a real span.
    expect(bars.slice(0, -2).every((b) => b.span_pence !== null)).toBe(true);
    // Confirms *why* gdv is unmeasured, not just that it is.
    const gdvBar = bars.find((b) => b.lever === 'gdv')!;
    expect(gdvBar.low.validation_errors.some((e) => e.field.includes('estimated_value_pence'))).toBe(true);
  });

  // §12.5 makes the base an identity with the unadjusted appraisal, so a suite
  // over an invalid base is meaningless in every position at once — this is an
  // input error (§12.6/§12.7), not twenty-five unmeasured cells.
  it('throws when the base document itself fails validation', () => {
    const bad = fixtureFInputs() as AnyCalculatorInputs & { finance: { term_months: number } };
    bad.finance.term_months = 0;
    expect(() => runSensitivity(bad)).toThrow(/base document/i);
  });

  // The realistic instance, and the reason this rule is not merely about exotic inputs.
  // Fixture I is a phased-sales deal whose tranches sit in months 9–11 of a 12-month
  // programme. The DEFAULT tornado's −3 month endpoint leaves a 9-month term, so those
  // tranches point at months that no longer exist and validation rejects the document.
  // Before R5 that endpoint reported a profit computed from exactly that document.
  it('does not measure the default tornado low endpoint of a phased-sales deal', () => {
    const fixtureI = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/financial-model/i-phased-sales.json'), 'utf-8'),
    ).inputs as AnyCalculatorInputs;

    const bars = runSensitivity(fixtureI).tornado;
    const timeline = bars.find((b) => b.lever === 'timeline')!;

    expect(timeline.low.validation_errors.length).toBeGreaterThan(0);
    expect(timeline.low.validation_errors.some((e) => e.field.startsWith('sales_phasing.tranches'))).toBe(true);
    expect(timeline.low.profit_pence).toBeNull();
    expect(timeline.span_pence).toBeNull();
    // §12.4 as extended by §12.7: no span means it sorts last.
    expect(bars[bars.length - 1].lever).toBe('timeline');
    // The high endpoint lengthens the programme, so it stays measured.
    expect(timeline.high.validation_errors).toEqual([]);
  });
});
