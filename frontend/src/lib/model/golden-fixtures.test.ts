import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import { migrateInputsToV5 } from './migrate';
import { runSensitivity } from './sensitivity';
import type { SensitivityConfig } from './sensitivity';
import { applyScenario } from './apply-scenario';
import type { AppraisalRun } from './index';
import type { AnyCalculatorInputs, AppraisalResultV2 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

interface Fixture {
  name: string;
  // 'programme' marks a fixture whose `inputs` carry a non-null `programme` block
  // (spec §6.1, calc 2.2.0) — h-programme-scurve.json, Release 3a; 'phased-sales'
  // one whose `inputs` carry a non-null `sales_phasing` block (spec §4.4.1, calc
  // 2.3.0) — i-phased-sales.json, Release 3b; 'refinance' one carrying a non-null
  // `refinance` block (spec §4.5, calc 2.3.0) — j-blended-refinance.json, which
  // carries both blocks and a `blended` exit route. All are labels only: every
  // fixture, whatever its kind, runs through the same `runAppraisal` assertion
  // loop below.
  // 'sensitivity' marks the R4 suite fixture (spec §12, calc 2.4.0) —
  // k-sensitivity.json. Unlike every other kind it carries no `inputs` of its own,
  // naming a `base_fixture` instead, so it is excluded from the runAppraisal loop
  // below and asserted by its own describe block.
  kind: 'pipeline' | 'programme' | 'phased-sales' | 'refinance' | 'sensitivity';
  // Widened from CalculatorInputsV2 in Release 3a: the corpus now mixes v3 and v4
  // documents, and `runAppraisal` takes the union directly (no downcast adapter).
  inputs: AnyCalculatorInputs;
  // Most keys are real AppraisalResultV2 properties. A few are not — they're a
  // fixture-authoring convenience mapped onto other parts of the run by FLAT_KEYS below
  // (the two cost_to_complete_* summary keys, spec §5.10; and funding_gap_pence, which
  // lives on the ledger totals rather than on the metrics object, spec §4.2).
  expected_metrics: Partial<AppraisalResultV2> & Record<string, unknown>;
}

const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();

const fixtures: Fixture[] = fixtureFiles
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);

// The corpus is loaded by directory scan, so a fixture file that is deleted, renamed or
// never committed would silently reduce coverage instead of failing. This explicit roster
// is the "fixture list": adding a golden fixture means adding its stem here too.
const EXPECTED_FIXTURE_STEMS = [
  'a-all-cash',
  'f-dev-finance-12mo',
  'g-lender-valuation',
  'h-programme-scurve',
  'i-phased-sales',
  'j-blended-refinance',
  'k-sensitivity',
  'l-retain-all',
];

// Every fixture that carries its own `inputs` document, i.e. everything the
// runAppraisal loops below can run. Fixture K names a `base_fixture` instead of
// carrying inputs (spec §12, governance §2.1), so it is asserted by its own describe
// block at the end of this file rather than here.
const appraisalFixtures = fixtures.filter((f) => f.kind !== 'sensitivity');

// Minimal flat-key -> run-structure mapping for the fixture keys that are not direct
// AppraisalResultV2 properties. Every other expected_metrics key is a real, direct
// AppraisalResultV2 property, asserted below without this indirection.
//
// The mapper takes the whole AppraisalRun (widened in Release 3a from the previous
// cost_to_complete-only signature) so a pinnable quantity living outside `metrics` —
// like the ledger's funding gap — can be pinned without restructuring the harness.
const FLAT_KEYS: Record<string, (run: AppraisalRun) => unknown> = {
  // spec §5.10, Release 2b Task 6
  cost_to_complete_first_shortfall_month: (r) => r.metrics.cost_to_complete?.first_shortfall_month ?? null,
  cost_to_complete_max_shortfall_pence: (r) => r.metrics.cost_to_complete?.max_shortfall_pence ?? null,
  // spec §4.2 step 3 ("cost overruns never create facility"), Release 3a: the accumulated
  // unfunded cost. It is the headline behaviour of fixture H, so it must be pinned, but it
  // is a ledger total rather than a summary metric.
  funding_gap_pence: (r) => r.model.totals.funding_gap_pence,
  // spec §4.4.1 (calc 2.3.0), Release 3b: the phased-disposal redemption fields. Like
  // funding_gap_pence above, these are `model` properties rather than summary metrics, so
  // they reach the harness through the same AppraisalRun-wide mapper. The declining
  // schedule is pinned as two parallel flat arrays (months / balances) rather than an array
  // of objects, so the fixture JSON stays language-neutral for the Python mirror — the
  // model's own shape is Array<{ month, balance_pence }> and is projected here.
  redemption_balance_at_disposal_pence: (r) => r.model.redemption_balance_at_disposal_pence,
  redemption_schedule_months: (r) => r.model.redemption_schedule.map((e) => e.month),
  redemption_schedule_balances_pence: (r) => r.model.redemption_schedule.map((e) => e.balance_pence),
};

