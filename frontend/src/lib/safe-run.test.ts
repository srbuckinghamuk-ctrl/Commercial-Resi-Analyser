import { describe, it, expect } from 'vitest';
import { safeRunAppraisal } from './safe-run';
import { migrateInputsToV4 } from './model';
import type { AnyCalculatorInputs } from './model';

describe('safeRunAppraisal', () => {
  it('returns the appraisal run for inputs the engine can compute', () => {
    const result = safeRunAppraisal(migrateInputsToV4({}));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The real engine ran — not a stub — so the result carries real metrics.
      expect(result.run.metrics.calc_version).toBe('2.7.0');
      expect(result.run.model.months).toHaveLength(result.run.schedule.term_months);
    }
  });

  it('captures the error instead of throwing when the engine cannot compute', () => {
    // A structurally broken document: the engine dereferences `finance` while
    // building the schedule, so this throws inside runAppraisal. runAppraisal is
    // called during ConversionCalculator's own render, where an uncaught throw
    // unmounts the whole calculator and every unsaved edit with it.
    const broken = { ...migrateInputsToV4({}), finance: null } as unknown as AnyCalculatorInputs;

    expect(() => safeRunAppraisal(broken)).not.toThrow();
    const result = safeRunAppraisal(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('wraps a non-Error throw so callers always get an Error', () => {
    const thrower = {
      get finance(): never {
        throw 'a string, not an Error';
      },
    } as unknown as AnyCalculatorInputs;

    const result = safeRunAppraisal(thrower);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toContain('a string, not an Error');
    }
  });
});
