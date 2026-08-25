import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import FinancePage from './FinancePage';
import { runAppraisal, MONITORING_CATEGORIES } from '../../lib/model';
import type { CalculatorInputsV12, MonitoringInputs } from '../../lib/model';
import { defaultCalculatorInputsV12 } from '../../lib/conversion-defaults';

/** Matches `MonitoringEditor`'s own `emptyMonitoring()` shape, so the only
 *  input-validation issue this block can raise is the one under test. */
function mkMonitoring(overrides: Partial<MonitoringInputs> = {}): MonitoringInputs {
  return {
    reporting_month: 1,
    reporting_date: '',
    lines: MONITORING_CATEGORIES.map((category) => ({
      category,
      current_budget_pence: 0,
      certified_to_date_pence: 0,
      paid_to_date_pence: 0,
      committed_to_date_pence: 0,
      forecast_to_complete_pence: 0,
    })),
    debt_drawn_to_date_pence: 0,
    cash_equity_injected_to_date_pence: 0,
    author: '',
    date: '',
    note: null,
    ...overrides,
  };
}

function setup(inputs: CalculatorInputsV12, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(<FinancePage inputs={inputs} onChange={onChange} run={run} />);
  return { onChange, run };
}

describe('FinancePage — lender valuation entry card wiring', () => {
  it('shows the "no lender valuation recorded" empty state when the block is absent', () => {
    const inputs: CalculatorInputsV12 = { ...defaultCalculatorInputsV12(), lender_valuation: null };
    setup(inputs);
    expect(screen.getByText(/no lender valuation recorded/i)).toBeInTheDocument();
  });

  it('adding a lender valuation from the card calls the page onChange with lender_valuation set', () => {
    const inputs: CalculatorInputsV12 = { ...defaultCalculatorInputsV12(), lender_valuation: null };
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /add lender valuation/i }));
    expect(onChange).toHaveBeenCalledWith({
      lender_valuation: {
        basis: 'global_pct', global_value: null, per_key_values: null, reason: '', author: '', date: '',
      },
    });
  });

  it('surfaces lender_valuation validation errors from the live run on the entry card', () => {
    const inputs: CalculatorInputsV12 = {
      ...defaultCalculatorInputsV12(),
      lender_valuation: {
        basis: 'global_pct', global_value: null, per_key_values: null, reason: '', author: '', date: '',
      },
    };
    setup(inputs);
    // Both the reconciliation strip (all validation issues) and the lender valuation card
    // (scoped to lender_valuation.*) surface these — assert at least one instance of each.
    expect(screen.getAllByText('Lender valuation reason is required.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lender valuation author is required.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lender valuation date is required.').length).toBeGreaterThan(0);
  });

  it('renders the enforcement cost assumption field with its current value', () => {
    const inputs: CalculatorInputsV12 = {
      ...defaultCalculatorInputsV12(),
      finance: { ...defaultCalculatorInputsV12().finance, funding_source: 'development_finance', enforcement_cost_assumption_pence: 50_000 },
    };
    setup(inputs);
    expect(screen.getByText('Enforcement cost assumption (£)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
  });
});

describe('FinancePage — MonitoringEditor mount wiring (R14 fix wave finding 3a)', () => {
  // term_months defaults to 12 (see defaultCalculatorInputsV12's finance block),
  // so reporting_month 13 is out of range and raises exactly one monitoring
  // issue (`monitoring.reporting_month`). lender_valuation with a blank author
  // (reason and date filled, global_value populated so the "requires a
  // global_value" case doesn't also fire) raises exactly one unrelated issue
  // (`lender_valuation.author`) — the same validator FinancePage's own
  // "surfaces lender_valuation validation errors" test above exercises.
  function inputsWithBothIssues(): CalculatorInputsV12 {
    return {
      ...defaultCalculatorInputsV12(),
      monitoring: mkMonitoring({ reporting_month: 13 }),
      lender_valuation: {
        basis: 'fixed_amount', global_value: 100_000_000, per_key_values: null,
        reason: 'Valuation basis', author: '', date: '2026-01-01',
      },
    };
  }

  it('renders the monitoring issue inside MonitoringEditor, and does not leak the unrelated lender_valuation issue into it', () => {
    const inputs = inputsWithBothIssues();
    setup(inputs);

    // Precondition: both issues are actually on the run (otherwise this test
    // would pass for the wrong reason).
    const run = runAppraisal(inputs);
    expect(run.validation.some((i) => i.field === 'monitoring.reporting_month')).toBe(true);
    expect(run.validation.some((i) => i.field === 'lender_valuation.author')).toBe(true);

    // NumRow/label pairs in this codebase are not `htmlFor`-associated, so scope
    // by walking up from the panel's title span to its outer container (the
    // title span's own parent is the header row div; that row's parent is the
    // editor's outer panel div) rather than by accessible name.
    // "Monitoring statement" text also names FinancePage's own section <h4>, so
    // anchor on the "Remove monitoring statement" button instead — unique to the
    // populated MonitoringEditor's header row. That row's parent is the editor's
    // outer panel div.
    const monitoringPanel = screen.getByRole('button', { name: /remove monitoring statement/i })
      .closest('div')!.parentElement as HTMLElement;
    expect(within(monitoringPanel).getByText(/reporting_month must be between 1 and the term/)).toBeInTheDocument();
    expect(within(monitoringPanel).queryByText('Lender valuation author is required.')).not.toBeInTheDocument();

    // The unrelated issue is still surfaced somewhere on the page (the
    // reconciliation strip / lender valuation card) — just not inside the
    // monitoring editor.
    expect(screen.getAllByText('Lender valuation author is required.').length).toBeGreaterThan(0);
  });

  it('editing through the mounted MonitoringEditor calls the page onChange with a monitoring partial', () => {
    const inputs = inputsWithBothIssues();
    const { onChange } = setup(inputs);

    // "Monitoring statement" text also names FinancePage's own section <h4>, so
    // anchor on the "Remove monitoring statement" button instead — unique to the
    // populated MonitoringEditor's header row. That row's parent is the editor's
    // outer panel div.
    const monitoringPanel = screen.getByRole('button', { name: /remove monitoring statement/i })
      .closest('div')!.parentElement as HTMLElement;
    // The reporting-month NumRow is the only "13"-valued input in the panel
    // (every other field on the empty-shaped fixture is 0 or blank text).
    const reportingMonthInput = within(monitoringPanel).getByDisplayValue('13');
    fireEvent.change(reportingMonthInput, { target: { value: '5' } });

    expect(onChange).toHaveBeenCalledWith({
      monitoring: { ...inputs.monitoring, reporting_month: 5 },
    });
  });
});
