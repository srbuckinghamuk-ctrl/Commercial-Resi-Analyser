import { describe, it, expect } from 'vitest';
import { icDoc, explicitRefinanceDoc, anchoredSlippedDoc } from './investment-case-docs';
import { validateInputs } from '../validation';
import {
  grossPotentialMonthlyPence, stabilisedAnnualNoiPence, investmentValuePence, sizeTakeout,
} from '../investment-case';
import { derivePhases } from '../programme';
import type { RefinanceInputsV9, PhaseAnchor } from '../finance-types';

describe('the shared v10 builders', () => {
  it('produces a document with NO validation errors by default', () => {
    expect(validateInputs(icDoc()).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateInputs(explicitRefinanceDoc()).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateInputs(anchoredSlippedDoc()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  // `Schedule.investment_case` does not exist until Task 8 (finance-types.ts's
  // own comment: "InvestmentCaseResult is deliberately ABSENT ... Task 8 adds
  // both the import and the Schedule.investment_case field"). The brief's
  // Step 1 text asserts `buildSchedule(icDoc()).investment_case!.takeout
  // .binding_constraint` directly — that does not compile today, a genuine
  // sequencing defect in the brief (Task 5b runs before Task 8 in the task
  // order, but its own test text assumes Task 8's output already exists),
  // reported in task-5b-report.md rather than silently worked around.
  //
  // The two tests below assert the SAME claim through what actually exists
  // today: the investment-case engine functions applied directly to the
  // document's `investment_case` input block. `stabilisedAnnualNoiPence` and
  // `sizeTakeout` do not depend on the schedule or the ledger (§19's
  // one-direction rule) — they take gross rent, occupancy and the take-out
  // terms straight from the input, exactly what `computeInvestmentCase`
  // (Task 8) will also feed them. Once Task 8 lands, this file's assertions
  // should be restored to the brief's literal `buildSchedule(...)
  // .investment_case` form — see task-5b-report.md.
  function bindingConstraint(doc: ReturnType<typeof icDoc>): string | null {
    const ic = doc.investment_case!;
    const gross = grossPotentialMonthlyPence(doc.exit_strategy.retained_units);
    const noi = stabilisedAnnualNoiPence({
      termMonths: doc.finance.term_months,
      stabilisationMonth: 0,
      rampMonths: ic.stabilisation.ramp_months,
      stabilisedOccupancyPct: ic.stabilisation.stabilised_occupancy_pct,
      grossPotentialMonthlyPence: gross,
      lines: ic.operating_lines,
    });
    const value = investmentValuePence(noi, ic.valuation.cap_yield_pct, ic.valuation.purchasers_costs_pct);
    return sizeTakeout(noi, value, ic.takeout).binding_constraint;
  }

  it('makes the DEFAULT case one where DSCR binds', () => {
    // Every task from 8 onward assumes this. Asserted once, here, rather than
    // re-assumed silently in six files. Hand-derivation:
    // fixtures/financial-model/t-investment-case.json's own note.
    expect(bindingConstraint(icDoc())).toBe('dscr');
  });

  it('makes the ltvBinds override actually change which constraint binds', () => {
    // The override that would be easiest to get wrong, and whose wrongness
    // would make Task 11's negative flag assertion pass for the wrong reason.
    // Hand-derivation: fixtures/financial-model/u-investment-case-ltv-binds
    // .json's own note (the exact pair `ltvBinds: true` writes).
    expect(bindingConstraint(icDoc({ ltvBinds: true }))).toBe('ltv');
  });

  it('resolves the anchored tranche to month 14, NOT its month_offset of 12', () => {
    // Task 12's whole premise. If this were 12, that task could not fail
    // against `main` and the carried defect would go unproven.
    //
    // `Schedule.resolved_exit_months` is ALSO a Task 8 addition (same
    // finance-types.ts comment, same reasoning as above), so this resolves
    // the anchor the same way schedule.ts's own (private) resolveAnchorMonth
    // does — start_month + offset_months — rather than reading a field that
    // does not exist yet.
    const doc = anchoredSlippedDoc();
    expect(doc.sales_phasing!.tranches[0].month_offset).toBe(12);
    const derivation = derivePhases(doc.programme!);
    if ('cycle' in derivation) throw new Error('anchoredSlippedDoc: unexpected cycle');
    const anchor = (doc.sales_phasing!.tranches[0] as unknown as { anchor: PhaseAnchor }).anchor;
    const resolved = derivation.byId[anchor.phase_id].start_month + anchor.offset_months;
    expect(resolved).toBe(14);
    // And the second tranche / refinance both resolve to 18.
    const anchor2 = (doc.sales_phasing!.tranches[1] as unknown as { anchor: PhaseAnchor }).anchor;
    expect(derivation.byId[anchor2.phase_id].start_month + anchor2.offset_months).toBe(18);
    const refiAnchor = (doc.refinance as unknown as RefinanceInputsV9).anchor!;
    expect(derivation.byId[refiAnchor.phase_id].start_month + refiAnchor.offset_months).toBe(18);
  });

  it('applies exactly ONE deviation per override key', () => {
    const base = icDoc();
    const one = icDoc({ occupancyPct: 80 });
    expect({ ...one, investment_case: null }).toEqual({ ...base, investment_case: null });
    expect(one.investment_case!.stabilisation.stabilised_occupancy_pct).toBe(80);
    expect(one.investment_case!.valuation).toEqual(base.investment_case!.valuation);
  });
});
