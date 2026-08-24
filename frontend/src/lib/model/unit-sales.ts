/**
 * R13b spec §22. The unit-level sales ledger: per-unit exchange/completion
 * timing, deposits held or released, per-unit selling-cost overrides. The
 * input types below twin app/financial_model/types.py; the derivation
 * further down twins app/financial_model/unit_sales.py. Task 1 declares the
 * input types; Task 4 adds the derivation. This module runs STRICTLY BEFORE
 * the ledger and reads nothing from it.
 */
import type { AnyCalculatorInputs, PhaseAnchor } from './finance-types';
import { derivePhases, isProgrammeNetwork } from './programme';
import { pct } from './pct';

export type DepositRelease = 'held_to_completion' | 'released_on_exchange';
export const DEPOSIT_RELEASE_VALUES: readonly DepositRelease[] =
  ['held_to_completion', 'released_on_exchange'];

/** §18.6's pair, reused verbatim. `anchor: null` = use `month_offset`. */
export interface SaleEvent {
  month_offset: number;
  anchor: PhaseAnchor | null;
}

export interface UnitSale {
  unit_id: string;
  /** null = exchange and completion are simultaneous; requires deposit_pct 0. */
  exchange: SaleEvent | null;
  completion: SaleEvent;
  /** 0..100, of the unit's gross (value + ancillary). */
  deposit_pct: number;
  /** null = scheme selling_agent_fee_pct. */
  agent_fee_pct: number | null;
  /** null = share of the scheme selling_legal_fee_pence (§22.2). */
  legal_fee_pence: number | null;
}

export interface UnitSalesInputs {
  deposit_release: DepositRelease;
  units: UnitSale[];
}

export type PreSoldBasis = 'practical_completion' | 'first_completion';

export interface UnitSaleRow {
  unit_id: string;
  gross_pence: number;
  exchange_month: number | null;
  completion_month: number;
  deposit_pence: number;
  deposit_released_pence: number;
  agent_fee_pence: number;
  legal_fee_pence: number;
  net_pence: number;
}

export interface UnitSalesMonth {
  month: number;
  exchanged_value_pence: number;   // cumulative
  completed_value_pence: number;   // cumulative
  deposits_received_pence: number; // released deposits landing this month
}

export interface UnitSalesResult {
  deposit_release: DepositRelease;
  units: UnitSaleRow[];
  months: UnitSalesMonth[];
  totals: {
    gross_pence: number; deposits_pence: number; deposits_released_pence: number;
    agent_fees_pence: number; legal_fees_pence: number; net_pence: number;
  };
  pre_sold: {
    reference_month: number; basis: PreSoldBasis;
    exchanged_value_pence: number; pct: number | null;
  };
}

const clampMonth = (m: number, termMonths: number): number =>
  Math.min(Math.max(0, Math.floor(m)), termMonths - 1);

function practicalCompletionStarts(inputs: AnyCalculatorInputs): number[] {
  const programme = 'programme' in inputs ? inputs.programme : null;
  if (programme == null || !isProgrammeNetwork(programme)) return [];
  const derivation = derivePhases(programme);
  if ('cycle' in derivation) return [];
  return programme.phases
    .filter((p) => p.code === 'practical_completion' && derivation.byId[p.id] != null)
    .map((p) => derivation.byId[p.id].start_month);
}

/**
 * R13b spec §22.2-22.4. Twin of unit_sales.py's compute_unit_sales.
 * `soldGross` is the schedule's `[unit_id, gross]` list over the SOLD set --
 * value plus ancillary, the same figure gross_sales sums -- so `gdv_pence`
 * and `gross_sales_pence` stay equal by construction. Tuple-shaped (not
 * `{ unit_id, gross_pence }`) to match the fixture builder's actual return
 * type (unit-sales-docs.ts's `soldGross`), which mirrors the Python twin's
 * `list[tuple[str, int]]` exactly.
 */
