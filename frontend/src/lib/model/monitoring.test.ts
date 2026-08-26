import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { computeMonitoringStatement, originalBudgets } from './monitoring';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { computeCostPlan } from './cost-plan';
import { developedAreaSqm } from './areas';
import { migrateInputsToV11 } from './migrate';
import { runAppraisal } from './index';
import { docZ } from './__fixtures__/cost-plan-in-time-docs';
import { MONITORING_CATEGORIES } from './finance-types';
import type {
  AnyCalculatorInputs, CalculatorInputsV11, MonitoringCategory, MonitoringInputs,
  MonitoringLineInputs, MonthlyModel, Schedule,
} from './finance-types';
import type { CostPlanResult } from './cost-plan';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

/** The corpus document, normalised to v11 (which stamps `monitoring: null`). */
function loadV11(stem: string): CalculatorInputsV11 {
  const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, `${stem}.json`), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  return migrateInputsToV11(fx.inputs);
}

/** Exactly what `schedule.ts` does to reach the cost plan, so the split identity below
 *  is asserted against the same cost plan the schedule's `uses` were built from. */
function runDoc(inputs: AnyCalculatorInputs): {
  schedule: Schedule; model: MonthlyModel; costPlan: CostPlanResult;
} {
  const schedule = buildSchedule(inputs);
  const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
  const costPlan = computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length);
  return { schedule, model, costPlan };
}

function mkLine(
  category: MonitoringCategory,
  current: number, certified: number, paid: number, committed: number, forecast: number,
): MonitoringLineInputs {
  return {
    category,
    current_budget_pence: current,
    certified_to_date_pence: certified,
    paid_to_date_pence: paid,
    committed_to_date_pence: committed,
    forecast_to_complete_pence: forecast,
  };
}

/** A hand-written block at `reporting_month: 3`. Every line satisfies §20.3's
 *  `paid <= certified <= committed`; the figures are deliberately all different so a
 *  column read off the wrong field cannot pass by coincidence. */
const BASE_LINES: MonitoringLineInputs[] = [
  //     category         current    certified  paid       committed  forecast
  mkLine('acquisition', 40_000_000, 40_000_000, 40_000_000, 40_000_000, 0),
  mkLine('construction', 60_000_000, 25_000_000, 22_000_000, 33_000_000, 27_000_000),
  mkLine('professional', 8_000_000, 3_000_000, 2_500_000, 4_000_000, 4_500_000),
  mkLine('statutory', 2_000_000, 900_000, 900_000, 1_200_000, 700_000),
  mkLine('contingency', 5_000_000, 1_000_000, 1_000_000, 1_500_000, 2_000_000),
];

function mkMonitoring(overrides: Partial<MonitoringInputs> = {}): MonitoringInputs {
  return {
    reporting_month: 3,
    reporting_date: '2026-06-30',
    lines: BASE_LINES,
    debt_drawn_to_date_pence: 0,
    cash_equity_injected_to_date_pence: 60_000_000,
    author: 'A. Surveyor MRICS',
    date: '2026-07-02',
    note: null,
    ...overrides,
  };
}

function withMonitoring(
  inputs: CalculatorInputsV11, monitoring: MonitoringInputs | null,
): CalculatorInputsV11 {
  return { ...inputs, monitoring };
}

