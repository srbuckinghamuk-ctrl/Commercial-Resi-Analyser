import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import MonitoringEditor from './MonitoringEditor';
import type { MonitoringInputs, ValidationIssue } from '../../lib/model';
import { MONITORING_CATEGORIES } from '../../lib/model';

// A fully populated statement with distinct values on every field, so an edit
// to one field can be asserted against "nothing else changed".
const FIXTURE_MONITORING: MonitoringInputs = {
  reporting_month: 6,
  reporting_date: '2026-06-30',
  lines: [
    { category: 'acquisition', current_budget_pence: 1_000_00, certified_to_date_pence: 1_000_00, paid_to_date_pence: 1_000_00, committed_to_date_pence: 1_000_00, forecast_to_complete_pence: 0 },
    { category: 'construction', current_budget_pence: 5_000_00, certified_to_date_pence: 2_000_00, paid_to_date_pence: 1_800_00, committed_to_date_pence: 3_500_00, forecast_to_complete_pence: 3_000_00 },
    { category: 'professional', current_budget_pence: 400_00, certified_to_date_pence: 200_00, paid_to_date_pence: 180_00, committed_to_date_pence: 250_00, forecast_to_complete_pence: 200_00 },
    { category: 'statutory', current_budget_pence: 100_00, certified_to_date_pence: 50_00, paid_to_date_pence: 50_00, committed_to_date_pence: 60_00, forecast_to_complete_pence: 50_00 },
    { category: 'contingency', current_budget_pence: 300_00, certified_to_date_pence: 0, paid_to_date_pence: 0, committed_to_date_pence: 0, forecast_to_complete_pence: 300_00 },
  ],
  debt_drawn_to_date_pence: 4_000_00,
  cash_equity_injected_to_date_pence: 1_500_00,
  author: 'J. Smith, QS Surveyors',
  date: '2026-07-01',
  note: 'On programme.',
};

describe('MonitoringEditor — null state', () => {
  it('renders a single "Add monitoring statement" button and no fields', () => {
    render(<MonitoringEditor monitoring={null} termMonths={24} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add monitoring statement/i })).toBeInTheDocument();
    expect(screen.queryByText(/reporting month/i)).not.toBeInTheDocument();
  });

  it('clicking the add button calls onChange with a fresh block, five lines in category order, both cumulative figures zero', () => {
    const onChange = vi.fn();
    render(<MonitoringEditor monitoring={null} termMonths={24} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add monitoring statement/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const created = onChange.mock.calls[0][0] as MonitoringInputs;
    expect(created.reporting_month).toBe(1);
    expect(created.reporting_date).toBe('');
    expect(created.lines.map((l) => l.category)).toEqual(MONITORING_CATEGORIES);
    expect(created.lines.every((l) =>
      l.current_budget_pence === 0 && l.certified_to_date_pence === 0 && l.paid_to_date_pence === 0
      && l.committed_to_date_pence === 0 && l.forecast_to_complete_pence === 0)).toBe(true);
    expect(created.debt_drawn_to_date_pence).toBe(0);
    expect(created.cash_equity_injected_to_date_pence).toBe(0);
    expect(created.author).toBe('');
    expect(created.date).toBe('');
    expect(created.note).toBeNull();
  });
});

describe('MonitoringEditor — populated (fixture-shaped)', () => {
  it('renders reporting month, reporting date and provenance with their current values', () => {
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={24} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('6')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-06-30')).toBeInTheDocument();
    expect(screen.getByDisplayValue('J. Smith, QS Surveyors')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('On programme.')).toBeInTheDocument();
  });

  it('constrains the reporting month input to 1..termMonths', () => {
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={18} issues={[]} onChange={vi.fn()} />);
    const input = screen.getByDisplayValue('6') as HTMLInputElement;
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '18');
  });

  it('editing the construction row\'s certified-to-date input calls onChange with that pence value and nothing else changed', () => {
    const onChange = vi.fn();
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={24} issues={[]} onChange={onChange} />);

    const constructionRow = screen.getByTestId('monitoring-line-construction');
    const certifiedInput = within(constructionRow).getByLabelText(/construction certified to date/i);
    fireEvent.change(certifiedInput, { target: { value: '25000' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...FIXTURE_MONITORING,
      lines: FIXTURE_MONITORING.lines.map((l) =>
        (l.category === 'construction' ? { ...l, certified_to_date_pence: 25_000_00 } : l)),
    });
  });

  it('editing the debt-drawn-to-date field calls onChange with only that field changed', () => {
    const onChange = vi.fn();
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={24} issues={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/debt drawn to date/i), { target: { value: '45000' } });
    expect(onChange).toHaveBeenCalledWith({ ...FIXTURE_MONITORING, debt_drawn_to_date_pence: 45_000_00 });
  });

  it('removing the monitoring statement calls onChange(null)', () => {
    const onChange = vi.fn();
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={24} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove monitoring statement/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders an issue for monitoring.lines[1].paid_to_date_pence beside the construction row', () => {
    const issues: ValidationIssue[] = [
      { severity: 'error', field: 'monitoring.lines[1].paid_to_date_pence', message: 'Paid-to-date cannot exceed certified-to-date.' },
    ];
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={24} issues={issues} onChange={vi.fn()} />);
    const constructionRow = screen.getByTestId('monitoring-line-construction');
    expect(within(constructionRow).getByText('Paid-to-date cannot exceed certified-to-date.')).toBeInTheDocument();

    // The same message must not also land beside an unrelated row.
    const acquisitionRow = screen.getByTestId('monitoring-line-acquisition');
    expect(within(acquisitionRow).queryByText('Paid-to-date cannot exceed certified-to-date.')).not.toBeInTheDocument();
  });

  it('renders a reporting_month issue beside the reporting month field', () => {
    const issues: ValidationIssue[] = [
      { severity: 'error', field: 'monitoring.reporting_month', message: 'Reporting month must be within the facility term.' },
    ];
    render(<MonitoringEditor monitoring={FIXTURE_MONITORING} termMonths={24} issues={issues} onChange={vi.fn()} />);
    expect(screen.getByText('Reporting month must be within the facility term.')).toBeInTheDocument();
  });
});
