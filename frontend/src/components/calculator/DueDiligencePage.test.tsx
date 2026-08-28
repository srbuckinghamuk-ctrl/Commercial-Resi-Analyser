import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import DueDiligencePage from './DueDiligencePage';
import { runAppraisal, OCCUPATION_CONFLICT, EXISTING_AREA_CONFLICT } from '../../lib/model';
import type { CalculatorInputsV15, DdItem } from '../../lib/model';
import { captureSourceRecord } from '../../lib/conversion-defaults';
import { ddDoc } from '../../lib/model/__fixtures__/due-diligence-docs';
import { FIXTURE_PROJECT } from '../../lib/model/__fixtures__/investment-case-docs';

/**
 * R15 Task 9 (spec §23.8). Page 13 is the evidence schedule; the free-form
 * risk register drops below it as the project log.
 *
 * Every test here asserts either a state change through `onChange` or a value
 * READ FROM THE RUN (`run.metrics.due_diligence`, `run.validation`) — the page
 * computes nothing of its own, so there is nothing else worth pinning.
 *
 * Fixture Y is the document throughout: 23 catalogue items plus one custom
 * ("Basement water ingress"), three of them unknown, a captured listing that
 * conflicts with the document on BOTH §23.5 rules.
 *
 * Every `*ByRole` query is scoped with `within` to the row, section or card
 * under test. That is not only tighter targeting: this page renders roughly
 * three hundred controls, and an unscoped role query computes an accessible
 * name for every one of them — enough, unscoped, to push a single test past
 * the suite's 30s ceiling when the whole suite is competing for the CPU.
 */

afterEach(() => {
  cleanup();
});

// Every test below `render`s the WHOLE schedule: twenty-four rows of a dozen
// controls each, plus five derived rows, the record card and the register --
// around three hundred controls, roughly two seconds of jsdom work per render
// in isolation. That is fine standalone but load-sensitive in exactly the way
// `model/accessor-guard.test.ts` documents for its real-linter tests: under
// the full suite's parallel workers one of these has been observed at 34s
// against vitest's 30s global `testTimeout`, never standalone. The same remedy
// is used here, and for the same reason it is applied to EVERY schedule test
// rather than to the one that happened to lose the race -- whichever render
// lands under the load spike is the one that times out.
const SCHEDULE_RENDER_TIMEOUT_MS = 60_000;

/** The item array `onChange` was handed, or a failure if it was not called. */
function itemsFrom(onChange: ReturnType<typeof vi.fn>): DdItem[] {
  expect(onChange).toHaveBeenCalledTimes(1);
  const partial = onChange.mock.calls[0][0] as Partial<CalculatorInputsV15>;
  expect(partial.due_diligence).toBeDefined();
  return partial.due_diligence!.items;
}