describe('computeMonitoringStatement (R14 spec §20.2)', () => {
  it('returns null when `monitoring` is null', () => {
    const inputs = loadV11('l-retain-all');
    expect(inputs.monitoring).toBeNull();
    const { schedule, model, costPlan } = runDoc(inputs);
    expect(computeMonitoringStatement(schedule, model, inputs, costPlan)).toBeNull();
  });

  it('returns null when the document predates v11 and has no `monitoring` field at all', () => {
    // The pre-migration corpus document, passed through the engine as the union type it
    // really is: `monitoring` is absent, not null, and the statement must still be null.
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, 'l-retain-all.json'), 'utf-8')) as {
      inputs: AnyCalculatorInputs;
    };
    expect('monitoring' in raw.inputs).toBe(false);
    const { schedule, model, costPlan } = runDoc(raw.inputs);
    expect(computeMonitoringStatement(schedule, model, raw.inputs, costPlan)).toBeNull();
  });

  it('emits five lines in MONITORING_CATEGORIES order even when the input lists them reversed', () => {
    const base = loadV11('l-retain-all');
    const reversed = withMonitoring(base, mkMonitoring({ lines: [...BASE_LINES].reverse() }));
    const { schedule, model, costPlan } = runDoc(reversed);
    const statement = computeMonitoringStatement(schedule, model, reversed, costPlan);
    expect(statement).not.toBeNull();
    expect(statement!.lines).toHaveLength(5);
    expect(statement!.lines.map((l) => l.category)).toEqual([...MONITORING_CATEGORIES]);

    // Order is the ONLY difference: the in-order document produces the identical statement.
    const inOrder = withMonitoring(base, mkMonitoring());
    const straight = computeMonitoringStatement(schedule, model, inOrder, costPlan);
    expect(statement).toEqual(straight);
  });

  it('holds the per-line column identities on every category', () => {
    const inputs = withMonitoring(loadV11('l-retain-all'), mkMonitoring());
    const { schedule, model, costPlan } = runDoc(inputs);
    const statement = computeMonitoringStatement(schedule, model, inputs, costPlan)!;
    const originals = originalBudgets(schedule, costPlan);

    for (const line of statement.lines) {
      const entered = BASE_LINES.find((l) => l.category === line.category)!;
      expect(line.current_budget_pence, line.category).toBe(entered.current_budget_pence);
      expect(line.certified_to_date_pence, line.category).toBe(entered.certified_to_date_pence);
      expect(line.paid_to_date_pence, line.category).toBe(entered.paid_to_date_pence);
      expect(line.committed_to_date_pence, line.category).toBe(entered.committed_to_date_pence);
      expect(line.forecast_to_complete_pence, line.category).toBe(entered.forecast_to_complete_pence);
      expect(line.original_budget_pence, line.category).toBe(originals[line.category]);

      expect(line.committed_not_certified_pence, line.category)
        .toBe(line.committed_to_date_pence - line.certified_to_date_pence);
      expect(line.estimated_final_cost_pence, line.category)
        .toBe(line.committed_to_date_pence + line.forecast_to_complete_pence);
      expect(line.variance_vs_original_pence, line.category)
        .toBe(line.estimated_final_cost_pence - line.original_budget_pence);
      expect(line.variance_vs_current_pence, line.category)
        .toBe(line.estimated_final_cost_pence - line.current_budget_pence);
      // Both of §7's two equivalent forms of the same column.
      expect(line.remaining_to_spend_pence, line.category)
        .toBe(line.estimated_final_cost_pence - line.certified_to_date_pence);
      expect(line.remaining_to_spend_pence, line.category)
        .toBe(line.committed_not_certified_pence + line.forecast_to_complete_pence);
    }

    // The hand-derived construction line, so the identities above cannot pass on all-zeros.
    const construction = statement.lines[1];
    expect(construction.category).toBe('construction');
    expect(construction.committed_not_certified_pence).toBe(8_000_000);
    expect(construction.estimated_final_cost_pence).toBe(60_000_000);
    expect(construction.variance_vs_current_pence).toBe(0);
    expect(construction.remaining_to_spend_pence).toBe(35_000_000);

    // R14 Task 8 (carried from Task 7's review): the construction/contingency SPLIT
    // POINT itself, as two hand-derived integers rather than only as the sum identity
    // swept in the corpus test below. `l-retain-all` is a v5 document, so
    // `migrateInputsToV11` builds it a HEADLINE cost plan from the legacy fields:
    //   base_build  = construction_cost_per_sqm_pence × developed_area_sqm
    //               = 100,000 × 400            = 40,000,000
    //   compliance  = fire_safety + sound_insulation + part_l = 0 + 0 + 0 = 0
    //   construction original = base_build + compliance       = 40,000,000
    //   contingency original  = contingency_pct × base_build
    //               = 10% × 40,000,000                        =  4,000,000
    // and 40,000,000 + 4,000,000 is the 44,000,000 the fixture already pins as
    // `construction_cost_pence`. Without these two, an engine that put the WHOLE
    // 44,000,000 on the construction line and 0 on contingency (or split it any other
    // way) would still satisfy the sum identity.
    expect(statement.lines[1].original_budget_pence).toBe(40_000_000);
    expect(statement.lines[4].category).toBe('contingency');
    expect(statement.lines[4].original_budget_pence).toBe(4_000_000);
  });

  it('totals are the column sums, and contingency_remaining is floored at 0', () => {
    const inputs = withMonitoring(loadV11('l-retain-all'), mkMonitoring());
    const { schedule, model, costPlan } = runDoc(inputs);
    const statement = computeMonitoringStatement(schedule, model, inputs, costPlan)!;
    const sum = (f: (l: (typeof statement.lines)[number]) => number) =>
      statement.lines.reduce((a, l) => a + f(l), 0);

    expect(statement.totals.original_budget_pence).toBe(sum((l) => l.original_budget_pence));
    expect(statement.totals.current_budget_pence).toBe(115_000_000);
    expect(statement.totals.certified_to_date_pence).toBe(69_900_000);
    expect(statement.totals.paid_to_date_pence).toBe(66_400_000);
    expect(statement.totals.committed_to_date_pence).toBe(79_700_000);
    expect(statement.totals.committed_not_certified_pence).toBe(9_800_000);
    expect(statement.totals.forecast_to_complete_pence).toBe(34_200_000);
    expect(statement.totals.estimated_final_cost_pence).toBe(113_900_000);
    expect(statement.totals.remaining_to_spend_pence).toBe(44_000_000);
    expect(statement.totals.variance_vs_original_pence)
      .toBe(sum((l) => l.variance_vs_original_pence));
    expect(statement.totals.variance_vs_current_pence).toBe(-1_100_000);

    // 5,000,000 current − 1,000,000 certified.
    expect(statement.contingency_remaining_pence).toBe(4_000_000);

    // Certified past the current budget floors at 0 rather than reporting negative
    // remaining contingency.
    const overspent = withMonitoring(loadV11('l-retain-all'), mkMonitoring({
      lines: BASE_LINES.map((l) => (
        l.category === 'contingency'
          ? mkLine('contingency', 5_000_000, 6_000_000, 6_000_000, 6_000_000, 0)
          : l
      )),
    }));
    const over = computeMonitoringStatement(schedule, model, overspent, costPlan)!;
    expect(over.contingency_remaining_pence).toBe(0);
  });

  it('splits construction and contingency without losing a penny, on every corpus fixture plus docZ()', () => {
    const stems = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
    const docs: Array<{ label: string; inputs: AnyCalculatorInputs }> = [];
    for (const file of stems) {
      const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as {
        kind: string; inputs?: AnyCalculatorInputs;
      };
      // Fixture K ('sensitivity') names a `base_fixture` and carries no `inputs`
      // (governance §2.1), so it has no schedule or cost plan of its own.
      if (fx.kind === 'sensitivity' || fx.inputs == null) continue;
      docs.push({ label: file, inputs: fx.inputs });
    }
    // R15b spec §24.5: `docZ()` is the one document in the sweep whose
    // `inflation_total_pence` is non-zero, so it is the document that would
    // actually catch `originalBudgets` forgetting the allowance — every stored
    // fixture above has `inflation_total_pence === 0` and would pass either way.
    docs.push({ label: 'docZ() (R15b builder)', inputs: docZ() });

    let checked = 0;
    for (const { label, inputs } of docs) {
      const schedule = buildSchedule(inputs);
      const costPlan = computeCostPlan(
        inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length,
      );
      const originals = originalBudgets(schedule, costPlan);
      const usesConstruction = schedule.uses.reduce((a, u) => a + u.construction_pence, 0);
      expect(originals.construction + originals.contingency, label).toBe(usesConstruction);
      // The other three columns against their own inception source, same sweep.
      expect(originals.acquisition, label)
        .toBe(schedule.uses.reduce((a, u) => a + u.acquisition_pence, 0));
      expect(originals.professional, label)
        .toBe(schedule.uses.reduce((a, u) => a + u.professional_pence, 0));
      expect(originals.statutory, label)
        .toBe(schedule.uses.reduce((a, u) => a + u.statutory_pence, 0));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });

  // R14 Task 8 (carried from Task 7's review) runs the sweep on the LEVERED, rolled-up
  // `f-dev-finance-12mo` as well as on the all-cash `l-retain-all`: on a cash deal the
  // reserve-headroom and undrawn-facility terms are structurally 0, so a date-dependent
  // break hiding in either of them has nothing to move.
  for (const stem of ['l-retain-all', 'f-dev-finance-12mo']) {
    it(`is inert to reporting_date on ${stem}: statements differing only in that field agree everywhere else`, () => {
      const base = loadV11(stem);
      // Three dates, not two. Every well-formed ISO yyyy-mm-dd is ten characters long, so a
      // pair of them cannot catch an engine that reads only the string's LENGTH — the exact
      // way this test was watched fail (the engine temporarily added `reporting_date.length`
      // to `surplus_pence`). The third is a timestamp-shaped value: not what §20.1 asks for,
      // but nothing in this module validates the field, and it is what a caller stamping
      // `new Date().toISOString()` would store. Its length differs, so the sweep below is
      // sensitive to both the value and the length of the string.
      const dates = ['2026-06-30', '2031-12-31', '2026-06-30T09:15:00.000Z'];
      expect(new Set(dates.map((d) => d.length)).size).toBeGreaterThan(1);

      const { schedule, model, costPlan } = runDoc(base);
      const statements = dates.map((reporting_date) => {
        const inputs = withMonitoring(base, mkMonitoring({ reporting_date }));
        const s = computeMonitoringStatement(schedule, model, inputs, costPlan)!;
        expect(s.reporting_date).toBe(reporting_date);
        return s;
      });
      for (const s of statements.slice(1)) {
        expect({ ...s, reporting_date: '' }).toEqual({ ...statements[0], reporting_date: '' });
      }
    });
  }

  it('reconciles the funding side on a serviced document (no interest reserve credited)', () => {
    // f-dev-finance-12mo is a levered, rolled-up document: net 60,000,000 against gross
    // 66,000,000, i.e. a 6,000,000 reserve. Flipping `interest_type` to `serviced` is the
    // one change — §4.3 makes serviced interest an equity use, so the reserve earns no
    // credit and `reserve_headroom_pence` must be 0 on a facility that plainly has one.
    const levered = loadV11('f-dev-finance-12mo');
    const serviced: CalculatorInputsV11 = withMonitoring(
      { ...levered, finance: { ...levered.finance, interest_type: 'serviced' } },
      mkMonitoring({
        debt_drawn_to_date_pence: 20_000_000,
        cash_equity_injected_to_date_pence: 20_000_000,
      }),
    );
    const { schedule, model, costPlan } = runDoc(serviced);
    expect(model.committed_gross_facility_pence - model.committed_net_facility_pence)
      .toBeGreaterThan(0);
    const statement = computeMonitoringStatement(schedule, model, serviced, costPlan)!;

    expect(statement.reserve_headroom_pence).toBe(0);
    expect(statement.undrawn_net_facility_pence).toBe(40_000_000);   // 60,000,000 − 20,000,000
    expect(statement.remaining_cash_equity_pence).toBe(15_000_000);  // 35,000,000 − 20,000,000
    expect(statement.remaining_funding_pence)
      .toBe(statement.undrawn_net_facility_pence + statement.remaining_cash_equity_pence);

    // The same document left rolled-up DOES credit the reserve — otherwise the assertion
    // above would pass on an engine that never computes a reserve at all.
    const rolledUp = withMonitoring(levered, serviced.monitoring);
    const ru = runDoc(rolledUp);
    const rolledStatement = computeMonitoringStatement(
      ru.schedule, ru.model, rolledUp, ru.costPlan,
    )!;
    expect(rolledStatement.reserve_headroom_pence).toBeGreaterThan(0);
    expect(rolledStatement.remaining_funding_pence).toBe(
      rolledStatement.undrawn_net_facility_pence + rolledStatement.reserve_headroom_pence
      + rolledStatement.remaining_cash_equity_pence,
    );
  });

  it('reports a shortfall of exactly max(0, −surplus) when the forecast outruns the funding', () => {
    // A forecast-to-complete of ten times the scheme's whole value cannot be funded by any
    // document: remaining funding is bounded above by the committed facility plus committed
    // cash equity, and no viable scheme commits ten GDVs of funding. That makes the sign of
    // `surplus_pence` certain here without pinning the fixture's own figures.
    const base = loadV11('l-retain-all');
    const probe = buildSchedule(base);
    const schemeValue = probe.totals.gdv_pence + probe.totals.retained_value_pence;
    expect(schemeValue).toBeGreaterThan(0);
    const inputs = withMonitoring(base, mkMonitoring({
      lines: BASE_LINES.map((l) => (
        l.category === 'construction'
          ? { ...l, forecast_to_complete_pence: 10 * schemeValue }
          : l
      )),
    }));
    const { schedule, model, costPlan } = runDoc(inputs);
    const statement = computeMonitoringStatement(schedule, model, inputs, costPlan)!;

    expect(statement.surplus_pence).toBeLessThan(0);
    expect(statement.shortfall_pence).toBe(Math.max(0, -statement.surplus_pence));
    expect(statement.remaining_uses_pence)
      .toBe(statement.totals.remaining_to_spend_pence + statement.forecast_finance_pence);
    expect(statement.surplus_pence)
      .toBe(statement.remaining_funding_pence - statement.remaining_uses_pence);

    // An unstressed block on the same document has a positive surplus and therefore a zero
    // shortfall — max(0, −surplus) is exercised on both of its branches. `l-retain-all` is
    // an all-cash scheme with 90,000,000 of committed cash equity, so this needs the equity
    // still un-injected: the base block's 60,000,000 already drawn down leaves only
    // 30,000,000 against 44,000,000 of remaining spend, which is itself a real shortfall.
    const healthy = withMonitoring(base, mkMonitoring({ cash_equity_injected_to_date_pence: 0 }));
    const ok = computeMonitoringStatement(schedule, model, healthy, costPlan)!;
    expect(ok.surplus_pence).toBeGreaterThanOrEqual(0);
    expect(ok.shortfall_pence).toBe(0);
  });

  it('measures the three variances against the inception ledger at m − 1', () => {
    const base = loadV11('f-dev-finance-12mo');
    const inputs = withMonitoring(base, mkMonitoring({
      debt_drawn_to_date_pence: 20_000_000,
      cash_equity_injected_to_date_pence: 20_000_000,
    }));
    const { schedule, model, costPlan } = runDoc(inputs);
    const statement = computeMonitoringStatement(schedule, model, inputs, costPlan)!;
    const m = 3;

    let plannedDraw = 0; let plannedEquity = 0; let plannedCost = 0;
    for (let k = 0; k < m; k++) {
      plannedDraw += model.months[k].draw_pence + model.months[k].capitalised_fees_pence;
      plannedEquity += model.months[k].equity_contribution_pence;
      const u = schedule.uses[k];
      plannedCost += u.acquisition_pence + u.construction_pence
        + u.professional_pence + u.statutory_pence;
    }
    expect(statement.debt_drawn_variance_pence).toBe(20_000_000 - plannedDraw);
    expect(statement.equity_injected_variance_pence).toBe(20_000_000 - plannedEquity);
    expect(statement.cost_to_date_variance_pence)
      .toBe(statement.totals.certified_to_date_pence - plannedCost);

    // Forecast finance covers ledger months m..term−1 only.
    let forecastFinance = 0;
    for (let k = m; k < schedule.term_months; k++) {
      forecastFinance += model.months[k].interest_accrued_pence
        + model.months[k].capitalised_fees_pence;
    }
    expect(statement.forecast_finance_pence).toBe(forecastFinance);
    expect(statement.reporting_month).toBe(m);
  });
});

