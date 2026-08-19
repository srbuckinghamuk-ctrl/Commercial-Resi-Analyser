import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AcquisitionPage from './AcquisitionPage';
import { runAppraisal, migrateV6toV7 } from '../../lib/model';
import type { CalculatorInputsV7 } from '../../lib/model';
import {
  welshInputs as welshInputsV6, scottishInputs as scottishInputsV6,
  unconfirmedJurisdictionInputs as unconfirmedJurisdictionInputsV6,
} from '../../lib/report-qa/memo-fixtures';

// R10 Task 12. memo-fixtures.ts is shared with export-investment-memo.test.ts
// and accessor-guard.test.ts and still returns CalculatorInputsV6 (out of
// scope for this task's V6->V7 prop rename). AcquisitionPage is now typed on
// CalculatorInputsV7, so every fixture is migrated once, here, rather than
// widening the shared fixture file for one caller.
function welshInputs(): CalculatorInputsV7 { return migrateV6toV7(welshInputsV6()); }
function scottishInputs(): CalculatorInputsV7 { return migrateV6toV7(scottishInputsV6()); }
function unconfirmedJurisdictionInputs(): CalculatorInputsV7 {
  return migrateV6toV7(unconfirmedJurisdictionInputsV6());
}

/**
 * R8 Task 11. The page had two defects this suite exists to pin:
 *
 *  A. it computed its own England/NI SDLT figure and printed it above a
 *     jurisdiction-aware "Total Acquisition Cost", so a Welsh document showed
 *     two different taxes on one screen;
 *  B. there was no way to set the jurisdiction, the acquisition date or an
 *     override at all.
 *
 * The exact-figure assertions below are the teeth: £425,000 of consideration is
 * £9,000 of Welsh LTT, £9,750 of Scottish LBTT and £10,750 of England/NI SDLT,
 * so a page that quietly applied the wrong band set — or reverted to a
 * hard-wired one — cannot pass by rendering "a tax".
 */

const PROJECT = { address_postcode: 'YO1 8AN' };

/** welshInputs()/scottishInputs() with the jurisdiction proposed, not evidenced. */
function derivedUnconfirmed(base: CalculatorInputsV7): CalculatorInputsV7 {
  return {
    ...base,
    acquisition: {
      ...base.acquisition,
      jurisdiction_source: 'derived',
      jurisdiction_evidence_status: 'unconfirmed',
    },
  };
}

function setup(inputs: CalculatorInputsV7, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(<AcquisitionPage inputs={inputs} onChange={onChange} run={run} project={PROJECT} />);
  return { onChange, run };
}

