import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import CashflowPage from './CashflowPage';
import { runAppraisal } from '../../lib/model';
import type { AppraisalRun, CalculatorInputsV10 } from '../../lib/model';
import { defaultCalculatorInputsV10 } from '../../lib/conversion-defaults';
import { formatProgrammeMonth, programmeAnchor } from '../../lib/programme-months';
import { anchoredSlippedDoc } from '../../lib/model/__fixtures__/investment-case-docs';

// Same fixture directory as AppraisalSummaryPage.test.tsx / export-investment-memo.test.ts.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
// v5 on disk (R8) -- see the same note in AppraisalSummaryPage.test.tsx.
const fixtureH = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'h-programme-scurve.json'), 'utf-8'),
) as { inputs: CalculatorInputsV10 };
// v5 on disk (R8) -- see the same note in AppraisalSummaryPage.test.tsx.
const fixtureJ = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
) as { inputs: CalculatorInputsV10 };
// v8 on disk, registered for VAT -- the R11 §17.4 worked cycle.
const fixtureVat = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'r-vat-quarterly.json'), 'utf-8'),
) as { inputs: CalculatorInputsV10 };
// v9 on disk -- a dated phase NETWORK, not the legacy three-package shape.
const fixtureNetwork = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 's-dated-programme.json'), 'utf-8'),
) as { inputs: CalculatorInputsV10 };

describe('CashflowPage — no programme, no sales phasing (default v4)', () => {
  const inputs = defaultCalculatorInputsV10();
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
    const inputs = defaultCalculatorInputsV10();
    const run = runAppraisal(inputs);
    render(<CashflowPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByRole('columnheader', { name: 'Costs (VAT-incl.)' })).toBeInTheDocument();
  });

  it('does not show a VAT disclosure line on a document with no VAT charged', () => {
    const inputs = defaultCalculatorInputsV10();
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
    render(<CashflowPage inputs={defaultCalculatorInputsV10()} onChange={vi.fn()} run={run} />);

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