export function computeUnitSales(
  inputs: AnyCalculatorInputs,
  termMonths: number,
  resolveAnchorMonth: (anchor: PhaseAnchor | null, monthOffset: number) => number,
  soldGross: Array<[string, number]>,
): UnitSalesResult | null {
  const us = 'unit_sales' in inputs ? inputs.unit_sales : null;
  if (us == null) return null;

  const grossById = new Map(soldGross);
  const rows = us.units.filter((r) => grossById.has(r.unit_id));
  const totalGross = rows.reduce((s, r) => s + grossById.get(r.unit_id)!, 0);
  const schemeAgent = inputs.exit_strategy.selling_agent_fee_pct;
  const schemeLegal = inputs.exit_strategy.selling_legal_fee_pence;
  const released = us.deposit_release === 'released_on_exchange';

  const nullLegalIds = rows.filter((r) => r.legal_fee_pence == null).map((r) => r.unit_id);
  const nullLegalBase = nullLegalIds.reduce((s, id) => s + grossById.get(id)!, 0);
  let legalAllocated = 0;

  const outRows: UnitSaleRow[] = rows.map((r) => {
    const g = grossById.get(r.unit_id)!;
    const deposit = Math.round((g * r.deposit_pct) / 100);
    const agentPct = r.agent_fee_pct ?? schemeAgent;
    const agent = Math.round((g * agentPct) / 100);
    let legal: number;
    if (r.legal_fee_pence != null) {
      legal = r.legal_fee_pence;
    } else if (r.unit_id === nullLegalIds[nullLegalIds.length - 1]) {
      legal = schemeLegal - legalAllocated; // the LAST null-legal row absorbs the residue
    } else {
      legal = nullLegalBase > 0 ? Math.round((schemeLegal * g) / nullLegalBase) : 0;
      legalAllocated += legal;
    }
    const completionMonth = clampMonth(resolveAnchorMonth(r.completion.anchor, r.completion.month_offset), termMonths);
    const exchangeMonth = r.exchange == null
      ? null : clampMonth(resolveAnchorMonth(r.exchange.anchor, r.exchange.month_offset), termMonths);
    return {
      unit_id: r.unit_id, gross_pence: g, exchange_month: exchangeMonth, completion_month: completionMonth,
      deposit_pence: deposit,
      deposit_released_pence: released && exchangeMonth != null ? deposit : 0,
      agent_fee_pence: agent, legal_fee_pence: legal, net_pence: g - agent - legal,
    };
  });

  const effectiveExchange = (x: UnitSaleRow) => x.exchange_month ?? x.completion_month;
  const months: UnitSalesMonth[] = Array.from({ length: termMonths }, (_, m) => ({
    month: m,
    exchanged_value_pence: outRows.filter((x) => effectiveExchange(x) <= m).reduce((s, x) => s + x.gross_pence, 0),
    completed_value_pence: outRows.filter((x) => x.completion_month <= m).reduce((s, x) => s + x.gross_pence, 0),
    deposits_received_pence: outRows.filter((x) => x.exchange_month === m).reduce((s, x) => s + x.deposit_released_pence, 0),
  }));

  const pcStarts = practicalCompletionStarts(inputs);
  const basis: PreSoldBasis = pcStarts.length > 0 ? 'practical_completion' : 'first_completion';
  const referenceMonth = pcStarts.length > 0
    ? Math.min(...pcStarts)
    : outRows.length > 0 ? Math.min(...outRows.map((x) => x.completion_month)) : 0;
  const exchangedAtRef = outRows.filter((x) => effectiveExchange(x) <= referenceMonth).reduce((s, x) => s + x.gross_pence, 0);

  const sum = (f: (x: UnitSaleRow) => number) => outRows.reduce((s, x) => s + f(x), 0);
  return {
    deposit_release: us.deposit_release,
    units: outRows,
    months,
    totals: {
      gross_pence: totalGross,
      deposits_pence: sum((x) => x.deposit_pence),
      deposits_released_pence: sum((x) => x.deposit_released_pence),
      agent_fees_pence: sum((x) => x.agent_fee_pence),
      legal_fees_pence: sum((x) => x.legal_fee_pence),
      net_pence: sum((x) => x.net_pence),
    },
    pre_sold: { reference_month: referenceMonth, basis, exchanged_value_pence: exchangedAtRef, pct: pct(exchangedAtRef, totalGross) },
  };
}
