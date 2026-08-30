/**
 * Area-unit display preference (R17, spec §27.2, design decision 2). A
 * presentation preference held OUTSIDE the document: React context plus
 * `localStorage['cra.area_unit']`. It is not an input — a preference that
 * moved `input_hash` would make a lender case stale for a display choice —
 * so nothing here ever touches `inputs`. Every read/write of storage is in a
 * try/catch (private windows, blocked site data, capture contexts) and the
 * page renders with the metric default when storage is unavailable.
 * `useAreaUnit()` outside a provider returns the metric default with a
 * no-op setter, so a page rendered alone (tests, the project detail view)
 * still works.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AreaUnit } from './area-units';

export const AREA_UNIT_STORAGE_KEY = 'cra.area_unit';

interface AreaUnitContextValue {
  unit: AreaUnit;
  setUnit: (unit: AreaUnit) => void;
}

const DEFAULT_VALUE: AreaUnitContextValue = { unit: 'metric', setUnit: () => undefined };

const AreaUnitContext = createContext<AreaUnitContextValue>(DEFAULT_VALUE);

// eslint-disable-next-line react-refresh/only-export-components -- a hook/reader exported beside its provider, the same shape as UnitSalesEditor's helpers
export function readStoredAreaUnit(): AreaUnit {
  try {
    const raw = globalThis.localStorage?.getItem(AREA_UNIT_STORAGE_KEY);
    return raw === 'imperial' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

function writeStoredAreaUnit(unit: AreaUnit): void {
  try {
    globalThis.localStorage?.setItem(AREA_UNIT_STORAGE_KEY, unit);
  } catch {
    // Storage unavailable: the preference lives for this render tree only.
  }
}

export function AreaUnitProvider({ children, initialUnit }: { children: ReactNode; initialUnit?: AreaUnit }) {
  const [unit, setUnitState] = useState<AreaUnit>(() => initialUnit ?? readStoredAreaUnit());
  const setUnit = useCallback((next: AreaUnit) => {
    setUnitState(next);
    writeStoredAreaUnit(next);
  }, []);
  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit]);
  return <AreaUnitContext.Provider value={value}>{children}</AreaUnitContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- a hook/reader exported beside its provider, the same shape as UnitSalesEditor's helpers
export function useAreaUnit(): AreaUnitContextValue {
  const value = useContext(AreaUnitContext);
  // No provider above (the project detail view, a page rendered alone): the
  // persisted preference still applies, read-only.
  return value === DEFAULT_VALUE ? { unit: readStoredAreaUnit(), setUnit: DEFAULT_VALUE.setUnit } : value;
}
