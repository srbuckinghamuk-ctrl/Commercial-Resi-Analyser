import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { safeRunSensitivity, safeRunStressPack, SCENARIO_FIELD } from './safe-sensitivity';
import { migrateInputsToV5 } from './model';
import * as sensitivityModule from './model/sensitivity';
import {
  defaultSensitivityConfig, InvalidBaseDocumentError, InvalidSensitivityConfigError,
  LEVER_ORDER, overridesFor,
} from './model/sensitivity';
import { ddDoc } from './model/__fixtures__/due-diligence-docs';

const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
const fixtureF = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'f-dev-finance-12mo.json'), 'utf-8'),
) as { inputs: Record<string, unknown> };

function baseInputs() {
  return migrateInputsToV5(fixtureF.inputs);
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

  // R6: the wrapper exists to turn the suite's *documented* failures into values so the
  // page can keep its editor and state the reason. A defect is not one of those, and
  // routing it into a panel that says "the suite could not be calculated" asserts a
  // cause the panel has not established — CalculatorErrorBoundary is where a genuine
  // fault belongs.
  it('rethrows a failure that is neither of the suite\'s documented ones', () => {
    const boom = new TypeError('cannot read properties of undefined (reading "flags")');
    const spy = vi.spyOn(sensitivityModule, 'runSensitivity').mockImplementation(() => {
      throw boom;
    });
    try {
      expect(() => safeRunSensitivity(baseInputs())).toThrow(boom);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns the invalid-base-document failure as a value (§12.7)', () => {
    const inputs = baseInputs();
    inputs.finance.equity_draw_rule = 'pari_passu';
    const result = safeRunSensitivity(inputs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidBaseDocumentError);
  });

  it('returns the invalid-config failure as a value (§12.6)', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'gdv', steps: [] };
    const result = safeRunSensitivity(baseInputs(), config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(InvalidSensitivityConfigError);
  });
});

// R16 Task 7 (spec §25). `safeRunStressPack` wraps `runStressPack` the same way
// `safeRunSensitivity` wraps `runSensitivity` -- only §12.7's `InvalidBaseDocumentError`
// is a documented failure of the stress pack (there is no config to be invalid).
describe('safeRunStressPack', () => {
  it('returns the nine-stress pack for a computable document', () => {
    const outcome = safeRunStressPack(ddDoc());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.stresses).toHaveLength(9);
  });

  it('returns the invalid-base-document failure as a value (§12.7)', () => {
    const doc = ddDoc();
    doc.finance.term_months = 0;
    const outcome = safeRunStressPack(doc);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBeInstanceOf(InvalidBaseDocumentError);
  });
});

// Fix wave M8. `SCENARIO_FIELD` and `overridesFor` (model/sensitivity.ts) are
// two hand-written thirteen-row maps of the SAME relation -- lever to
// `ScenarioOverrides` field -- kept in two files, and until this test nothing
// compared them. Both are `Record`s over the lever union, so a SWAP between two
// rows (say `abnormal_cost` <-> `saleable_area`, whose fields are adjacent in
// both literals and differ by one word) typechecks perfectly and is caught by
// no existing assertion: `SCENARIO_FIELD` feeds the Scenarios page's inputs and
// the memo's per-lever comparison columns, so a swap there silently labels one
// lever's magnitude with another lever's name while the engine goes on applying
// the right field. Comparing the two maps directly is what makes that a test
// failure rather than a misprinted report.
//
// `phase_slip` is excluded because `SCENARIO_FIELD` excludes it by type: it
// carries a target (`phase_slip_phase_id`) alongside its magnitude, so a single
// `keyof ScenarioOverrides` cannot name its field. `overridesFor` writes both of
// its fields and is exercised by the §18.9 order-independence guards instead.
describe('SCENARIO_FIELD names the field overridesFor actually writes', () => {
  // Every numeric field of `ScenarioOverrides`; `label` is a string and
  // `phase_slip_phase_id` is a nullable id, so neither is part of this check.
  const NUMERIC_FIELDS = [
    'gdv_adjustment_pct', 'construction_cost_adjustment_pct', 'timeline_adjustment_months',
    'interest_rate_adjustment_pct', 'phase_slip_months', 'exit_yield_adjustment_pct',
    'operating_cost_adjustment_pct', 'vacancy_adjustment_pct', 'sales_slip_months',
    'saleable_area_adjustment_pct', 'abnormal_cost_adjustment_pct', 'programme_slip_months',
    'refi_ltv_adjustment_pct',
  ] as const;

  for (const lever of LEVER_ORDER) {
    if (lever === 'phase_slip') continue;
    it(`writes 1 to ${lever}'s field and 0 to every other`, () => {
      const overrides = overridesFor({ lever, phaseId: null, value: 1 }) as unknown as
        Record<string, number>;
      const owned = SCENARIO_FIELD[lever];
      expect(overrides[owned], `${lever} -> ${owned}`).toBe(1);
      for (const field of NUMERIC_FIELDS) {
        if (field === owned) continue;
        expect(overrides[field], `${lever} leaked into ${field}`).toBe(0);
      }
    });
  }

  // The map must stay total over the levers it claims: a fourteenth lever added
  // to LEVER_ORDER without a row here is a compile error by `SCENARIO_FIELD`'s
  // own `Record<Exclude<SensitivityLever, 'phase_slip'>, ...>` type, and this
  // asserts the count the loop above actually ran.
  it('covers every lever but phase_slip, with no two levers sharing a field', () => {
    const fields = LEVER_ORDER.filter((l) => l !== 'phase_slip').map((l) => SCENARIO_FIELD[l]);
    expect(fields).toHaveLength(LEVER_ORDER.length - 1);
    expect(new Set(fields).size).toBe(fields.length);
  });
});
