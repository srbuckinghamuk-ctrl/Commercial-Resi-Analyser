import type { CalculatorInputsV3, CalculatorInputsV4 } from './finance-types';

/** Sq ft per sq m (spec §3.2 `global_per_sqft` basis). No shared constant existed
 * for this anywhere the financial model could import from without creating a new
 * cross-package dependency (`export-investment-memo.ts` has its own private,
 * unexported `sqmToSqft` helper using the same literal) — defined once here per
 * language, per Task 3 brief §"Semantics". */
export const SQFT_PER_SQM = 10.7639;

export interface LenderGdvResult {
  lender_gdv_pence: number;
  /** Per-unit lender values, same order as `inputs.unit_mix.units`. Empty for
   * `fixed_amount` (a single total, not a per-unit breakdown). */
  unit_values_pence: number[];
}

/**
 * Lender-underwritten GDV (spec §3.2). Returns `null` only when
 * `inputs.lender_valuation` is absent — that is the sole meaning of "unknown"
 * here, never a stand-in for "the block is present but bad" (spec §2: unknown
 * lender-critical inputs must never be defaulted silently).
 *
 * Throws when a present block cannot be computed at all — a required
 * `global_value` is null, or a `per_unit` id is missing, or a resulting unit
 * value is not positive. There is no numeric fallback for these that would
 * not silently misstate the lender's position, so this fails closed rather
 * than guessing. Both callers catch this: `validation.ts` reports the same
 * condition as a hard `ValidationIssue` (by catching this function's own
 * thrown message, so the wording never drifts), and `metrics.ts` catches it
 * too so an invalid block degrades to null lender metrics instead of crashing
 * `runAppraisal` outright (metrics runs before validation in the pipeline, so
 * validation hasn't had a chance to report anything yet at that point).
 */
export function computeLenderGdv(inputs: CalculatorInputsV3 | CalculatorInputsV4): LenderGdvResult | null {
  const lv = inputs.lender_valuation;
  if (lv == null) return null;

  if (lv.basis === 'fixed_amount') {
    if (lv.global_value == null) {
      throw new Error(`Lender valuation basis "fixed_amount" requires a global_value.`);
    }
    if (lv.global_value <= 0) {
      throw new Error('Lender GDV must be a positive value.');
    }
    return { lender_gdv_pence: lv.global_value, unit_values_pence: [] };
  }

  if ((lv.basis === 'global_pct' || lv.basis === 'global_per_sqft') && lv.global_value == null) {
    throw new Error(`Lender valuation basis "${lv.basis}" requires a global_value.`);
  }

  const unitValues: number[] = inputs.unit_mix.units.map((u) => {
    let value: number;
    switch (lv.basis) {
      case 'global_pct':
        value = Math.round(u.estimated_value_pence * (1 + (lv.global_value as number) / 100));
        break;
      case 'global_per_sqft':
        value = Math.round((lv.global_value as number) * u.floor_area_sqm * SQFT_PER_SQM);
        break;
      case 'unit_type': {
        const adjustment = lv.per_key_values?.[u.type];
        value = adjustment == null
          ? u.estimated_value_pence
          : Math.round(u.estimated_value_pence * (1 + adjustment / 100));
        break;
      }
      case 'per_unit': {
        const provided = lv.per_key_values?.[u.id];
        if (provided == null) {
          throw new Error(`Lender valuation (per_unit basis) is missing a value for unit "${u.id}".`);
        }
        value = provided;
        break;
      }
      default:
        throw new Error(`Unknown lender valuation basis "${lv.basis}".`);
    }
    if (value <= 0) {
      throw new Error(`Lender-adjusted value for unit "${u.id}" must be positive.`);
    }
    return value;
  });

  const total = unitValues.reduce((sum, v) => sum + v, 0);
  return { lender_gdv_pence: total, unit_values_pence: unitValues };
}
