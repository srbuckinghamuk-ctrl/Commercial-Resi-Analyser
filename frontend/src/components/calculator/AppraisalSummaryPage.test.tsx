import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import AppraisalSummaryPage from './AppraisalSummaryPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV11, MonitoringStatement, MonitoringStatementLine } from '../../lib/model';
import { defaultCalculatorInputsV11 } from '../../lib/conversion-defaults';
import { penceToPounds } from '../../lib/format';

// R14 fix-wave finding 3b: a hand-built literal statement, same shape
// `MonitoringStatementCard.test.tsx` builds, to prove the summary page wires
// `metrics.monitoring_statement` through to that card rather than hiding it.
function mkMonitoringLine(category: MonitoringStatementLine['category'], base: number): MonitoringStatementLine {
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

function mkMonitoringStatement(): MonitoringStatement {
  const lines = [
    mkMonitoringLine('acquisition', 1_000),
    mkMonitoringLine('construction', 2_000),
    mkMonitoringLine('professional', 3_000),
    mkMonitoringLine('statutory', 4_000),
    mkMonitoringLine('contingency', 5_000),
  ];
  return {
    reporting_month: 6,
    reporting_date: '2026-06-30',
    lines,
    totals: {
      original_budget_pence: 15_100,
      current_budget_pence: 25_100,
      certified_to_date_pence: 35_100,
      paid_to_date_pence: 45_100,
      committed_to_date_pence: 55_100,
      committed_not_certified_pence: 65_100,
      forecast_to_complete_pence: 75_100,
      estimated_final_cost_pence: 85_100,
      variance_vs_original_pence: 95_100,
      variance_vs_current_pence: 105_100,
      remaining_to_spend_pence: 115_100,
    },
    contingency_remaining_pence: 400_000,
    undrawn_net_facility_pence: 20_000_000,
    reserve_headroom_pence: 500_000,
    remaining_cash_equity_pence: 1_000_000,
    remaining_funding_pence: 21_500_000,
    forecast_finance_pence: 300_000,
    remaining_uses_pence: 19_800_000,
    surplus_pence: 1_700_000,
    shortfall_pence: 0,
    debt_drawn_variance_pence: -50_000,
    equity_injected_variance_pence: 25_000,
    cost_to_date_variance_pence: 10_000,
  };
}

// Same fixture directory the shared golden-fixtures test reads from (frontend/src/lib/model/golden-fixtures.test.ts)
// — fixture G is the Release 2b lender-valuation fixture (spec §3.2), used here as the
// "fixture-G-shaped props" the brief asks component tests to render against.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
// R8 Task 11: the golden fixtures on disk are v5 documents (they carry
// `inputs_version: 5` and the acquisition-tax block), so this now names the
// version the file actually holds rather than the v4 it used to claim.
const fixtureG = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'g-lender-valuation.json'), 'utf-8'),
) as { inputs: CalculatorInputsV11 };

// R11 spec §17.13 (ruling R45). The pinned VAT fixture itself is fully
// recoverable (total_irrecoverable_pence 0 by construction, so the §17.5
// invariant can pin against it) — not useful for proving the caveat renders.
// A deep clone with construction's recoverable_pct lowered produces a real
// irrecoverable figure without touching the fixture on disk.
const vatFixture = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'r-vat-quarterly.json'), 'utf-8'),
) as { inputs: CalculatorInputsV11 };

function inputsWithIrrecoverableVat(): CalculatorInputsV11 {
  const cloned = JSON.parse(JSON.stringify(vatFixture.inputs)) as CalculatorInputsV11;
  const construction = cloned.vat.treatments.find((t) => t.category === 'construction')!;
  construction.recoverable_pct = 50;
  return cloned;
}

describe('AppraisalSummaryPage — null lender state', () => {
  const inputs = defaultCalculatorInputsV11();
  const run = runAppraisal(inputs);

  it('renders the existing not-available treatment for lender GDV and LTGDV lender', () => {
    render(<AppraisalSummaryPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByText('n/a — no lender valuation recorded')).toBeInTheDocument();
    expect(screen.getByText('Developer: n/a · Lender: n/a')).toBeInTheDocument();
  });

  it('renders the variance bridge empty state, never a substituted number', () => {
    render(<AppraisalSummaryPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByText(/n\/a — no lender valuation recorded\. Add one on the Finance page/)).toBeInTheDocument();
  });

  it('renders n/a for senior and developer break-even when unavailable', () => {
    render(<AppraisalSummaryPage inputs={inputs} run={run} onChange={vi.fn()} />);
    // No facility and no units/disposal on the bare defaults -> every break-even is null.
    expect(run.metrics.senior_breakeven_pence).toBeNull();
    expect(run.metrics.developer_breakeven_pence).toBeNull();
    const naNodes = screen.getAllByText('n/a');
    expect(naNodes.length).toBeGreaterThan(0);
  });
});

