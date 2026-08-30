import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AreaUnitToggle from './AreaUnitToggle';
import AreasPage from './calculator/AreasPage';
import ConversionCostsPage from './calculator/ConversionCostsPage';
import { AreaUnitProvider, AREA_UNIT_STORAGE_KEY, useAreaUnit } from '../lib/area-unit-context';
import { runAppraisal } from '../lib/model';
import type { CalculatorInputsV17 } from '../lib/model';
import { defaultCalculatorInputsV17 } from '../lib/conversion-defaults';

/**
 * R17 spec §27.2 (design decision 2): the m² / ft² control is a display
 * preference held outside the document. These tests pin the four things that
 * make it safe: labels flip, entry converts once and exactly, toggling never
 * touches `inputs`, and a hostile `localStorage` cannot take the page down.
 */

function inputsWithAreas(): CalculatorInputsV17 {
  const inputs = defaultCalculatorInputsV17();
  return {
    ...inputs,
    areas: { ...inputs.areas, basis: 'manual', existing_gia_sqm: 600, retained_commercial_gia_sqm: 100 },
  };
}

function pressUnit(label: 'm²' | 'ft²') {
  const group = screen.getAllByRole('group', { name: 'Area unit' })[0];
  const button = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!button) throw new Error(`no ${label} button`);
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
  try { localStorage.removeItem(AREA_UNIT_STORAGE_KEY); } catch { /* unavailable */ }
});

describe('AreaUnitToggle', () => {
  it('renders two buttons in a group labelled "Area unit" with metric pressed by default', () => {
    render(<AreaUnitProvider><AreaUnitToggle /></AreaUnitProvider>);
    const group = screen.getByRole('group', { name: 'Area unit' });
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('flips the Areas page labels and persists the preference', () => {
    const inputs = inputsWithAreas();
    render(
      <AreaUnitProvider initialUnit="metric">
        <AreasPage inputs={inputs} onChange={vi.fn()} run={runAppraisal(inputs)} />
      </AreaUnitProvider>,
    );
    expect(screen.getByLabelText('Existing GIA (m²)')).toBeInTheDocument();
    pressUnit('ft²');
    expect(screen.getByLabelText('Existing GIA (ft²)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Existing GIA (m²)')).toBeNull();
    // 600 m² displays as 6,458.3 ft² with the m² in secondary text.
    expect(screen.getByLabelText('Existing GIA (ft²)')).toHaveValue(6458.3463);
    expect(screen.getAllByText('6,458.3 ft² (600.0 m²)').length).toBeGreaterThan(0);
    expect(localStorage.getItem(AREA_UNIT_STORAGE_KEY)).toBe('imperial');
  });

  it('entering 1076.391 ft² stores exactly 100 m² (one conversion, 4 dp)', () => {
    const inputs = inputsWithAreas();
    const onChange = vi.fn();
    render(
      <AreaUnitProvider initialUnit="imperial">
        <AreasPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />
      </AreaUnitProvider>,
    );
    fireEvent.change(screen.getByLabelText('Existing GIA (ft²)'), { target: { value: '1076.391' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].areas.existing_gia_sqm).toBe(100);
  });

  it('1,000 alternate toggles leave the document deep-equal and never call onChange', () => {
    const inputs = inputsWithAreas();
    const before = JSON.parse(JSON.stringify(inputs));
    const onChange = vi.fn();
    render(
      <AreaUnitProvider initialUnit="metric">
        <AreasPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />
      </AreaUnitProvider>,
    );
    // Resolve the two buttons once: the role query is the slow part of jsdom,
    // and the point here is the document, not the query.
    const group = screen.getByRole('group', { name: 'Area unit' });
    const [metric, imperial] = Array.from(group.querySelectorAll('button'));
    for (let i = 0; i < 1000; i++) fireEvent.click(i % 2 === 0 ? imperial : metric);
    expect(inputs).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    // 1,000 presses end on m².
    expect(screen.getByLabelText('Existing GIA (m²)')).toHaveValue(600);
  });

  it('per-unit and lump-sum rows on the Costs page are unaffected; only area and rate labels flip', () => {
    const inputs = inputsWithAreas();
    render(
      <AreaUnitProvider initialUnit="metric">
        <AreaUnitToggle />
        <ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={runAppraisal(inputs)} />
      </AreaUnitProvider>,
    );
    expect(screen.getByText('Total construction area (m²)')).toBeInTheDocument();
    expect(screen.getByText('Cost per area (£/m²)')).toBeInTheDocument();
    const fireBefore = screen.getByText('Fire safety (£)').parentElement!.querySelector('input')!.value;
    pressUnit('ft²');
    expect(screen.getByText('Total construction area (ft²)')).toBeInTheDocument();
    expect(screen.getByText('Cost per area (£/ft²)')).toBeInTheDocument();
    expect(screen.getByText('Fire safety (£)')).toBeInTheDocument();
    expect(screen.getByText('Fire safety (£)').parentElement!.querySelector('input')!.value).toBe(fireBefore);
  });

  it('a throwing localStorage does not crash the provider, the toggle or the reader', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage blocked'); },
    });
    try {
      function Probe() {
        const { unit } = useAreaUnit();
        return <span data-testid="unit">{unit}</span>;
      }
      render(<AreaUnitProvider><AreaUnitToggle /><Probe /></AreaUnitProvider>);
      expect(screen.getByTestId('unit')).toHaveTextContent('metric');
      pressUnit('ft²');
      expect(screen.getByTestId('unit')).toHaveTextContent('imperial');
      cleanup();
      // Outside a provider the reader falls back to metric rather than throwing.
      render(<Probe />);
      expect(screen.getByTestId('unit')).toHaveTextContent('metric');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});
