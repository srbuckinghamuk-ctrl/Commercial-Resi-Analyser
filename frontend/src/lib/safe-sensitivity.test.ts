import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { safeRunSensitivity } from './safe-sensitivity';
import { migrateInputsToV4 } from './model';
import { defaultSensitivityConfig } from './model/sensitivity';

const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
const fixtureF = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'f-dev-finance-12mo.json'), 'utf-8'),
) as { inputs: Record<string, unknown> };

function baseInputs() {
  return migrateInputsToV4(fixtureF.inputs);
}

describe('safeRunSensitivity', () => {
  it('returns the suite for a computable document', () => {
    const outcome = safeRunSensitivity(baseInputs());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.matrix).toHaveLength(5);
      expect(outcome.result.tornado).toHaveLength(4);
    }
  });

  // An invalid config makes runSensitivity throw (spec §12.6). The page needs
  // that as a value so it can render the reason instead of unmounting.
  it('returns the error instead of throwing on an invalid config', () => {
    const config = defaultSensitivityConfig();
    config.cols.lever = config.rows.lever;
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toMatch(/different levers/i);
  });

  it('returns the error on an empty step list', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'gdv', steps: [] };
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toMatch(/at least one step/i);
    }
  });

  // ── Documented engine behaviour, verified 16 Aug 2026 against fixture F ──
  //
  // A timeline step that drives finance.term_months to zero or below does NOT
  // throw and does NOT raise a validation issue: the appraisal engine clamps to
  // a one-month term and returns a plausible-looking result. Steps of -11, -12
  // and -13 on this 12-month deal all yield profit 26,556,933p with a
  // funding_gap flag — three distinct assumptions, one answer.
  //
  // This is pinned as the *current* behaviour, not as desirable behaviour. It is
  // why SensitivityPage carries its own term guard (Task 6) and why a §12.6 rule
  // bounding the resulting term is on the R5 list.
  it('does not fail on a term-emptying timeline step — the engine clamps instead', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'timeline', steps: [-11, -12, -13] };
    config.cols = { lever: 'gdv', steps: [0] };
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const [atOne, atZero, atMinusOne] = outcome.result.matrix.map((row) => row[0].profit_pence);
      expect(atZero).toBe(atOne);
      expect(atMinusOne).toBe(atOne);
      // All three steps that empty the term clamp to one-month and raise funding_gap.
      // This pins the *mechanism* of the duplicate values: they come from clamping,
      // not from coincidence or a shared-reference bug.
      expect(outcome.result.matrix[0][0].flags).toContain('funding_gap');
      expect(outcome.result.matrix[1][0].flags).toContain('funding_gap');
      expect(outcome.result.matrix[2][0].flags).toContain('funding_gap');
    }
  });
});