describe('DueDiligencePage — the schedule', () => {
  it('renders the six categories, an entered row as an editable status, and a derived row read-only', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    render(<DueDiligencePage inputs={inputs} onChange={vi.fn()} run={run} project={FIXTURE_PROJECT} />);

    for (const [key, heading] of [
      ['planning', 'Planning'],
      ['title_occupation', 'Title and occupation'],
      ['existing_building', 'Existing building'],
      ['construction', 'Construction'],
      ['finance', 'Finance'],
      ['exit', 'Exit'],
    ] as const) {
      const section = screen.getByTestId(`dd-category-${key}`);
      expect(within(section).getByRole('heading', { name: heading })).toBeInTheDocument();
    }

    // Entered: an editable select sitting at the document's status.
    const entered = screen.getByTestId('dd-row-dd-vacant_possession');
    expect(within(entered).getByRole('combobox', { name: 'Vacant possession status' }))
      .toHaveValue('green');

    // Derived: no control at all, the status as text, and the field it came from.
    const derived = screen.getByTestId('dd-row-dd-equity_sources');
    expect(within(derived).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(derived).getByText('unknown')).toBeInTheDocument();
    expect(within(derived).getByText('from equity_sources[].evidence_status')).toBeInTheDocument();
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('writes a status change through onChange, leaving the evidence alone', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<DueDiligencePage inputs={inputs} onChange={onChange} run={run} project={FIXTURE_PROJECT} />);

    const row = screen.getByTestId('dd-row-dd-cil_s106');
    fireEvent.change(
      within(row).getByRole('combobox', { name: 'CIL and S106 liability status' }),
      { target: { value: 'green' } },
    );

    const items = itemsFrom(onChange);
    expect(items).toHaveLength(24);
    const item = items.find((i) => i.code === 'cil_s106')!;
    expect(item.status).toBe('green');
    // The page never "helpfully" seeds evidence — validation rule 2 is what
    // tells the user a green needs it.
    expect(item.evidence).toBeNull();
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it("shows an item's validation issue beside its row", () => {
    const inputs = ddDoc({ status: { cil_s106: 'green' } });
    const run = runAppraisal(inputs);
    render(<DueDiligencePage inputs={inputs} onChange={vi.fn()} run={run} project={FIXTURE_PROJECT} />);

    const row = screen.getByTestId('dd-row-dd-cil_s106');
    expect(within(row).getByText('A green status needs evidence: record the source and the date.'))
      .toBeInTheDocument();
    // Scoped to the row that broke the rule, not printed against every item.
    const other = screen.getByTestId('dd-row-dd-title_report');
    expect(within(other).queryByText('A green status needs evidence: record the source and the date.'))
      .not.toBeInTheDocument();
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('appends a custom item in the category whose button was pressed', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<DueDiligencePage inputs={inputs} onChange={onChange} run={run} project={FIXTURE_PROJECT} />);

    const section = screen.getByTestId('dd-category-existing_building');
    fireEvent.click(within(section).getByRole('button', { name: 'Add custom item to Existing building' }));

    const items = itemsFrom(onChange);
    expect(items).toHaveLength(25);
    const added = items[24];
    expect(added.code).toBe('custom');
    expect(added.category).toBe('existing_building');
    expect(added.status).toBe('unknown');
    expect(added.label).toBe('');
    expect(added.evidence).toBeNull();
    expect(added.cost_impact_pence).toBeNull();
    // A real uuid, not an index — two custom items must never collide (rule 1g).
    expect(added.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('clears an evidence record back to null rather than to empty strings', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<DueDiligencePage inputs={inputs} onChange={onChange} run={run} project={FIXTURE_PROJECT} />);

    const row = screen.getByTestId('dd-row-dd-vacant_possession');
    fireEvent.click(within(row).getByRole('button', { name: 'Clear evidence on Vacant possession' }));

    const item = itemsFrom(onChange).find((i) => i.code === 'vacant_possession')!;
    // §1.5: `null` is "no evidence", not a record of three blank fields.
    expect(item.evidence).toBeNull();
    expect(item.status).toBe('green');
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('removes a custom item, which is the only kind that can be removed', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<DueDiligencePage inputs={inputs} onChange={onChange} run={run} project={FIXTURE_PROJECT} />);

    // A catalogue row has no Remove: rule 1a requires every one of them.
    const catalogue = screen.getByTestId('dd-row-dd-vacant_possession');
    expect(within(catalogue).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    const custom = screen.getByTestId('dd-row-dd-custom-basement');
    fireEvent.click(within(custom).getByRole('button', { name: 'Remove' }));

    const items = itemsFrom(onChange);
    expect(items).toHaveLength(23);
    expect(items.some((i) => i.code === 'custom')).toBe(false);
  }, SCHEDULE_RENDER_TIMEOUT_MS);
});

describe('DueDiligencePage — the captured listing record', () => {
  const NOW = new Date('2026-08-26T10:30:00.000Z');

  it('prints the record, the conflicts, and re-captures from the project', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(
      <DueDiligencePage
        inputs={inputs} onChange={onChange} run={run} project={FIXTURE_PROJECT} now={() => NOW}
      />,
    );

    const card = screen.getByTestId('dd-source-record');
    expect(within(card).getByText('Listing: occupied')).toBeInTheDocument();
    expect(within(card).getByText('360 m²')).toBeInTheDocument();
    // Both §23.5 rules fire on fixture Y; the statements are the engine's own.
    expect(within(card).getByText(OCCUPATION_CONFLICT)).toBeInTheDocument();
    expect(within(card).getByText(EXISTING_AREA_CONFLICT)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Re-capture from listing' }));

    expect(onChange).toHaveBeenCalledWith({
      due_diligence: {
        ...inputs.due_diligence,
        source_record: captureSourceRecord(FIXTURE_PROJECT, NOW.toISOString()),
      },
    });
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('cannot re-capture without a project', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    render(<DueDiligencePage inputs={inputs} onChange={vi.fn()} run={run} project={null} now={() => NOW} />);

    const card = screen.getByTestId('dd-source-record');
    expect(within(card).getByRole('button', { name: 'Re-capture from listing' })).toBeDisabled();
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('shows the listing prose read-only under Title and occupation', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    render(<DueDiligencePage inputs={inputs} onChange={vi.fn()} run={run} project={FIXTURE_PROJECT} />);

    const section = screen.getByTestId('dd-category-title_occupation');
    expect(within(section).getByText('From the listing')).toBeInTheDocument();
    expect(within(section).getByText('Former office building, vacant since 2025')).toBeInTheDocument();
    expect(within(section).getByText('Fixture project for the R13 investment-case builder suite.'))
      .toBeInTheDocument();
    // Read-only: the listing is evidence, not an input on this page.
    expect(within(section).queryByDisplayValue('Former office building, vacant since 2025'))
      .not.toBeInTheDocument();
  }, SCHEDULE_RENDER_TIMEOUT_MS);
});

describe('DueDiligencePage — coverage and the project log', () => {
  it('prints the coverage and the per-category counts from the run', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    render(<DueDiligencePage inputs={inputs} onChange={vi.fn()} run={run} project={FIXTURE_PROJECT} />);

    expect(screen.getByText('21 of 24 addressed (87.5%)')).toBeInTheDocument();
    const planning = screen.getByTestId('dd-category-planning');
    expect(within(planning).getByText('red 0 · amber 1 · green 3 · unknown 1 · n/a 0')).toBeInTheDocument();
  }, SCHEDULE_RENDER_TIMEOUT_MS);

  it('keeps the free-form risk register below, as the project log', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    render(<DueDiligencePage inputs={inputs} onChange={vi.fn()} run={run} project={FIXTURE_PROJECT} />);

    const log = screen.getByTestId('dd-project-log');
    expect(within(log).getByRole('heading', { name: 'Risk register (project log)' })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: '+ Add Risk' })).toBeInTheDocument();
  }, SCHEDULE_RENDER_TIMEOUT_MS);

});