describe('AppraisalSummaryPage — populated (fixture G)', () => {
  const run = runAppraisal(fixtureG.inputs);

  it('renders developer GDV, lender GDV and the variance bridge with real figures', () => {
    render(<AppraisalSummaryPage inputs={fixtureG.inputs} run={run} onChange={vi.fn()} />);

    expect(run.metrics.gdv_pence).toBe(120_000_000);
    expect(run.metrics.lender_gdv_pence).toBe(108_000_000);
    expect(run.metrics.lender_gdv_variance_pence).toBe(-12_000_000);

    // Developer GDV and Lender GDV both render as £1,200,000 / £1,080,000 somewhere on the page
    // (Value group card + variance bridge each show these).
    expect(screen.getAllByText('£1,200,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('£1,080,000').length).toBeGreaterThan(0);
  });

  it('renders the lender valuation provenance line (reason — author, date)', () => {
    render(<AppraisalSummaryPage inputs={fixtureG.inputs} run={run} onChange={vi.fn()} />);
    expect(
      screen.getByText('Fixture: lender haircut for valuation-basis testing — governance, 2026-08-13'),
    ).toBeInTheDocument();
  });

  it('renders senior break-even (price, % of lender GDV, % fall) and developer break-even', () => {
    render(<AppraisalSummaryPage inputs={fixtureG.inputs} run={run} onChange={vi.fn()} />);

    expect(run.metrics.senior_breakeven_pence).toBe(60_573_556);
    expect(run.metrics.senior_breakeven_pct_of_lender_gdv).toBe(56.09);
    expect(run.metrics.senior_breakeven_fall_from_lender_gdv_pct).toBe(43.91);
    expect(run.metrics.developer_breakeven_pence).toBe(96_106_551);

    expect(screen.getByText('£605,736')).toBeInTheDocument();
    expect(screen.getByText('56.09%')).toBeInTheDocument();
    expect(screen.getByText('43.91%')).toBeInTheDocument();
    expect(screen.getByText('£961,066')).toBeInTheDocument();
  });

  it('renders the cost-to-complete summary (no shortfall on this fixture)', () => {
    render(<AppraisalSummaryPage inputs={fixtureG.inputs} run={run} onChange={vi.fn()} />);
    expect(run.metrics.cost_to_complete?.first_shortfall_month).toBeNull();
    expect(run.metrics.cost_to_complete?.max_shortfall_pence).toBe(0);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('does NOT carry the VAT caveat on Net/Gross LTC when there is no irrecoverable VAT', () => {
    // fixture G carries no vat block at all -- registered is false via the
    // migrated default, so total_irrecoverable_pence is 0 and neither
    // tooltip should mention it (spec §17.13, ruling R45).
    expect(run.metrics.vat.total_irrecoverable_pence).toBe(0);
    render(<AppraisalSummaryPage inputs={fixtureG.inputs} run={run} onChange={vi.fn()} />);
    const netLtc = screen.getByText('Net LTC').closest('[title]') as HTMLElement;
    const grossLtc = screen.getByText('Gross LTC').closest('[title]') as HTMLElement;
    expect(netLtc.getAttribute('title')).not.toMatch(/irrecoverable/i);
    expect(grossLtc.getAttribute('title')).not.toMatch(/irrecoverable/i);
  });
});

describe('AppraisalSummaryPage — VAT LTC caveat (spec §17.13, ruling R34/R45)', () => {
  const inputs = inputsWithIrrecoverableVat();
  const run = runAppraisal(inputs);

  it('has a real irrecoverable figure on this document (precondition)', () => {
    expect(run.metrics.vat.total_irrecoverable_pence).toBeGreaterThan(0);
  });

  it('puts the VAT caveat, reading the irrecoverable figure from run.metrics, on BOTH the Net LTC and Gross LTC tooltips', () => {
    render(<AppraisalSummaryPage inputs={inputs} run={run} onChange={vi.fn()} />);
    const irrecoverable = penceToPounds(run.metrics.vat.total_irrecoverable_pence);

    const netLtc = screen.getByText('Net LTC').closest('[title]') as HTMLElement;
    const grossLtc = screen.getByText('Gross LTC').closest('[title]') as HTMLElement;

    expect(netLtc.getAttribute('title')).toContain(irrecoverable);
    expect(netLtc.getAttribute('title')).toMatch(/Net LTC excludes/);
    expect(grossLtc.getAttribute('title')).toContain(irrecoverable);
    expect(grossLtc.getAttribute('title')).toMatch(/Gross LTC includes/);
  });
});

describe('AppraisalSummaryPage — monitoring cost-to-complete wiring (R14 fix wave finding 3b)', () => {
  const inputs = defaultCalculatorInputsV11();
  const baseRun = runAppraisal(inputs);

  it('renders the "Monitoring cost-to-complete" heading when metrics.monitoring_statement is non-null', () => {
    const run = { ...baseRun, metrics: { ...baseRun.metrics, monitoring_statement: mkMonitoringStatement() } };
    render(<AppraisalSummaryPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByText(/Monitoring cost-to-complete/)).toBeInTheDocument();
  });

  it('does not render the "Monitoring cost-to-complete" heading when metrics.monitoring_statement is null', () => {
    const run = { ...baseRun, metrics: { ...baseRun.metrics, monitoring_statement: null } };
    render(<AppraisalSummaryPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.queryByText(/Monitoring cost-to-complete/)).not.toBeInTheDocument();
  });
});
