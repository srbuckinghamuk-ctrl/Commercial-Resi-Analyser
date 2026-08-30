import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import CashflowPage from './CashflowPage';
import { runAppraisal, migrateInputsToV17 } from '../../lib/model';
import type { AppraisalRun, CalculatorInputsV17 } from '../../lib/model';
import { defaultCalculatorInputsV17 } from '../../lib/conversion-defaults';
import { penceToPounds } from '../../lib/format';
import { formatProgrammeMonth, programmeAnchor } from '../../lib/programme-months';
import { anchoredSlippedDoc } from '../../lib/model/__fixtures__/investment-case-docs';
import { unitSalesDoc, heldTwinDoc } from '../../lib/model/__fixtures__/unit-sales-docs';

// Same fixture directory as AppraisalSummaryPage.test.tsx / export-investment-memo.test.ts.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
// v5 on disk (R8) -- see the same note in AppraisalSummaryPage.test.tsx.
const fixtureH = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'h-programme-scurve.json'), 'utf-8'),
) as { inputs: CalculatorInputsV17 };
// v5 on disk (R8) -- see the same note in AppraisalSummaryPage.test.tsx.
const fixtureJ = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
) as { inputs: CalculatorInputsV17 };
// v8 on disk, registered for VAT -- the R11 §17.4 worked cycle.
const fixtureVat = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'r-vat-quarterly.json'), 'utf-8'),
) as { inputs: CalculatorInputsV17 };
// v9 on disk -- a dated phase NETWORK, not the legacy three-package shape.
const fixtureNetwork = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 's-dated-programme.json'), 'utf-8'),
) as { inputs: CalculatorInputsV17 };
// v10 on disk -- R13 spec §19.6: "CashflowPage gains the NOI row". Retain-all
// investment case, DSCR binds; gross_sales_pence is 0 on this document, so
// without the NOI row the ledger's Repayment/Distribution columns move with
// no visible source.
const fixtureInvestmentCase = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 't-investment-case.json'), 'utf-8'),
) as { inputs: CalculatorInputsV17 };

describe('CashflowPage — no programme, no sales phasing (default v4)', () => {
  const inputs = defaultCalculatorInputsV17();
  const run = runAppraisal(inputs);

  it('keeps the original assumptions note verbatim', () => {
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    // Default term_months is 12 -> spendWindow = 10, disposal in month 11.
    expect(run.schedule.term_months).toBe(12);
    expect(
      screen.getByText('Straight-line spend over months 1–10; disposal in month 11; see calculation specification §6.'),
    ).toBeInTheDocument();
  });

  it('labels months with the plain "Month N" fallback (no anchor)', () => {
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getAllByText('Month 0').length).toBeGreaterThan(0);
  });

  it('does not render a Refi proceeds column when no month has refinance proceeds', () => {
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.queryByText('Refi proceeds')).not.toBeInTheDocument();
  });
});

