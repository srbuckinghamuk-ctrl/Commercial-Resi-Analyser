/**
 * R13b spec §22. The shared unit-sales-ledger document builders. Every
 * builder starts from fixture X (fixtures/financial-model/x-unit-sales-
 * ledger.json) via `migrateInputsToV12` — never a hand-authored default
 * object — so the tests and the golden corpus share one document. Mirrors
 * `tests/fixtures_unit_sales.py`, using this language's own naming
 * convention for the same functions (camelCase here, snake_case there — the
 * same per-language split every migrateInputsToVN/migrate_inputs_to_vN pair
 * in this repo already uses). Twin of `investment-case-docs.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV12 } from '../migrate';
import { derivePhases } from '../programme';
import { unitAncillaryValuePence } from '../../conversion-calc-engine';
import { runAppraisal } from '../index';
import { generateInvestmentMemo } from '../../export-investment-memo';
import { inspectPdf } from '../../report-qa/pdf-inspect';
import { documentText } from '../../report-qa/report-checks';
import { FIXTURE_PROJECT } from './investment-case-docs';
import type { CalculatorInputsV12, PhaseAnchor } from '../finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

function rawX(): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'x-unit-sales-ledger.json'), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  // Deep clone so callers never mutate the module-level parse across calls.
  return JSON.parse(JSON.stringify(doc.inputs)) as Record<string, unknown>;
}

function fixed(month: number): { month_offset: number; anchor: null } {
  return { month_offset: month, anchor: null };
}

/**
 * The override keys `unitSalesDoc` accepts (spec §22, Task 2's brief). Each
 * is a SINGLE named deviation from fixture X's base.
 */
export interface UnitSalesDocOverrides {
  depositRelease?: 'held_to_completion' | 'released_on_exchange';
  /** Only `null` is a meaningful value — drops the network; anchored events
   *  become the fixed months they resolve to on X (u1 8/12, u2 13, u3 13). */
  programme?: null;
  /** duration_months 5 -- PC at month 9, unit_completions 9-11. */
  pcEarly?: boolean;
  /** Three 10,000,000p units, scheme legal 100, agent 0, rows all-null
   *  overrides, fixed completions 12/13/14. */
  residueCase?: boolean;
  /** Only `null` is a meaningful value — drops the block entirely. */
  unitSales?: null;
  /** ALSO sets a single final-month tranche (rule 1 control). */
  salesPhasingToo?: boolean;
  route?: 'sell_all' | 'blended' | 'retain_all';
  /** Removes the row for this unit id. */
  dropRow?: string;
  /** Adds a second row copying u4's for this unit id. */
  extraRow?: string;
  /** Replaces `unit_sales.units` wholesale (raw objects). */
  rows?: Array<Record<string, unknown>>;
}

/** Fixture X, optionally altered. See {@link UnitSalesDocOverrides}. */
export function unitSalesDoc(overrides: UnitSalesDocOverrides = {}): CalculatorInputsV12 {
  const o = overrides;
  const raw = rawX();

  if (o.residueCase) {
    const unitMix = raw.unit_mix as { units: Array<Record<string, unknown>> };
    unitMix.units = [1, 2, 3].map((i) => ({
      ...unitMix.units[1],
      id: `r${i}`,
      estimated_value_pence: 10_000_000,
    }));
    const exitStrategy = raw.exit_strategy as Record<string, unknown>;
    exitStrategy.selling_agent_fee_pct = 0;
    exitStrategy.selling_legal_fee_pence = 100;
    const unitSales = raw.unit_sales as { units: Array<Record<string, unknown>> };
    unitSales.units = [1, 2, 3].map((i) => ({
      unit_id: `r${i}`, exchange: null, completion: fixed(11 + i),
      deposit_pct: 0, agent_fee_pct: null, legal_fee_pence: null,
    }));
  }
  if (o.depositRelease !== undefined) {
    (raw.unit_sales as Record<string, unknown>).deposit_release = o.depositRelease;
  }
  if (o.pcEarly) {
    const programme = raw.programme as { phases: Array<Record<string, unknown>> };
    for (const p of programme.phases) {
      if (p.id === 'construction') p.duration_months = 5;
    }
  }
  if ('programme' in o && o.programme === null) {
    raw.programme = null;
    const rows = (raw.unit_sales as { units: Array<Record<string, unknown>> }).units;
    rows[0].exchange = fixed(8);
    rows[0].completion = fixed(12);
    rows[1].completion = fixed(13);
    rows[2].completion = fixed(13);
  }
  if (o.route !== undefined) {
    (raw.exit_strategy as Record<string, unknown>).route = o.route;
  }
  if (o.rows !== undefined) {
    (raw.unit_sales as Record<string, unknown>).units = JSON.parse(JSON.stringify(o.rows));
  }
  if (o.dropRow !== undefined) {
    const unitSales = raw.unit_sales as { units: Array<Record<string, unknown>> };
    unitSales.units = unitSales.units.filter((r) => r.unit_id !== o.dropRow);
  }
  if (o.extraRow !== undefined) {
    const unitSales = raw.unit_sales as { units: Array<Record<string, unknown>> };
    unitSales.units.push({ ...JSON.parse(JSON.stringify(unitSales.units[unitSales.units.length - 1])), unit_id: o.extraRow });
  }
  if (o.salesPhasingToo) {
    raw.sales_phasing = { tranches: [{ month_offset: 23, pct_of_gross_receipts: 100, anchor: null }] };
  }
  if ('unitSales' in o && o.unitSales === null) {
    raw.unit_sales = null;
  }
  return migrateInputsToV12(raw) as CalculatorInputsV12;
}

export function heldTwinDoc(): CalculatorInputsV12 {
  return unitSalesDoc({ depositRelease: 'held_to_completion' });
}

export function noProgrammeDoc(): CalculatorInputsV12 {
  return unitSalesDoc({ programme: null });
}

export function pcEarlyDoc(): CalculatorInputsV12 {
  return unitSalesDoc({ pcEarly: true });
}

export function residueDoc(): CalculatorInputsV12 {
  return unitSalesDoc({ residueCase: true });
}

/** The (unitId, gross) pairs schedule.ts hands its unit-sales derivation, in
 *  unit_mix order, for a sell_all document. */
export function soldGross(doc: CalculatorInputsV12): Array<[string, number]> {
  return doc.unit_mix.units.map((u) => [u.id, u.estimated_value_pence + unitAncillaryValuePence(u)]);
}

/** Test-only stand-in for schedule.ts's closure (same rule: derived start +
 *  offset; null or unresolvable -> monthOffset). */
export function anchorResolver(doc: CalculatorInputsV12): (anchor: PhaseAnchor | null, monthOffset: number) => number {
  const derivation = doc.programme != null && 'phases' in doc.programme ? derivePhases(doc.programme) : null;
  return (anchor: PhaseAnchor | null, monthOffset: number): number => {
    if (anchor == null || derivation == null || 'cycle' in derivation) return monthOffset;
    const dp = derivation.byId[anchor.phase_id];
    return dp != null ? dp.start_month + anchor.offset_months : monthOffset;
  };
}

/** Runs a document through the real memo generator and returns its extracted
 *  text. Copied from `investment-case-docs.ts`'s `memoText`, widened to
 *  accept a `CalculatorInputsV12` document. */
export async function memoText(doc: CalculatorInputsV12): Promise<string> {
  const run = runAppraisal(doc);
  const blob = generateInvestmentMemo(FIXTURE_PROJECT, run);
  const info = await inspectPdf(blob);
  return documentText(info);
}
