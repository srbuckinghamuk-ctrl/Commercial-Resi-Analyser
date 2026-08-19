import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import AppraisalSummaryPage from './AppraisalSummaryPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV7 } from '../../lib/model';
import { defaultCalculatorInputsV7 } from '../../lib/conversion-defaults';

// Same fixture directory the shared golden-fixtures test reads from (frontend/src/lib/model/golden-fixtures.test.ts)
// — fixture G is the Release 2b lender-valuation fixture (spec §3.2), used here as the
// "fixture-G-shaped props" the brief asks component tests to render against.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
// R8 Task 11: the golden fixtures on disk are v5 documents (they carry
// `inputs_version: 5` and the acquisition-tax block), so this now names the
// version the file actually holds rather than the v4 it used to claim.
const fixtureG = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'g-lender-valuation.json'), 'utf-8'),
) as { inputs: CalculatorInputsV7 };

describe('AppraisalSummaryPage — null lender state', () => {
  const inputs = defaultCalculatorInputsV7();
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
});
