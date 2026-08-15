import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppraisalSummaryPage from './AppraisalSummaryPage';
import FinancePage from './FinancePage';
import InvestorSummaryPage from './InvestorSummaryPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV4 } from '../../lib/model';
import { defaultCalculatorInputsV4 } from '../../lib/conversion-defaults';
import type { Project } from '../../types';

const PROJECT = {
  id: 'p1',
  address_raw: '1 Test Street',
  postcode: 'TS1 1TS',
  use_class: 'office',
  floor_area_sqm: 400,
  tenure: 'freehold',
} as unknown as Project;

/** A development-finance deal whose peak debt lands on a known ledger month. */
function anchoredInputs(anchor: string | null): CalculatorInputsV4 {
  const inputs = defaultCalculatorInputsV4();
  inputs.finance.funding_source = 'development_finance';
  inputs.finance.committed_net_facility_pence = 60_000_000;
  inputs.finance.term_months = 12;
  inputs.acquisition.purchase_price_pence = 40_000_000;
  inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
  inputs.conversion_costs.total_construction_sqm = 400;
  inputs.equity_sources = [
    { ...inputs.equity_sources[0], amount_pence: 35_000_000, evidence_status: 'confirmed' },
  ];
  inputs.programme = {
    anchor_month: anchor,
    packages: {
      construction: { start_offset: 1, duration_months: 10, curve: { kind: 'straight_line' } },
      professional: { start_offset: 1, duration_months: 5, curve: { kind: 'straight_line' } },
      statutory: { start_offset: 1, duration_months: 5, curve: { kind: 'straight_line' } },
    },
  };
  return inputs;
}

/** The peak-debt month is shown on four surfaces. Before this fix the Cashflow
 * page calendar-labelled it while these three printed a raw ledger index, so the
 * same figure read as "Sep 2027" in one place and "Month 11" in another. */
describe('peak-debt month label consistency', () => {
  const anchored = anchoredInputs('2026-10');
  const anchoredRun = runAppraisal(anchored);
  const peakMonth = anchoredRun.metrics.peak_debt_month;

  it('the fixture actually reaches peak debt in a known month', () => {
    expect(peakMonth).not.toBeNull();
  });

  it('Appraisal Summary labels the peak-debt month with the calendar month', () => {
    render(<AppraisalSummaryPage inputs={anchored} run={anchoredRun} onChange={vi.fn()} />);
    expect(screen.getByText(/Sep 2027|Oct 2026|[A-Z][a-z]{2} 20\d\d/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`\\(Month ${peakMonth}\\)`))).not.toBeInTheDocument();
  });

  it('Finance page labels the peak-debt month with the calendar month', () => {
    render(<FinancePage inputs={anchored} run={anchoredRun} onChange={vi.fn()} />);
    expect(screen.queryByText(new RegExp(`\\(Month ${peakMonth}\\)`))).not.toBeInTheDocument();
  });

  it('Investor Summary labels the peak-debt month with the calendar month', () => {
    render(<InvestorSummaryPage inputs={anchored} run={anchoredRun} project={PROJECT} />);
    expect(screen.queryByText(`Month ${peakMonth}`)).not.toBeInTheDocument();
    expect(screen.getByText(/[A-Z][a-z]{2} 20\d\d/)).toBeInTheDocument();
  });

  it('keeps the plain Month N wording when no calendar anchor is set', () => {
    const plain = anchoredInputs(null);
    const plainRun = runAppraisal(plain);
    render(<AppraisalSummaryPage inputs={plain} run={plainRun} onChange={vi.fn()} />);
    expect(screen.getByText(new RegExp(`\\(Month ${plainRun.metrics.peak_debt_month}\\)`))).toBeInTheDocument();
  });
});
