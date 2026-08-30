import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvestorSummaryPage from './InvestorSummaryPage';
import { runAppraisal } from '../../lib/model';
import { defaultCalculatorInputsV17 } from '../../lib/conversion-defaults';
import type { Project } from '../../types';

const PROJECT = {
  id: 'p1',
  address_raw: '1 Test Street',
  postcode: 'TS1 1TS',
  use_class: 'office',
  floor_area_sqm: 400,
  tenure: 'freehold',
} as unknown as Project;

// R17 spec §13.1. The Investor Summary's ROE tile is labelled by the engine's
// own realisation flag; both branches are exercised on one real run by
// overriding only the flag.
describe('InvestorSummaryPage — unrealised ROE label (R17 spec §13.1)', () => {
  const inputs = defaultCalculatorInputsV17();
  const run = runAppraisal(inputs);

  it('prints "Unrealised Return on Equity" when the flag is true', () => {
    const flagged = { ...run, metrics: { ...run.metrics, return_on_equity_is_unrealised: true } };
    render(<InvestorSummaryPage inputs={inputs} run={flagged} project={PROJECT} />);
    expect(screen.getByText('Unrealised Return on Equity')).toBeInTheDocument();
    expect(screen.queryByText('Return on Equity')).not.toBeInTheDocument();
  });

  it('prints "Return on Equity" when the flag is false', () => {
    const flagged = { ...run, metrics: { ...run.metrics, return_on_equity_is_unrealised: false } };
    render(<InvestorSummaryPage inputs={inputs} run={flagged} project={PROJECT} />);
    expect(screen.getByText('Return on Equity')).toBeInTheDocument();
    expect(screen.queryByText('Unrealised Return on Equity')).not.toBeInTheDocument();
  });
});