describe('originalBudgets carries the inflation allowance (R15b spec §24.5)', () => {
  it('holds the split identity on Z, exactly, with a monitoring block attached at reporting_month 9', () => {
    // Z's own builder carries no `monitoring` block; one is attached here, at the
    // document level, exactly as a real caller would before running the appraisal —
    // the brief's "via the builder document, run the appraisal" shape, not a direct
    // `computeMonitoringStatement` call against a hand-built schedule/cost-plan pair.
    const withMonitoring = {
      ...docZ(),
      monitoring: {
        reporting_month: 9,
        reporting_date: '2026-12-31',
        lines: [
          mkLine('acquisition', 100_000_000, 100_000_000, 100_000_000, 100_000_000, 0),
          mkLine('construction', 71_496_722, 30_000_000, 28_000_000, 35_000_000, 40_000_000),
          mkLine('professional', 8_500_000, 3_000_000, 2_500_000, 4_000_000, 4_500_000),
          mkLine('statutory', 3_400_000, 1_000_000, 900_000, 1_200_000, 700_000),
          mkLine('contingency', 3_300_000, 1_000_000, 1_000_000, 1_500_000, 2_000_000),
        ],
        // Below Z's committed net facility (100,000,000, spec §24.5's own S/Z figure).
        debt_drawn_to_date_pence: 50_000_000,
        cash_equity_injected_to_date_pence: 40_000_000,
        author: 'A. Surveyor MRICS',
        date: '2027-01-15',
        note: null,
      },
    };
    const run = runAppraisal(withMonitoring);
    const statement = run.metrics.monitoring_statement;
    expect(statement).not.toBeNull();
    const construction = statement!.lines.find((l) => l.category === 'construction')!;
    const contingency = statement!.lines.find((l) => l.category === 'contingency')!;
    const usesConstruction = run.schedule.uses.reduce((a, u) => a + u.construction_pence, 0);

    // The split identity: original(construction) + original(contingency) is exactly
    // what the schedule spread across every month's construction use — inflation
    // included, because `construction_total_pence` already folds it in (cost-plan.ts).
    expect(construction.original_budget_pence + contingency.original_budget_pence)
      .toBe(usesConstruction);
    // The exact figure: base_build (66,000,000) + inflation_total (5,496,722) +
    // compliance (0) — the RED value before Task 4's fix is the bare 66,000,000.
    expect(construction.original_budget_pence).toBe(66_000_000 + 5_496_722 + 0);
    expect(construction.original_budget_pence).toBe(71_496_722);
  });
});
