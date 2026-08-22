import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VatPage from './VatPage';
import { runAppraisal, vatBasisGate } from '../../lib/model';
import type { AppraisalRun, CalculatorInputsV8, VatTreatment } from '../../lib/model';
import { draftReason } from '../../lib/report-provenance';
import { computeSpider } from '../../lib/deal-spider';

// Same fixture directory as CashflowPage.test.tsx / AppraisalSummaryPage.test.tsx.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
// The R11 §17.4 worked cycle: quarterly returns, first_period_end_month 2,
// repayment_lag_months 1, £1,000,000 construction at 20% (see the spec's
// worked table). Registered, with both acquisition and construction
// evidenced -- used unmutated for "reads from run.metrics.vat" assertions,
// and mutated in-memory (never written back to disk) for the confirmation
// proof below.
const vatFixture = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'r-vat-quarterly.json'), 'utf-8'),
) as { inputs: CalculatorInputsV8 };

afterEach(() => {
  cleanup();
});

function baseInputs(): CalculatorInputsV8 {
  // structuredClone so mutating the result never touches the fixture on disk
  // or leaks between tests.
  return structuredClone(vatFixture.inputs);
}

describe('VatPage — registration toggle', () => {
  it('writes vat.registered and nothing else', () => {
    const inputs = baseInputs();
    inputs.vat.registered = false;
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /vat registered/i }));

    expect(onChange).toHaveBeenCalledWith({ vat: { ...inputs.vat, registered: true } });
  });
});

describe('VatPage — treatment rows write the right row and no other', () => {
  it("editing construction's rate leaves every other category's row untouched", () => {
    const inputs = baseInputs();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: /construction rate %/i }), { target: { value: '15' } });

    const written = onChange.mock.calls[0][0].vat.treatments as VatTreatment[];
    const original = inputs.vat.treatments;
    for (const row of written) {
      const before = original.find((t) => t.category === row.category)!;
      if (row.category === 'construction') {
        expect(row.rate_pct).toBe(15);
      } else {
        expect(row).toEqual(before);
      }
    }
  });

  it("writes recoverable_pct to the matching row only", () => {
    const inputs = baseInputs();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: /professional fees recoverable %/i }), { target: { value: '42' } });

    const written = onChange.mock.calls[0][0].vat.treatments as VatTreatment[];
    expect(written.find((t) => t.category === 'professional')!.recoverable_pct).toBe(42);
    expect(written.find((t) => t.category === 'construction')!.recoverable_pct).toBe(100);
  });

  it("the evidence control writes evidence_status on the matching row only (ruling R44)", () => {
    const inputs = baseInputs();
    // Force the row unconfirmed so the write is an observable move, not a no-op.
    inputs.vat.treatments = inputs.vat.treatments.map((t) => (
      t.category === 'professional' ? { ...t, evidence_status: 'unconfirmed' as const } : t
    ));
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('combobox', { name: /professional fees evidence status/i }), { target: { value: 'confirmed' } });

    const written = onChange.mock.calls[0][0].vat.treatments as VatTreatment[];
    expect(written.find((t) => t.category === 'professional')!.evidence_status).toBe('confirmed');
    expect(written.find((t) => t.category === 'construction')!.evidence_status).toBe('confirmed'); // fixture default, unchanged
    expect(written.find((t) => t.category === 'statutory')!.evidence_status).toBe('unconfirmed'); // untouched row, unchanged
  });
});

describe('VatPage — the return-cycle controls write their three fields', () => {
  it('writes return_frequency, first_period_end_month and repayment_lag_months independently', () => {
    const inputs = baseInputs();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('combobox', { name: /return frequency/i }), { target: { value: 'monthly' } });
    expect(onChange).toHaveBeenCalledWith({ vat: { ...inputs.vat, return_frequency: 'monthly' } });

    fireEvent.change(screen.getByRole('spinbutton', { name: /first period end month/i }), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ vat: { ...inputs.vat, first_period_end_month: 5 } });

    fireEvent.change(screen.getByRole('spinbutton', { name: /repayment lag months/i }), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({ vat: { ...inputs.vat, repayment_lag_months: 2 } });
  });
});

describe('VatPage — the purchase block', () => {
  it('writes vendor_opted_to_tax and togc_treatment independently, leaving the rest of the purchase block untouched', () => {
    const inputs = baseInputs();
    inputs.vat.purchase = { ...inputs.vat.purchase, vendor_opted_to_tax: false, togc_treatment: 'unconfirmed' as const };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /vendor opted to tax/i }));
    expect(onChange).toHaveBeenLastCalledWith({
      vat: { ...inputs.vat, purchase: { ...inputs.vat.purchase, vendor_opted_to_tax: true } },
    });

    fireEvent.change(screen.getByRole('combobox', { name: /^togc treatment$/i }), { target: { value: 'applies' } });
    expect(onChange).toHaveBeenLastCalledWith({
      vat: { ...inputs.vat, purchase: { ...inputs.vat.purchase, togc_treatment: 'applies' } },
    });
  });

  it("the purchase evidence control writes purchase.evidence_status (ruling R44)", () => {
    const inputs = baseInputs();
    inputs.vat.purchase = { ...inputs.vat.purchase, evidence_status: 'unconfirmed' as const };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<VatPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('combobox', { name: /purchase vat evidence status/i }), { target: { value: 'confirmed' } });
    expect(onChange).toHaveBeenCalledWith({
      vat: { ...inputs.vat, purchase: { ...inputs.vat.purchase, evidence_status: 'confirmed' } },
    });
  });
});