describe('AcquisitionPage — the applied regime and its figures (R8 defect A)', () => {
  it('labels the band panel for the regime actually applied, not "SDLT"', () => {
    setup(welshInputs());
    expect(screen.getByRole('heading', { name: 'LTT Breakdown' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /SDLT Breakdown/ })).not.toBeInTheDocument();
  });

  it('charges the Welsh band set exactly: £425,000 of consideration is £9,000 of LTT', () => {
    const { run } = setup(welshInputs());
    // 0% to £225,000; 1% on £225,000-£250,000 = £250; 5% on £250,000-£425,000 = £8,750.
    expect(run.metrics.acquisition_tax.total_pence).toBe(900_000);
    expect(run.metrics.acquisition_tax.regime).toBe('LTT');
    expect(screen.getByText('£9,000 (2.1%)')).toBeInTheDocument();
    // The England/NI figure for the same consideration. Its absence is what
    // proves the page is not still computing on a hard-wired band set.
    expect(screen.queryByText(/£10,750/)).not.toBeInTheDocument();
  });

  it('charges the Scottish band set exactly: the same consideration is £9,750 of LBTT', () => {
    const { run } = setup(scottishInputs());
    // 0% to £150,000; 1% on £150,000-£250,000 = £1,000; 5% on £175,000 = £8,750.
    expect(run.metrics.acquisition_tax.total_pence).toBe(975_000);
    expect(screen.getByRole('heading', { name: 'LBTT Breakdown' })).toBeInTheDocument();
    expect(screen.getByText('£9,750 (2.3%)')).toBeInTheDocument();
  });

  it('charges the England/NI band set exactly: the same consideration is £10,750 of SDLT', () => {
    const { run } = setup(unconfirmedJurisdictionInputs());
    expect(run.metrics.acquisition_tax.total_pence).toBe(1_075_000);
    expect(screen.getByRole('heading', { name: 'SDLT Breakdown' })).toBeInTheDocument();
    expect(screen.getByText('£10,750 (2.5%)')).toBeInTheDocument();
  });

  it('the tax on screen is the tax inside Total Acquisition Cost, not a second calculation', () => {
    const { run } = setup(welshInputs());
    const acq = welshInputs().acquisition;
    const exTax = acq.purchase_price_pence + acq.legal_fees_pence + acq.survey_cost_pence
      + Math.round((acq.purchase_price_pence * acq.broker_fee_pct) / 100)
      + acq.other_acquisition_costs_pence;
    // The panel's total and the cost card's total are the same 900,000 pence.
    expect(run.metrics.acquisition_cost_pence - exTax).toBe(900_000);
    expect(run.metrics.acquisition_cost_pence).toBe(44_612_500);
    expect(screen.getByText('Total Acquisition Cost')).toBeInTheDocument();
    expect(screen.getByText('£446,125')).toBeInTheDocument();
  });

  it('names the band set effective date and links its source', () => {
    setup(welshInputs());
    expect(screen.getByText(/bands effective from 2020-12-22/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Source' });
    expect(link).toHaveAttribute('href', 'https://www.gov.wales/land-transaction-tax-rates-and-bands');
  });
});

describe('AcquisitionPage — the jurisdiction control (R8 defect B)', () => {
  it('shows a derived jurisdiction as unconfirmed, names the postcode, and offers Confirm', () => {
    setup(derivedUnconfirmed(welshInputs()));
    const banner = screen.getByText(/unconfirmed/i, { selector: 'span' });
    expect(banner).toHaveTextContent('Derived from postcode YO1 8AN — Wales');
    expect(screen.getByRole('button', { name: /confirm jurisdiction/i })).toBeInTheDocument();
  });

  it('marks the jurisdiction confirmed and user-sourced on Confirm', () => {
    const { onChange } = setup(derivedUnconfirmed(welshInputs()));
    fireEvent.click(screen.getByRole('button', { name: /confirm jurisdiction/i }));
    expect(onChange).toHaveBeenCalledWith({
      acquisition: expect.objectContaining({
        jurisdiction: 'wales',
        jurisdiction_source: 'user',
        jurisdiction_evidence_status: 'confirmed',
      }),
    });
  });

  it('a confirmed jurisdiction is not flagged and offers no Confirm action', () => {
    setup(welshInputs());
    expect(screen.queryByRole('button', { name: /confirm jurisdiction/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/unconfirmed/i, { selector: 'span' })).not.toBeInTheDocument();
  });

  it('choosing a jurisdiction records the user as its source but does NOT confirm it', () => {
    const { onChange } = setup(derivedUnconfirmed(welshInputs()));
    fireEvent.change(screen.getByLabelText('Tax jurisdiction'), { target: { value: 'scotland' } });
    expect(onChange).toHaveBeenCalledWith({
      acquisition: expect.objectContaining({
        jurisdiction: 'scotland',
        jurisdiction_source: 'user',
        jurisdiction_evidence_status: 'unconfirmed',
      }),
    });
  });

  // Fix round 1: the 'migrated_default' source line had no assertion at all --
  // the reviewer corrupted the string to garbage and all 125 calculator tests
  // still passed. It is the line every brand-new document renders, because
  // defaultCalculatorInputsV7 deliberately records no jurisdiction of its own.
  it('says a defaulted jurisdiction was never recorded, and flags it unconfirmed', () => {
    const base = welshInputs();
    const migrated: CalculatorInputsV7 = {
      ...base,
      acquisition: {
        ...base.acquisition,
        jurisdiction: 'england_ni',
        jurisdiction_source: 'migrated_default',
        jurisdiction_evidence_status: 'unconfirmed',
      },
    };
    setup(migrated);
    expect(screen.getByText(/unconfirmed/i, { selector: 'span' }))
      .toHaveTextContent('No jurisdiction recorded — defaulted to England & Northern Ireland');
    expect(screen.getByRole('button', { name: /confirm jurisdiction/i })).toBeInTheDocument();
  });

  // Fix round 1: taxBasisConfirmedFor (report-provenance.ts) needs BOTH a
  // confirmed jurisdiction AND date_basis === 'transaction_date', so a flat
  // green "confirmed" on a dateless document contradicted the memo's own
  // DRAFT - TAX BASIS UNCONFIRMED watermark.
  it('does not claim a confirmed basis when the acquisition date is still outstanding', () => {
    const base = welshInputs();
    const noDate: CalculatorInputsV7 = {
      ...base, acquisition: { ...base.acquisition, acquisition_date: null },
    };
    setup(noDate);
    expect(screen.getByText(/jurisdiction confirmed, but no usable acquisition date is recorded/))
      .toBeInTheDocument();
    expect(screen.getByText(/the report stays a draft until a date is given/)).toBeInTheDocument();
  });

  it('claims a confirmed basis only when the date evidences the band set too', () => {
    setup(welshInputs());
    expect(screen.getByText(/— confirmed\. Acquisition tax is charged as LTT\./)).toBeInTheDocument();
    expect(screen.queryByText(/no usable acquisition date is recorded/)).not.toBeInTheDocument();
  });

  it('offers all three jurisdictions', () => {
    setup(welshInputs());
    const select = screen.getByLabelText('Tax jurisdiction') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['england_ni', 'scotland', 'wales']);
    expect(select.value).toBe('wales');
  });
});

describe('AcquisitionPage — the acquisition date', () => {
  it('shows the document date on a date input', () => {
    setup(welshInputs());
    const input = screen.getByLabelText('Acquisition date') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-02-10');
  });

  it('changing it posts the ISO date back', () => {
    const { onChange } = setup(welshInputs());
    fireEvent.change(screen.getByLabelText('Acquisition date'), { target: { value: '2019-06-01' } });
    expect(onChange).toHaveBeenCalledWith({
      acquisition: expect.objectContaining({ acquisition_date: '2019-06-01' }),
    });
  });

  it('clearing it records unknown as null, never as a substituted date', () => {
    const { onChange } = setup(welshInputs());
    fireEvent.change(screen.getByLabelText('Acquisition date'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      acquisition: expect.objectContaining({ acquisition_date: null }),
    });
  });

  it('says so when no usable date was recorded and the current band set is assumed', () => {
    const base = welshInputs();
    const noDate: CalculatorInputsV7 = {
      ...base, acquisition: { ...base.acquisition, acquisition_date: null },
    };
    const { run } = setup(noDate);
    expect(run.metrics.acquisition_tax.date_basis).toBe('assumed_current');
    expect(screen.getByText(/no usable acquisition date recorded/)).toBeInTheDocument();
  });

  it('surfaces the engine\'s own error for a date no band set covers', () => {
    const base = welshInputs();
    const tooEarly: CalculatorInputsV7 = {
      ...base, acquisition: { ...base.acquisition, acquisition_date: '2015-01-01' },
    };
    setup(tooEarly);
    expect(screen.getByText(/No LTT band set covers 2015-01-01/)).toBeInTheDocument();
  });
});

describe('AcquisitionPage — the tax override', () => {
  function overridden(pence: number | null, reason: string): CalculatorInputsV7 {
    const base = welshInputs();
    return {
      ...base,
      acquisition: {
        ...base.acquisition,
        acquisition_tax_override_pence: pence,
        acquisition_tax_override_reason: reason,
      },
    };
  }

  it('is collapsed by default when no override is recorded', () => {
    setup(welshInputs());
    expect(screen.queryByLabelText('Override reason')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Override LTT/ })).toBeInTheDocument();
  });

  it('opens on demand', () => {
    setup(welshInputs());
    fireEvent.click(screen.getByRole('button', { name: /Override LTT/ }));
    expect(screen.getByLabelText('Override reason')).toBeInTheDocument();
    expect(screen.getByLabelText('Override LTT (£)')).toBeInTheDocument();
  });

  it('opens already expanded when the document carries an override', () => {
    setup(overridden(50_000, 'Multiple dwellings relief'));
    expect(screen.getByLabelText('Override reason')).toBeInTheDocument();
    expect((screen.getByLabelText('Override LTT (£)') as HTMLInputElement).value).toBe('500');
  });

  it('applies the override to the charged total and still shows what it replaced', () => {
    const { run } = setup(overridden(50_000, 'Multiple dwellings relief'));
    expect(run.metrics.acquisition_tax.total_pence).toBe(50_000);
    expect(screen.getByText(/the band calculation of £9,000 was replaced/)).toBeInTheDocument();
    expect(screen.getByText(/Multiple dwellings relief/)).toBeInTheDocument();
  });

  it('shows the engine\'s validation error inline when the reason is blank', () => {
    setup(overridden(50_000, ''));
    expect(
      screen.getByText(/An acquisition tax override must state why the band calculation does not apply/),
    ).toBeInTheDocument();
  });

  it('shows no such error once a reason is given', () => {
    setup(overridden(50_000, 'Multiple dwellings relief'));
    expect(
      screen.queryByText(/An acquisition tax override must state why/),
    ).not.toBeInTheDocument();
  });

  it('records a blank amount as no override, and £0 as a real zero', () => {
    const { onChange } = setup(overridden(50_000, 'relief'));
    const amount = screen.getByLabelText('Override LTT (£)');
    fireEvent.change(amount, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({
      acquisition: expect.objectContaining({ acquisition_tax_override_pence: null }),
    });
    fireEvent.change(amount, { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({
      acquisition: expect.objectContaining({ acquisition_tax_override_pence: 0 }),
    });
  });
});
