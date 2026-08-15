import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CostToCompleteCard from './CostToCompleteCard';
import type { CostToCompleteSummary } from '../../lib/model';

const SUMMARY_NO_SHORTFALL: CostToCompleteSummary = {
  first_shortfall_month: null,
  max_shortfall_pence: 0,
  months: [
    { month: 0, remaining_cost_pence: 10_000_000, remaining_funding_pence: 12_000_000, surplus_pence: 2_000_000 },
    { month: 1, remaining_cost_pence: 5_000_000, remaining_funding_pence: 6_000_000, surplus_pence: 1_000_000 },
  ],
};

const SUMMARY_WITH_SHORTFALL: CostToCompleteSummary = {
  first_shortfall_month: 3,
  max_shortfall_pence: 1_500_000,
  months: [
    { month: 0, remaining_cost_pence: 10_000_000, remaining_funding_pence: 12_000_000, surplus_pence: 2_000_000 },
    { month: 3, remaining_cost_pence: 8_000_000, remaining_funding_pence: 6_500_000, surplus_pence: -1_500_000 },
  ],
};

describe('CostToCompleteCard — null state', () => {
  it('renders the existing "n/a" not-available treatment when summary is null', () => {
    render(<CostToCompleteCard summary={null} />);
    expect(screen.getByText('Cost to complete')).toBeInTheDocument();
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(screen.queryByText(/show months/i)).not.toBeInTheDocument();
  });
});

describe('CostToCompleteCard — populated', () => {
  it('shows "None" for first shortfall month and zero max shortfall when never short', () => {
    render(<CostToCompleteCard summary={SUMMARY_NO_SHORTFALL} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('shows the first shortfall month (1-indexed for display) and max shortfall amount', () => {
    render(<CostToCompleteCard summary={SUMMARY_WITH_SHORTFALL} />);
    expect(screen.getByText('Month 3')).toBeInTheDocument();
    expect(screen.getByText('£15,000')).toBeInTheDocument();
  });

  it('the month table is collapsed by default and expands on click, with its own scroll container', () => {
    render(<CostToCompleteCard summary={SUMMARY_WITH_SHORTFALL} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show months/i }));
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    // The month table's own overflow-x scroll wrapper (brief: "expandable month table
    // with its own overflow scrolling") is the table's immediate parent.
    const scrollWrapper = table.parentElement as HTMLElement;
    expect(scrollWrapper.style.overflowX).toBe('auto');

    fireEvent.click(screen.getByRole('button', { name: /hide months/i }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