describe('golden fixtures (shared with the Python engine)', () => {
  it('every expected fixture file is present in the shared corpus', () => {
    expect(fixtureFiles).toEqual(EXPECTED_FIXTURE_STEMS.map((s) => `${s}.json`));
  });

  function assertExpectedMetrics(run: AppraisalRun, fx: Fixture, label: string) {
    for (const [key, expected] of Object.entries(fx.expected_metrics)) {
      const mapper = FLAT_KEYS[key];
      const actual = mapper ? mapper(run) : run.metrics[key as keyof AppraisalResultV2];
      expect(actual, `${label}: ${key}`).toEqual(expected);
    }
  }

  for (const fx of appraisalFixtures) {
    it(fx.name, () => {
      assertExpectedMetrics(runAppraisal(fx.inputs), fx, fx.name);
    });
  }

  for (const fx of appraisalFixtures) {
    // Mirrors Python's test_fixtures_reproduce_their_metrics_after_migration_to_v5.
    it(`${fx.name} — reproduces its metrics after migration to v5`, () => {
      // Release 3a identity guarantee (spec §6.1 / design §2.4), carried to v5 by R8
      // (spec §14): the migration chain is purely additive, so running a fixture's
      // inputs through the full normalisation chain must reproduce that fixture's
      // pinned expected_metrics unchanged, not merely "close". Every fixture is now
      // v5, so this exercises migrateInputsToV5's merge branch — which must drop
      // neither the programme block nor the R8 acquisition block.
      const v5 = migrateInputsToV5(fx.inputs as unknown as Record<string, unknown>);
      expect(v5.inputs_version).toBe(5);
      assertExpectedMetrics(runAppraisal(v5), fx, `${fx.name}[migrated-to-v5]`);
    });
  }

  // Fix round 2 (R8 Task 5). Every fixture in the corpus is now v5, so the loop
  // above proves only that "a v5 document merged onto v5 defaults reproduces its
  // pins". The property that matters for real data is the other one: *an old
  // stored document still reproduces its pins after normalisation* — every
  // persisted row in the database is v3 or v4, and nothing writes v5 yet. This
  // reverses the R8 additions and re-runs the whole corpus through the migration
  // chain from where it actually was before this release, restoring corpus-wide
  // coverage of that path (it was previously the `migrated-to-v4` loop's job).
  const R8_ACQUISITION_KEYS = [
    'jurisdiction', 'jurisdiction_source', 'jurisdiction_evidence_status',
    'acquisition_date', 'acquisition_tax_override_pence', 'acquisition_tax_override_reason',
  ];

  function asPreR8Document(inputs: AnyCalculatorInputs): Record<string, unknown> {
    const doc = JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
    const acq = doc.acquisition as Record<string, unknown>;
    for (const key of R8_ACQUISITION_KEYS) delete acq[key];
    // The pre-R8 version, derived structurally rather than hard-coded per stem:
    // the three v4 blocks arrived together in Release 3a, so a fixture carrying
    // `programme` was v4 and one without it was v3.
    doc.inputs_version = 'programme' in doc ? 4 : 3;
    return doc;
  }

  for (const fx of appraisalFixtures) {
    // Mirrors Python's test_pre_r8_fixture_form_reproduces_its_metrics_after_migration.
    it(`${fx.name} — reproduces its metrics from its pre-R8 (v3/v4) form`, () => {
      const pre = asPreR8Document(fx.inputs);
      expect(pre.inputs_version).not.toBe(5);
      expect(R8_ACQUISITION_KEYS.some((k) => k in (pre.acquisition as object))).toBe(false);
      const v5 = migrateInputsToV5(pre);
      expect(v5.inputs_version).toBe(5);
      // The migration stamps what a legacy document honestly is: England/NI by
      // default, unconfirmed, no transaction date (spec §14).
      expect(v5.acquisition.jurisdiction).toBe('england_ni');
      expect(v5.acquisition.jurisdiction_source).toBe('migrated_default');
      expect(v5.acquisition.jurisdiction_evidence_status).toBe('unconfirmed');
      expect(v5.acquisition.acquisition_date).toBeNull();
      assertExpectedMetrics(runAppraisal(v5), fx, `${fx.name}[pre-R8 → v5]`);
    });
  }

  // Negative control (fixture H's precedent, Release 3a — a pinned key that no assertion
  // actually reaches is a copy-paste false pass, not coverage). The three redemption keys
  // added in Release 3b reach the run through FLAT_KEYS rather than through
  // AppraisalResultV2, so a typo in a mapper (or a key silently absent from the mapper
  // table) would compare `undefined` against `undefined` for a fixture that happened not to
  // pin it, and pass. This flips each mapped key to a deliberately wrong value and asserts
  // the loop FAILS. If any of these stops throwing, the corresponding pin has gone inert.
  //
  // Run over BOTH fixtures that pin all three redemption keys, because they exercise
  // opposite sides of the same mappers (Release 3b Task 8): fixture I's redemption balance
  // is 0 and its three-entry schedule ends at 0, while fixture J's is non-zero and its
  // two-entry schedule ends non-zero. A mapper that returned a constant, or dropped the
  // final entry, could satisfy one fixture's control while failing the other's.
  const negativeControls: Array<{ namePrefix: string; wrongValues: Record<string, unknown> }> = [
    {
      namePrefix: 'I — phased sell_all',
      wrongValues: {
        redemption_balance_at_disposal_pence: 1,                    // truly 0
        redemption_schedule_months: [9, 10],                        // truly [9, 10, 11]
        redemption_schedule_balances_pence: [53431299, 10782708, 1], // truly [..., 0]
        funding_gap_pence: 1,                                       // truly 0
        peak_debt_pence: 53431300,                                  // truly 53431299 (direct key)
      },
    },
    {
      namePrefix: 'J — blended exit',
      wrongValues: {
        redemption_balance_at_disposal_pence: 4946601,              // truly 4946600
        redemption_schedule_months: [9, 10],                        // truly [9, 11]
        redemption_schedule_balances_pence: [53431299, 4946601],    // truly [..., 4946600]
        funding_gap_pence: 1,                                       // truly 0
        peak_debt_pence: 53431300,                                  // truly 53431299 (direct key)
      },
    },
  ];

  for (const { namePrefix, wrongValues } of negativeControls) {
    it(`negative control (${namePrefix}): a deliberately-wrong value for each mapped key fails`, () => {
      const fx = fixtures.find((f) => f.name.startsWith(namePrefix));
      expect(fx, `fixture "${namePrefix}" must be in the corpus`).toBeDefined();
      const run = runAppraisal(fx!.inputs);

      for (const [key, wrong] of Object.entries(wrongValues)) {
        const poisoned: Fixture = {
          ...fx!,
          expected_metrics: { ...fx!.expected_metrics, [key]: wrong },
        };
        expect(
          () => assertExpectedMetrics(run, poisoned, 'negative-control'),
          `wrong ${key} must fail`,
        ).toThrow();
      }
    });
  }
});