describe('VatPage — every displayed figure is read from run.metrics.vat, never recomputed', () => {
  it('shows peak carry, irrecoverable VAT and receivable-at-maturity exactly as the run reports them', () => {
    const inputs = baseInputs();
    const run = runAppraisal(inputs);
    // Figures chosen so nothing visible on the page could reproduce them by
    // arithmetic -- the same technique ConversionCostsPage.test.tsx uses for
    // run.metrics.cost_plan.
    const rigged: AppraisalRun = {
      ...run,
      metrics: {
        ...run.metrics,
        vat: { ...run.metrics.vat, peak_carry_pence: 123_456_78, receivable_at_maturity_pence: 987_654_32 },
        irrecoverable_vat_pence: 555_555_55,
        vat_carry_interest_pence: -222_222,
      },
    };
    render(<VatPage inputs={inputs} onChange={vi.fn()} run={rigged} />);

    expect(screen.getByText(/123,457/)).toBeInTheDocument(); // peak carry, rounded to whole pounds
    expect(screen.getByText(/987,654/)).toBeInTheDocument(); // receivable at maturity
    expect(screen.getByText(/555,556/)).toBeInTheDocument(); // irrecoverable VAT
  });

  it('displays a negative vat_carry_interest_pence with its sign, labelled as a saving, never clamped (ruling R32)', () => {
    const inputs = baseInputs();
    const run = runAppraisal(inputs);
    const rigged: AppraisalRun = {
      ...run,
      metrics: { ...run.metrics, vat_carry_interest_pence: -400_000 },
    };
    render(<VatPage inputs={inputs} onChange={vi.fn()} run={rigged} />);

    const carryLabel = screen.getByText('VAT carry interest');
    const row = carryLabel.parentElement as HTMLElement;
    expect(row.textContent).toMatch(/-£4,000/);
    expect(row.textContent).toMatch(/saving/i);
  });
});

describe('VatPage — confirming a row moves both the draft reason and the spider axis (ruling R44)', () => {
  it('moves draftReason off vat_basis_unconfirmed and raises the tax_advantage axis once the material row is confirmed', () => {
    const before = baseInputs();
    // Construction at a REDUCED (not standard) rate: material (charges
    // something) and, once evidenced, a real saving against the spider's
    // 20% standard-rated counterfactual (R43) -- a 20%-rated row would show
    // zero saving either way and prove nothing.
    before.vat.treatments = before.vat.treatments.map((t) => (
      t.category === 'construction'
        ? { ...t, rate_pct: 5, evidence_status: 'unconfirmed' as const }
        : t
    ));
    const runBefore = runAppraisal(before);

    const gateBefore = vatBasisGate(runBefore.metrics.vat);
    expect(gateBefore.vatBasisConfirmed).toBe(false);
    const reasonBefore = draftReason(runBefore.reconciliation, null, undefined, gateBefore);
    expect(reasonBefore).toBe('vat_basis_unconfirmed');

    const spiderBefore = computeSpider(before, null);
    const axisBefore = spiderBefore.axes.find((a) => a.id === 'tax_advantage')!.raw;

    // Drive the move through the page's own control, not a hand-built object --
    // this is the proof the CONTROL (not just the engine) does the job.
    const onChange = vi.fn();
    render(<VatPage inputs={before} onChange={onChange} run={runBefore} />);
    fireEvent.change(screen.getByRole('combobox', { name: /construction evidence status/i }), { target: { value: 'confirmed' } });
    const writtenTreatments = onChange.mock.calls[0][0].vat.treatments as VatTreatment[];

    const after: CalculatorInputsV8 = { ...before, vat: { ...before.vat, treatments: writtenTreatments } };
    const runAfter = runAppraisal(after);

    const gateAfter = vatBasisGate(runAfter.metrics.vat);
    expect(gateAfter.vatBasisConfirmed).toBe(true);
    const reasonAfter = draftReason(runAfter.reconciliation, null, undefined, gateAfter);
    expect(reasonAfter).not.toBe('vat_basis_unconfirmed');

    const spiderAfter = computeSpider(after, null);
    const axisAfter = spiderAfter.axes.find((a) => a.id === 'tax_advantage')!.raw;
    // Confirming unlocks a real 15-point saving (20% standard − 5% actual) on
    // £1,000,000 of construction, scored against GDV -- strictly greater,
    // never a no-op.
    expect(axisAfter).toBeGreaterThan(axisBefore);
  });
});
