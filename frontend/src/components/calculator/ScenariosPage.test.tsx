import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScenariosPage from './ScenariosPage';
import { ddDoc } from '../../lib/model/__fixtures__/due-diligence-docs';
import { icDoc } from '../../lib/model/__fixtures__/investment-case-docs';
import { migrateInputsToV16 } from '../../lib/model';
import type { ScenarioOverrides } from '../../lib/conversion-types';

// Exhaustiveness (R9's lesson): this Record fails to COMPILE the moment a field
// is added to ScenarioOverrides without a label here, and the test below fails
// at runtime if a labelled field has no rendered input.
const RENDERED_LABEL: Record<Exclude<keyof ScenarioOverrides, 'label' | 'phase_slip_phase_id'>, string> = {
  gdv_adjustment_pct: 'GDV adjustment (%)',
  construction_cost_adjustment_pct: 'Construction cost adjustment (%)',
  timeline_adjustment_months: 'Timeline adjustment (months)',
  interest_rate_adjustment_pct: 'Interest rate adjustment (%)',
  phase_slip_months: 'Phase slip (months)',
  exit_yield_adjustment_pct: 'Exit yield adjustment (pp)',
  operating_cost_adjustment_pct: 'Operating cost adjustment (%)',
  vacancy_adjustment_pct: 'Vacancy adjustment (pp)',
  sales_slip_months: 'Sales slip (months)',
  saleable_area_adjustment_pct: 'Saleable area adjustment (%)',
  abnormal_cost_adjustment_pct: 'Abnormal cost (pp)',
  programme_slip_months: 'Programme slip (months)',
  refi_ltv_adjustment_pct: 'Refinance LTV reduction (pp)',
};

describe('ScenariosPage (R16 spec §25)', () => {
  it('renders one input per ScenarioOverrides field on each of the four cards, and the phase picker on a network document', () => {
    render(<ScenariosPage inputs={ddDoc()} onChange={() => {}} />);
    for (const label of Object.values(RENDERED_LABEL)) {
      expect(screen.getAllByLabelText(label), label).toHaveLength(4);
    }
    expect(screen.getAllByLabelText('Phase to slip')).toHaveLength(4);
  });

  it('writes a new lever through onChange', () => {
    const calls: unknown[] = [];
    render(<ScenariosPage inputs={ddDoc()} onChange={(p) => calls.push(p)} />);
    fireEvent.change(screen.getAllByLabelText('Programme slip (months)')[2], { target: { value: '6' } });
    const sent = calls.at(-1) as { scenarios: { downside: ScenarioOverrides } };
    expect(sent.scenarios.downside.programme_slip_months).toBe(6);
  });

  it('a card whose levered document fails validation is "not measured", not appraised (spec §12.7)', () => {
    const base = migrateInputsToV16(icDoc() as unknown as Record<string, unknown>);
    const doc = { ...base, scenarios: { ...base.scenarios, downside: { ...base.scenarios.downside, refi_ltv_adjustment_pct: 100 } } };
    render(<ScenariosPage inputs={doc} onChange={() => {}} />);
    expect(screen.getAllByText('not measured').length).toBeGreaterThan(0);
    // Pinned in both surfaces (beneath the grid AND the Flags panel) for the one
    // failing card -- fix round 1, Finding 1.
    expect(screen.getAllByText(/Not measured — the levered document fails validation/).length).toBeGreaterThanOrEqual(2);
  });
});
