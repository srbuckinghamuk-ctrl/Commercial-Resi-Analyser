import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import CashflowPage from './CashflowPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV4 } from '../../lib/model';
import { defaultCalculatorInputsV4 } from '../../lib/conversion-defaults';

// Same fixture directory as AppraisalSummaryPage.test.tsx / export-investment-memo.test.ts.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtureH = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'h-programme-scurve.json'), 'utf-8'),
) as { inputs: CalculatorInputsV4 };
const fixtureJ = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'j-blended-refinance.json'), 'utf-8'),
) as { inputs: CalculatorInputsV4 };

describe('CashflowPage — no programme, no sales phasing (default v4)', () => {
  const inputs = defaultCalculatorInputsV4();
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