describe('Fixture K — sensitivity suite (spec §12)', () => {
  interface SensitivityFixture {
    name: string;
    kind: 'sensitivity';
    base_fixture: string;
    config: SensitivityConfig;
    expected_derived_inputs: Record<string, Record<string, number>>;
    expected_base: Record<string, number | string[]>;
    expected_corner_cells: Array<Record<string, number | string[]>>;
    expected_tornado_order: string[];
    expected_tornado_spans_pence: Record<string, number>;
    invalid_case: {
      note: string;
      config: SensitivityConfig;
      expected_unmeasured_rows: number[];
      expected_measured_rows: number[];
      expected_unmeasured_error: { severity: string; field: string; message: string };
    };
  }

  const k = JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'k-sensitivity.json'), 'utf-8'),
  ) as SensitivityFixture;

  const baseInputs = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${k.base_fixture}.json`), 'utf-8'),
  ).inputs as AnyCalculatorInputs;

  const result = runSensitivity(baseInputs, k.config);

  // Hand-derived: the per-axis derived inputs (§12.1 disjointness makes these per axis,
  // not per cell). A lever-composition bug shows up here first.
  it('applies each lever to the hand-derived value', () => {
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.gdv)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: Number(step),
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.unit_mix.units.every((u) => u.estimated_value_pence === expected)).toBe(true);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.construction_cost)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: Number(step), timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.conversion_costs.construction_cost_per_sqm_pence).toBe(expected);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.timeline)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: Number(step),
        interest_rate_adjustment_pct: 0,
      });
      expect(levered.finance.term_months).toBe(expected);
    }
    for (const [step, expected] of Object.entries(k.expected_derived_inputs.interest_rate)) {
      const levered = applyScenario(baseInputs, {
        label: '', gdv_adjustment_pct: 0,
        construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: Number(step),
      });
      expect(levered.finance.annual_interest_rate_pct).toBe(expected);
    }
  });

  // Hand-derived: reused verbatim from Fixture F (§12.5). `toEqual`, not `toBe`: the
  // `flags` pin is an array, and `toBe`'s reference equality would fail against any
  // freshly-built array even when its contents match — a pin that could never bite.
  it('reports the hand-derived base case', () => {
    for (const [key, expected] of Object.entries(k.expected_base)) {
      expect(result.base[key as keyof typeof result.base]).toEqual(expected);
    }
  });

  // Hand-derived: two corners worked through on a worksheet
  // (docs/financial-model/test-cases.md, "Fixture K — sensitivity suite").
  it('reports the hand-derived corner cells', () => {
    for (const corner of k.expected_corner_cells) {
      // Matched by filter-and-count rather than `.find`, mirroring the Python assertion:
      // a matrix that enumerated a grid position twice would silently satisfy a
      // first-match lookup, and a corner assertion that can pass against a duplicated
      // cell is not pinning the position it names.
      const matches = result.matrix
        .flat()
        .filter((c) => c.row_step === corner.row_step && c.col_step === corner.col_step);
      expect(matches, `corner ${corner.row_step}/${corner.col_step}`).toHaveLength(1);
      const found = matches[0] as unknown as Record<string, unknown>;
      for (const [key, expected] of Object.entries(corner)) {
        if (key === 'row_step' || key === 'col_step') continue;
        expect(found[key], `corner ${corner.row_step}/${corner.col_step} → ${key}`).toEqual(expected);
      }
    }
  });

  // Hand-derived: spans and the resulting order.
  it('reports the hand-derived tornado spans and order', () => {
    expect(result.tornado.map((b) => b.lever)).toEqual(k.expected_tornado_order);
    for (const bar of result.tornado) {
      expect(bar.span_pence).toBe(k.expected_tornado_spans_pence[bar.lever]);
    }
  });

  // Identity-asserted, not snapshotted: §12.3 *defines* a cell as this expression, so
  // the assertion is the contract. Wrong composition or enumeration is already caught
  // by the hand-derived derived-inputs and corners above.
  it('defines every remaining cell as the levered appraisal (spec §12.3)', () => {
    result.config.rows.steps.forEach((rowStep, ri) => {
      result.config.cols.steps.forEach((colStep, ci) => {
        const expected = runAppraisal(applyScenario(baseInputs, {
          label: '',
          gdv_adjustment_pct: colStep,
          construction_cost_adjustment_pct: rowStep,
          timeline_adjustment_months: 0,
          interest_rate_adjustment_pct: 0,
        })).metrics;
        const cell = result.matrix[ri][ci];
        expect(cell.profit_pence).toBe(expected.profit_pence);
        expect(cell.profit_on_cost_pct).toBe(expected.profit_on_cost_pct);
        expect(cell.ltgdv_developer_pct).toBe(expected.ltgdv_developer_pct);
        expect(cell.peak_debt_pence).toBe(expected.peak_debt_pence);
        expect(cell.flags).toEqual(expected.flags.map((f) => f.code));
      });
    });
  });

  // Hand-derived (§12.7): 12 + (−12) = 0 < 1, so that row is unmeasured; 12 + (−11) = 1,
  // which is legal, so that row must still measure. The measured row is the half that
  // matters — a rule that marked everything unmeasured would satisfy the other half alone.
  it('does not measure the positions §12.7 excludes, and still measures the boundary', () => {
    const ic = k.invalid_case;
    const r = runSensitivity(baseInputs, ic.config);

    for (const step of ic.expected_unmeasured_rows) {
      const row = r.matrix.find((cells) => cells[0].row_step === step);
      expect(row, `row ${step}`).toBeDefined();
      for (const cell of row!) {
        expect(cell.profit_pence, `row ${step} profit`).toBeNull();
        expect(cell.peak_debt_pence, `row ${step} peak debt`).toBeNull();
        expect(cell.flags, `row ${step} flags`).toEqual([]);
        expect(cell.validation_errors, `row ${step} errors`).toContainEqual(
          ic.expected_unmeasured_error,
        );
      }
    }

    for (const step of ic.expected_measured_rows) {
      const row = r.matrix.find((cells) => cells[0].row_step === step);
      expect(row, `row ${step}`).toBeDefined();
      for (const cell of row!) {
        expect(cell.validation_errors, `row ${step} errors`).toEqual([]);
        expect(cell.profit_pence, `row ${step} profit`).not.toBeNull();
      }
    }
  });
});