describe('CashflowPage — explicit dated programme (fixture H)', () => {
  const run = runAppraisal(fixtureH.inputs);

  it('composes the programme-aware assumptions note', () => {
    render(<CashflowPage inputs={fixtureH.inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByText(/Explicit dated programme \(spec §6\.1\)/)).toBeInTheDocument();
    expect(screen.getByText(/see calculation specification §4\.4–§6\.1\./)).toBeInTheDocument();
  });

  it('labels months using the calendar anchor (2026-10)', () => {
    render(<CashflowPage inputs={fixtureH.inputs} onChange={vi.fn()} run={run} />);
    // Month 0 with anchor 2026-10 -> "Oct 2026".
    expect(screen.getAllByText('Oct 2026').length).toBeGreaterThan(0);
    expect(screen.queryByText('Month 0')).not.toBeInTheDocument();
  });

  it('labels the peak-debt KPI with a calendar month, not a bare "Month N"', () => {
    render(<CashflowPage inputs={fixtureH.inputs} onChange={vi.fn()} run={run} />);
    expect(run.model.peak_debt_month).not.toBeNull();
    const peakDebtTile = screen.getByText('Peak Debt').parentElement as HTMLElement;
    expect(peakDebtTile.textContent).toMatch(/\(\w{3} \d{4}\)/);
    expect(peakDebtTile.textContent).not.toMatch(/\(Month \d+\)/);
  });
});

// R12 final review wave (Finding 1). A v9 phase-network document DOES reach a
// rendered run -- the `buildSchedule` throw the old comment described was
// removed mid-release -- so the note must say what schedule.ts actually does
// (bucket-per-phase placement), not the straight-line wording, and must not
// fall through the "no explicit programme" early-return either.
describe('CashflowPage — dated phase network (fixture S, v9)', () => {
  const run = runAppraisal(fixtureNetwork.inputs);

  it('describes per-phase placement, not a straight line', () => {
    render(<CashflowPage inputs={fixtureNetwork.inputs} onChange={vi.fn()} run={run} />);
    expect(
      screen.getByText(/Dated phase network: spend placed per phase, by derived window and curve \(spec §18\.5\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Straight-line spend/)).not.toBeInTheDocument();
  });
});

describe('CashflowPage — refinance modelled (fixture J)', () => {
  const run = runAppraisal(fixtureJ.inputs);

  it('adds a Refi proceeds column between Receipts (net) and Repayment', () => {
    render(<CashflowPage inputs={fixtureJ.inputs} onChange={vi.fn()} run={run} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const receiptsIdx = headers.indexOf('Receipts (net)');
    const refiIdx = headers.indexOf('Refi proceeds');
    const repaymentIdx = headers.indexOf('Repayment');
    expect(receiptsIdx).toBeGreaterThanOrEqual(0);
    expect(refiIdx).toBe(receiptsIdx + 1);
    expect(repaymentIdx).toBe(refiIdx + 1);
  });

  it('mentions the refinance month in the assumptions note', () => {
    render(<CashflowPage inputs={fixtureJ.inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByText(/; refinance in month 11;/)).toBeInTheDocument();
  });
});

// R11 Task 14 (spec §17.13, ruling R25). `costsTotal` is `Σ uses_total_pence`,
// which has silently included gross VAT since Task 6 -- the figure moved with
// no label change and no disclosure. Pin the label change AND the disclosed
// VAT component, read from run.metrics.vat, never recomputed here.
describe('CashflowPage — the cost total is VAT-inclusive, and says so (ruling R25)', () => {
  it('labels the Costs column as VAT-inclusive', () => {
    const inputs = defaultCalculatorInputsV17();
    const run = runAppraisal(inputs);
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByRole('columnheader', { name: 'Costs (VAT-incl.)' })).toBeInTheDocument();
  });

  it('does not show a VAT disclosure line on a document with no VAT charged', () => {
    const inputs = defaultCalculatorInputsV17();
    const run = runAppraisal(inputs);
    expect(run.metrics.vat.total_input_vat_pence).toBe(0);
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.queryByText(/is input VAT/i)).not.toBeInTheDocument();
  });

  it('discloses the VAT component of the cost total, read from run.metrics.vat', () => {
    const run = runAppraisal(fixtureVat.inputs);
    expect(run.metrics.vat.total_input_vat_pence).toBeGreaterThan(0);
    // Rigged to a figure nothing on the page could reproduce by summing the
    // visible monthly costs -- so a component that recomputed a VAT total
    // instead of reading run.metrics.vat would show a different number (or
    // none at all).
    const rigged: AppraisalRun = {
      ...run,
      metrics: { ...run.metrics, vat: { ...run.metrics.vat, total_input_vat_pence: 543_21 } },
    };
    render(<CashflowPage inputs={fixtureVat.inputs} onChange={vi.fn()} run={rigged} />);
    expect(screen.getByText(/is input VAT/i)).toBeInTheDocument();
    expect(screen.getByText(/£543/)).toBeInTheDocument();
  });
});

// §18.10 limitation 9, R12 carry, closed by R13 Task 12. anchoredSlippedDoc()
// carries an anchored tranche whose month_offset (12) is NOT where the
// ledger placed the receipt (14, via the sales+3 anchor) -- see
// export-investment-memo.test.ts's identically-named describe block for the
// full derivation, and schedule.test.ts's "publishes resolved_exit_months"
// test for the independent hand-derivation of 14/18/18.
describe('CashflowPage — anchored tranche/refinance on a slipped programme (§18.10 limitation 9, R12 carry)', () => {
  it('mentions the RESOLVED exit months in the assumptions note, not the raw month_offset', () => {
    const doc = anchoredSlippedDoc();
    const run = runAppraisal(doc);
    expect(run.schedule.resolved_exit_months.tranches).toEqual([14, 18]);
    expect(run.schedule.resolved_exit_months.refinance).toBe(18);

    // `inputs` is unused by CashflowPage's body (only `run` is destructured
    // in the component) -- a placeholder v9 default satisfies the prop's
    // type without a cast, and carries none of the figures under test.
    render(<CashflowPage inputs={defaultCalculatorInputsV17()} onChange={vi.fn()} run={run} />);

    const anchor = programmeAnchor(doc);
    const label = (m: number) => formatProgrammeMonth(anchor, m);
    // Reconstructs CashflowPage's own assumptionsNote string exactly (this
    // fixture takes the network + sales-phasing + refinance branch), so this
    // is a scoped assertion on the one sentence that names these months, not
    // a bare 'Month 12'/'Month 14' substring search.
    expect(screen.getByText(
      `Dated phase network: spend placed per phase, by derived window and curve (spec §18.5); `
      + `sales tranches in ${label(14)}, ${label(18)}; refinance in ${label(18)}; `
      + `see calculation specification §4.4–§6.1.`,
    )).toBeInTheDocument();
    expect(screen.queryByText(
      `Dated phase network: spend placed per phase, by derived window and curve (spec §18.5); `
      + `sales tranches in ${label(12)}, ${label(15)}; refinance in ${label(16)}; `
      + `see calculation specification §4.4–§6.1.`,
    )).not.toBeInTheDocument();
  });
});

// R13 fix-wave BLOCKING 1. §19.6 states CashflowPage "gains the NOI row";
// before this fix it did not render `net_operating_income_pence` at all.
describe('CashflowPage — NOI row (fixture T, retain-all investment case, spec §19.6)', () => {
  it('renders an NOI column with the stabilised monthly figure pinned', () => {
    const run = runAppraisal(fixtureInvestmentCase.inputs);
    // Hand-derived (spec §19.2), independent of the engine: gross potential
    // rent is 5 x 59,000 = 295,000/mo; egr_stab = round_half_up(295,000 x
    // 96%) = 283,200; opex_stab = 28,320 (10% management) + 5,664 (2%
    // letting) + 25,000 (insurance) + 8,000 (compliance) = 66,984;
    // noi_monthly_stab = 283,200 - 66,984 = 216,216. Term is 24 months and
    // stabilisation resolves to month 16 with a 3-month ramp (stabilised
    // from month 19), so month 23 (the last row) is fully stabilised and
    // reads this figure exactly -- not the ramp-period or pre-let value.
    expect(run.schedule.term_months).toBe(24);
    expect(run.model.months[23].net_operating_income_pence).toBe(216_216);

    render(<CashflowPage inputs={fixtureInvestmentCase.inputs} onChange={vi.fn()} run={run} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const noiIdx = headers.indexOf('NOI');
    expect(noiIdx).toBeGreaterThanOrEqual(0);

    const rows = screen.getAllByRole('row');
    const lastDataRow = rows[rows.length - 2]; // last tbody row (month 23), before the tfoot total
    const cells = within(lastDataRow).getAllByRole('cell');
    expect(cells[noiIdx].textContent).toBe('£2,162');
  });

  it('renders a negative (shortfall) NOI month honestly, not blank or as an absolute value', () => {
    const run = runAppraisal(fixtureInvestmentCase.inputs);
    // Rigged the same way the VAT disclosure test rigs run.metrics: a figure
    // nothing else on the page could reproduce, proving the cell reads the
    // signed ledger value rather than recomputing or sanitising it.
    const rigged: AppraisalRun = {
      ...run,
      model: {
        ...run.model,
        months: run.model.months.map((m, i) => (
          i === 23 ? { ...m, net_operating_income_pence: -543_21 } : m
        )),
      },
    };
    render(<CashflowPage inputs={fixtureInvestmentCase.inputs} onChange={vi.fn()} run={rigged} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const noiIdx = headers.indexOf('NOI');
    const rows = screen.getAllByRole('row');
    const lastDataRow = rows[rows.length - 2];
    const cells = within(lastDataRow).getAllByRole('cell');
    expect(cells[noiIdx].textContent).toBe('-£543');
  });

  it('does not render an NOI column for a document with no investment case', () => {
    const inputs = defaultCalculatorInputsV17();
    const run = runAppraisal(inputs);
    expect(run.model.months.every((m) => m.net_operating_income_pence === 0)).toBe(true);
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.queryByRole('columnheader', { name: 'NOI' })).not.toBeInTheDocument();
  });
});

// R13b Task 12 (spec §22.6). `run.metrics.unit_sales` is `UnitSalesResult |
// null` -- `null` on any document with no per-unit ledger, present with
// every month's `deposits_received_pence` zero on the held twin (deposits
// release AT completion there, not on exchange). The column must read this
// block directly, never sum or recompute a deposits figure from the row
// data. `inputs` is unused by CashflowPage's body (only `run` is
// destructured -- see the anchoredSlippedDoc test above), and the fixture
// builders return a `CalculatorInputsV17` document, not the `V11` the prop
// is typed for, so a placeholder V11 default satisfies the prop's type
// without a cast, matching the existing pattern in this file.
describe('CashflowPage — deposits released column (R13b spec §22.6)', () => {
  it('shows a deposits-released column only when a released deposit lands, read off metrics.unit_sales', () => {
    const doc = unitSalesDoc();
    const run = runAppraisal(doc);
    render(<CashflowPage inputs={defaultCalculatorInputsV17()} onChange={vi.fn()} run={run} />);
    expect(screen.getByRole('columnheader', { name: 'Deposits released' })).toBeInTheDocument();
    // month 8's 2,600,000p -- penceToPounds rounds to whole pounds (maximumFractionDigits: 0),
    // so this is '£26,000', not '£26,000.00' (see the ruling R25 VAT-disclosure
    // assertions above, e.g. '£543', for the same whole-pound formatting).
    expect(screen.getAllByText('£26,000').length).toBeGreaterThan(0);
  });

  it('hides the column on the held twin and on the null path', () => {
    for (const doc of [heldTwinDoc(), unitSalesDoc({ unitSales: null })]) {
      const run = runAppraisal(doc);
      const { unmount } = render(<CashflowPage inputs={defaultCalculatorInputsV17()} onChange={vi.fn()} run={run} />);
      expect(screen.queryByRole('columnheader', { name: 'Deposits released' })).toBeNull();
      unmount();
    }
  });
});

// R16b spec §26.4. `schedule.uses[i].lender_eligible_construction_pence` (R14
// spec §4.2(b), MonthUses in finance-types.ts) diverges from
// `.construction_pence` only when the document carries an ineligible
// package -- the corpus-wide pin below fixes exactly which fixtures do.
describe('CashflowPage — the lender-eligible build column (spec §26.4)', () => {
  const corpus = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ f, doc: JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as { inputs?: Record<string, unknown> } }))
    .filter(({ doc }) => 'inputs' in doc);
  const runs = corpus.map(({ f, doc }) => ({ f, run: runAppraisal(migrateInputsToV17(doc.inputs!)) }));
  const ineligible = ({ schedule }: AppraisalRun) =>
    schedule.uses.some((u) => u.lender_eligible_construction_pence !== u.construction_pence);

  it('the corpus documents that carry an ineligible package are exactly these (the pin)', () => {
    // Fill from the first run; the LIST is the pin -- a later fixture that adds
    // or loses an ineligible package must edit it deliberately. Printed list
    // (R16b implementation run) differs from the brief's placeholder single
    // entry -- Q (q-detailed-cost-plan.json) is itself ineligible, so the
    // "fully-eligible" role below is played by a-all-cash.json instead.
    expect(runs.filter(({ run }) => ineligible(run)).map(({ f }) => f)).toEqual([
      'ab-elemental-benchmark.json', // R17: Z-based, externals ineligible
      'q-detailed-cost-plan.json',
      's-dated-programme.json',
      'w-monitoring-on-site.json',
      'z-cost-plan-in-time.json',
    ]);
  });

  it('uses[] and months[] are the same length on every document (alignment)', () => {
    for (const { f, run } of runs) expect(run.schedule.uses.length, f).toBe(run.model.months.length);
  });

  it('shows the column on S, with each cell reading the same-index uses entry, and the disclosure line', () => {
    const { run } = runs.find(({ f }) => f === 's-dated-programme.json')!;
    render(<CashflowPage inputs={run.inputs as CalculatorInputsV17} onChange={vi.fn()} run={run} />);
    expect(screen.getByText('Eligible build')).toBeInTheDocument();
    const i = run.schedule.uses.findIndex((u) => u.lender_eligible_construction_pence !== u.construction_pence);
    const rows = screen.getAllByRole('row');
    // header row is index 0; body rows follow in month order
    const cells = within(rows[1 + i]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[2]).toBe(penceToPounds(run.schedule.uses[i].lender_eligible_construction_pence));
    const eligibleTotal = run.schedule.uses.reduce((s, u) => s + u.lender_eligible_construction_pence, 0);
    const constructionTotal = run.schedule.uses.reduce((s, u) => s + u.construction_pence, 0);
    expect(screen.getByText(`Lender-eligible build: ${penceToPounds(eligibleTotal)} of ${penceToPounds(constructionTotal)}`, { exact: false })).toBeInTheDocument();
  });

  it('does not show the column or the line on a fully-eligible document (a-all-cash, not in the pin list above)', () => {
    const { run } = runs.find(({ f }) => f === 'a-all-cash.json')!;
    render(<CashflowPage inputs={run.inputs as CalculatorInputsV17} onChange={vi.fn()} run={run} />);
    expect(screen.queryByText('Eligible build')).not.toBeInTheDocument();
    expect(screen.queryByText(/Lender-eligible build:/)).not.toBeInTheDocument();
  });
});
