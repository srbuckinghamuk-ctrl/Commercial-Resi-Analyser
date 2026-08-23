import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MonitoringStatementCard from './MonitoringStatementCard';
import type { MonitoringStatement, MonitoringStatementLine } from '../../lib/model';

/** Every numeric column set to a distinct value so a column read off the wrong
 *  field cannot pass by coincidence — the same discipline `monitoring.test.ts`
 *  uses for the engine's own fixture. */
function mkLine(
  category: MonitoringStatementLine['category'],
  base: number,
): MonitoringStatementLine {
  return {
    category,
    original_budget_pence: base + 1,
    current_budget_pence: base + 2,
    certified_to_date_pence: base + 3,
    paid_to_date_pence: base + 4,
    committed_to_date_pence: base + 5,
    committed_not_certified_pence: base + 6,
    forecast_to_complete_pence: base + 7,
    estimated_final_cost_pence: base + 8,
    variance_vs_original_pence: base + 9,
    variance_vs_current_pence: base + 10,
    remaining_to_spend_pence: base + 11,
  };
}

const LINES: MonitoringStatementLine[] = [
  mkLine('acquisition', 1_000),
  mkLine('construction', 2_000),
  mkLine('professional', 3_000),
  mkLine('statutory', 4_000),
  mkLine('contingency', 5_000),
];

// Each column a whole pound apart from the next by a comfortable margin, so
// rounding to whole pounds (penceToPounds) cannot collapse two of them —
// unlike per-line figures 5p apart, these must stay individually findable.
const TOTALS: Omit<MonitoringStatementLine, 'category'> = {
  original_budget_pence: 15_100, // £151
  current_budget_pence: 25_100, // £251
  certified_to_date_pence: 35_100, // £351
  paid_to_date_pence: 45_100, // £451
  committed_to_date_pence: 55_100, // £551
  committed_not_certified_pence: 65_100, // £651
  forecast_to_complete_pence: 75_100, // £751
  estimated_final_cost_pence: 85_100, // £851
  variance_vs_original_pence: 95_100, // £951
  variance_vs_current_pence: 105_100, // £1,051
  remaining_to_spend_pence: 115_100, // £1,151
};

function mkStatement(overrides: Partial<MonitoringStatement> = {}): MonitoringStatement {
  return {
    reporting_month: 6,
    reporting_date: '2026-06-30',
    lines: LINES,
    totals: TOTALS,
    contingency_remaining_pence: 400_000,
    undrawn_net_facility_pence: 20_000_000, // £200,000
    reserve_headroom_pence: 500_000, // £5,000
    remaining_cash_equity_pence: 1_000_000, // £10,000
    remaining_funding_pence: 21_500_000, // £215,000
    forecast_finance_pence: 300_000, // £3,000
    remaining_uses_pence: 19_800_000, // £198,000
    surplus_pence: 1_700_000, // £17,000
    shortfall_pence: 0,
    debt_drawn_variance_pence: -50_000, // -£500
    equity_injected_variance_pence: 25_000, // £250
    cost_to_date_variance_pence: 10_000, // £100
    ...overrides,
  };
}

/** First cell of a table row, whether it is a `<th>` (header row) or `<td>`. */
function firstCellText(row: Element): string | null {
  return row.querySelector('th, td')?.textContent ?? null;
}

describe('MonitoringStatementCard — null state', () => {
  it('renders nothing when statement is null', () => {
    const { container } = render(<MonitoringStatementCard statement={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MonitoringStatementCard — populated', () => {
  const statement = mkStatement();

  it('renders the heading with month and reporting date', () => {
    render(<MonitoringStatementCard statement={statement} />);
    expect(
      screen.getByText('Monitoring cost-to-complete — month 6 (2026-06-30)'),
    ).toBeInTheDocument();
  });

  it('renders the five category rows in MONITORING_CATEGORIES order, then the totals row', () => {
    render(<MonitoringStatementCard statement={statement} />);
    const table = screen.getByRole('table', { name: /monitoring cost-to-complete/i });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(6); // 5 category rows + totals row
    expect(firstCellText(rows[0])).toBe('Acquisition');
    expect(firstCellText(rows[1])).toBe('Construction');
    expect(firstCellText(rows[2])).toBe('Professional');
    expect(firstCellText(rows[3])).toBe('Statutory');
    expect(firstCellText(rows[4])).toBe('Contingency');
    expect(firstCellText(rows[5])).toBe('Total');
  });

  it('prints the totals row from the totals field, not recomputed from the lines', () => {
    render(<MonitoringStatementCard statement={statement} />);
    // original_budget_pence total = 15,055p = £150.55, rounds to £151 -- distinct
    // from every per-line figure (all under £51).
    expect(screen.getByText('£151')).toBeInTheDocument();
  });

  it('renders the funding reconciliation list', () => {
    render(<MonitoringStatementCard statement={statement} />);
    expect(screen.getByText('£200,000')).toBeInTheDocument(); // undrawn net facility
    expect(screen.getByText('£5,000')).toBeInTheDocument(); // reserve headroom
    expect(screen.getByText('£10,000')).toBeInTheDocument(); // remaining cash equity
    expect(screen.getByText('£215,000')).toBeInTheDocument(); // remaining funding
    expect(screen.getByText('£3,000')).toBeInTheDocument(); // forecast finance
    expect(screen.getByText('£198,000')).toBeInTheDocument(); // remaining uses
    expect(screen.getByText('£17,000')).toBeInTheDocument(); // surplus
  });

  it('does not render a shortfall line when shortfall_pence is 0', () => {
    render(<MonitoringStatementCard statement={mkStatement({ shortfall_pence: 0 })} />);
    expect(screen.queryByText(/shortfall/i)).not.toBeInTheDocument();
  });

  it('renders a red shortfall line only when shortfall_pence > 0', () => {
    render(<MonitoringStatementCard statement={mkStatement({ shortfall_pence: 750_000, surplus_pence: -750_000 })} />);
    expect(screen.getByText(/shortfall/i)).toBeInTheDocument();
    expect(screen.getByText('£7,500')).toBeInTheDocument();
  });

  it('renders the three variances with the inception-plan legend, sign taken from the field', () => {
    render(<MonitoringStatementCard statement={statement} />);
    expect(screen.getByText(/positive = more than the inception plan/i)).toBeInTheDocument();
    // debt_drawn_variance_pence is negative -- penceToPounds must show it as negative,
    // never re-signed by the component.
    expect(screen.getByText('-£500')).toBeInTheDocument();
    expect(screen.getByText('£250')).toBeInTheDocument();
    expect(screen.getByText('£100')).toBeInTheDocument();
  });
});
