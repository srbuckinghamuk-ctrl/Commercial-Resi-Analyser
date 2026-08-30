import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import SourceRecordsEditor from './SourceRecordsEditor';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV17 } from '../../lib/model';
import type { SourceEvidenceRecord, SourceConflictResolution } from '../../lib/model/due-diligence';
import { emptyClaims } from '../../lib/model/due-diligence';
import { defaultCalculatorInputsV17 } from '../../lib/conversion-defaults';
import { FIXTURE_PROJECT } from '../../lib/model/__fixtures__/investment-case-docs';

/**
 * R17 spec §4.3 / §11. The editor computes nothing: every assertion below is
 * either the partial `onChange` was handed or a value read from
 * `run.metrics.due_diligence` after the engine re-ran on the emitted inputs.
 */

afterEach(() => {
  cleanup();
});

function record(id: string, kind: SourceEvidenceRecord['kind'], claims: Partial<SourceEvidenceRecord['claims']>): SourceEvidenceRecord {
  return {
    id, kind, captured_at: '2026-08-30', reference: `${kind} ref`, captured_by: 'tester',
    narrative_excerpt: null, claims: { ...emptyClaims(), ...claims },
  };
}

function docWith(records: SourceEvidenceRecord[], resolutions: SourceConflictResolution[] = []): CalculatorInputsV17 {
  const base = defaultCalculatorInputsV17();
  return { ...base, due_diligence: { ...base.due_diligence, source_records: records, source_resolutions: resolutions } };
}

/** The `due_diligence` block `onChange` was handed, or a failure if it was not called once. */
function ddFrom(onChange: ReturnType<typeof vi.fn>): CalculatorInputsV17['due_diligence'] {
  expect(onChange).toHaveBeenCalledTimes(1);
  const partial = onChange.mock.calls[0][0] as Partial<CalculatorInputsV17>;
  expect(partial.due_diligence).toBeDefined();
  return partial.due_diligence!;
}

const TWO_USES = [
  record('r-listing', 'listing_narrative', { existing_use: 'E' }),
  record('r-survey', 'measured_survey', { existing_use: 'B8' }),
];

