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

  // ── Superseded by spec §12.7 (R5) ──
  //
  // Before R5, a timeline step that drove finance.term_months to zero or below did
  // not throw and did not raise a validation issue: the appraisal engine clamped to
  // a one-month term and returned a plausible-looking result — steps of -11, -12 and
  // -13 on this 12-month deal all yielded the identical profit 26,556,933p with a
  // funding_gap flag, three distinct assumptions collapsed to one answer. That was
  // pinned as *current*, not desirable, behaviour, and is exactly what §12.7 fixes:
  // the levered document is now validated before it is appraised, so a step that
  // empties or inverts the term is unmeasured rather than silently clamped.
  it('does not throw on a term-emptying timeline step — the position is unmeasured instead (§12.7)', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'timeline', steps: [-11, -12, -13] };
    config.cols = { lever: 'gdv', steps: [0] };
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const [atOne, atZero, atMinusOne] = outcome.result.matrix.map((row) => row[0]);
      // -11 leaves exactly one legal month of term: a real measurement.
      expect(atOne.validation_errors).toEqual([]);
      expect(atOne.profit_pence).not.toBeNull();
      // -12 empties the term and -13 inverts it: both fail validation and are
      // unmeasured, not two more clamped guesses identical to the one above.
      expect(atZero.validation_errors.length).toBeGreaterThan(0);
      expect(atZero.profit_pence).toBeNull();
      expect(atMinusOne.validation_errors.length).toBeGreaterThan(0);
      expect(atMinusOne.profit_pence).toBeNull();
    }
  });
});
