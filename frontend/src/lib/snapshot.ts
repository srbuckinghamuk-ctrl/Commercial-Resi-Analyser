import type { CalculatorInputs, ProposedUnit } from './conversion-types';
import {
  DEFAULT_ACQUISITION,
  DEFAULT_CONVERSION_COSTS,
  DEFAULT_EXIT_STRATEGY,
  DEFAULT_FINANCE,
  DEFAULT_SCENARIOS,
  newId,
} from './conversion-defaults';

const SQFT_TO_SQM = 0.092903;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateUnit(raw: Record<string, unknown>): ProposedUnit {
  const sqm =
    typeof raw.floor_area_sqm === 'number'
      ? raw.floor_area_sqm
      : typeof raw.floor_area_sqft === 'number'
        ? Math.round((raw.floor_area_sqft as number) * SQFT_TO_SQM * 100) / 100
        : 0;
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    type: (raw.type as ProposedUnit['type']) ?? '1bed',
    floor_area_sqm: sqm,
    estimated_value_pence: typeof raw.estimated_value_pence === 'number' ? raw.estimated_value_pence : 0,
    comparable_notes: typeof raw.comparable_notes === 'string' ? raw.comparable_notes : '',
  };
}

/**
 * Validate and normalise a saved appraisal snapshot into the current
 * CalculatorInputs shape. Older snapshots are migrated (sq ft unit areas
 * become m²) and missing fields fall back to defaults instead of crashing
 * the calculator. Returns null when the snapshot is not usable at all.
 */
export function normaliseSnapshot(raw: unknown): CalculatorInputs | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw.acquisition) || !isRecord(raw.unit_mix)) return null;

  const rawUnits = Array.isArray((raw.unit_mix as Record<string, unknown>).units)
    ? ((raw.unit_mix as Record<string, unknown>).units as unknown[])
    : [];

  const scenarios = isRecord(raw.scenarios) ? raw.scenarios : {};

  return {
    project_id: typeof raw.project_id === 'string' ? raw.project_id : null,
    acquisition: { ...DEFAULT_ACQUISITION, ...(raw.acquisition as object) },
    unit_mix: { units: rawUnits.filter(isRecord).map(migrateUnit) },
    conversion_costs: {
      ...DEFAULT_CONVERSION_COSTS,
      ...(isRecord(raw.conversion_costs) ? raw.conversion_costs : {}),
    },
    finance: { ...DEFAULT_FINANCE, ...(isRecord(raw.finance) ? raw.finance : {}) },
    exit_strategy: {
      ...DEFAULT_EXIT_STRATEGY,
      ...(isRecord(raw.exit_strategy) ? raw.exit_strategy : {}),
      retained_units: Array.isArray(isRecord(raw.exit_strategy) ? raw.exit_strategy.retained_units : null)
        ? ((raw.exit_strategy as Record<string, unknown>).retained_units as CalculatorInputs['exit_strategy']['retained_units'])
        : [],
    },
    risks: Array.isArray(raw.risks)
      ? (raw.risks.filter(isRecord) as unknown as CalculatorInputs['risks'])
      : [],
    scenarios: {
      base: { ...DEFAULT_SCENARIOS.base, ...(isRecord(scenarios.base) ? scenarios.base : {}) },
      upside: { ...DEFAULT_SCENARIOS.upside, ...(isRecord(scenarios.upside) ? scenarios.upside : {}) },
      downside: { ...DEFAULT_SCENARIOS.downside, ...(isRecord(scenarios.downside) ? scenarios.downside : {}) },
    },
  };
}