describe('SourceRecordsEditor', () => {
  it('adds an empty record through onChange', () => {
    const inputs = docWith([]);
    const onChange = vi.fn();
    render(<SourceRecordsEditor inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} project={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add source record' }));

    const dd = ddFrom(onChange);
    expect(dd.source_records).toHaveLength(1);
    expect(dd.source_records[0].id).toMatch(/[0-9a-f-]{36}/);
    expect(dd.source_records[0].claims).toEqual(emptyClaims());
    expect(dd.source_resolutions).toEqual([]);
  });

  it('prints the engine-derived conflict with each record\'s value', () => {
    const inputs = docWith(TWO_USES);
    const run = runAppraisal(inputs);
    expect(run.metrics.due_diligence.unresolved_source_conflicts).toBe(1);
    render(<SourceRecordsEditor inputs={inputs} onChange={vi.fn()} run={run} project={null} />);

    const card = screen.getByRole('group', { name: 'Existing use conflict' });
    expect(within(card).getByText('Listing (narrative):')).toBeTruthy();
    expect(within(card).getByText('E')).toBeTruthy();
    expect(within(card).getByText('Measured survey:')).toBeTruthy();
    expect(within(card).getByText('B8')).toBeTruthy();
    expect(within(card).getByText('unresolved')).toBeTruthy();
    expect(screen.getByText('1 conflicting field · 1 unresolved')).toBeTruthy();
  });

  it('records a resolution, and the engine counts the field resolved on the next run', () => {
    const inputs = docWith(TWO_USES);
    const onChange = vi.fn();
    render(<SourceRecordsEditor inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} project={null} />);

    const form = screen.getByRole('form', { name: 'Resolve Existing use' });
    fireEvent.change(within(form).getByLabelText('Resolved value'), { target: { value: 'B8' } });
    fireEvent.change(within(form).getByLabelText('Chosen record'), { target: { value: 'r-survey' } });
    fireEvent.change(within(form).getByLabelText('Evidence reference'), { target: { value: 'Survey p.3' } });
    fireEvent.change(within(form).getByLabelText('Resolved by'), { target: { value: 'A. Surveyor' } });
    fireEvent.change(within(form).getByLabelText('Resolved at'), { target: { value: '2026-08-30' } });
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'measured on site' } });
    fireEvent.submit(form);

    const dd = ddFrom(onChange);
    expect(dd.source_records).toBe(inputs.due_diligence.source_records);
    expect(dd.source_resolutions).toHaveLength(1);
    expect(dd.source_resolutions[0]).toMatchObject({
      field: 'existing_use', resolved_value: 'B8', chosen_record_id: 'r-survey',
      evidence_reference: 'Survey p.3', resolved_by: 'A. Surveyor', resolved_at: '2026-08-30', reason: 'measured on site',
    });

    const next = { ...inputs, due_diligence: dd };
    const rerun = runAppraisal(next);
    expect(rerun.metrics.due_diligence.unresolved_source_conflicts).toBe(0);
    cleanup();
    render(<SourceRecordsEditor inputs={next} onChange={vi.fn()} run={rerun} project={null} />);
    expect(screen.getByText('1 conflicting field · 0 unresolved')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Existing use conflict' })).getByText('resolved')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Resolve Existing use' })).toBeNull();
    expect(screen.getByTestId('source-resolution').textContent).toContain('Survey p.3');
  });

  it('does not count a resolution with blank evidence as resolved', () => {
    const inputs = docWith(TWO_USES);
    const onChange = vi.fn();
    render(<SourceRecordsEditor inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} project={null} />);

    const form = screen.getByRole('form', { name: 'Resolve Existing use' });
    fireEvent.change(within(form).getByLabelText('Resolved value'), { target: { value: 'B8' } });
    fireEvent.change(within(form).getByLabelText('Resolved by'), { target: { value: 'A. Surveyor' } });
    fireEvent.submit(form);

    const dd = ddFrom(onChange);
    expect(dd.source_resolutions[0].evidence_reference).toBe('');
    const rerun = runAppraisal({ ...inputs, due_diligence: dd });
    expect(rerun.metrics.due_diligence.unresolved_source_conflicts).toBe(1);
    expect(rerun.metrics.due_diligence.source_field_conflicts[0].resolved).toBe(false);
  });

  it('removes a resolution through onChange', () => {
    const resolution: SourceConflictResolution = {
      id: 'res-1', field: 'existing_use', resolved_value: 'B8', chosen_record_id: 'r-survey',
      evidence_reference: 'Survey p.3', resolved_by: 'A. Surveyor', resolved_at: '2026-08-30', reason: '',
    };
    const inputs = docWith(TWO_USES, [resolution]);
    const onChange = vi.fn();
    render(<SourceRecordsEditor inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} project={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove resolution' }));
    expect(ddFrom(onChange).source_resolutions).toEqual([]);
  });

  it('captures the appraisal inputs as a record from the run and the project', () => {
    const inputs = docWith([]);
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<SourceRecordsEditor inputs={inputs} onChange={onChange} run={run} project={FIXTURE_PROJECT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Capture from appraisal inputs' }));

    const dd = ddFrom(onChange);
    expect(dd.source_records).toHaveLength(1);
    expect(dd.source_records[0].kind).toBe('appraisal_inputs');
    expect(dd.source_records[0].claims.floor_area_sqm).toBe(run.metrics.area_bridge.existing_gia_sqm);
    expect(dd.source_records[0].claims.existing_use).toBe(FIXTURE_PROJECT.use_class);
    expect(dd.source_records[0].claims.tenure).toBeNull();
  });
});
