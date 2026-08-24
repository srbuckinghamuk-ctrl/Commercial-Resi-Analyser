/**
 * R13b spec §22. The unit-level sales ledger: per-unit exchange/completion
 * timing, deposits held or released, per-unit selling-cost overrides.
 * Twin of app/financial_model/unit_sales.py. Task 1 declares the input
 * types; Task 4 adds the derivation. This module runs STRICTLY BEFORE the
 * ledger and reads nothing from it.
 */
import type { PhaseAnchor } from './finance-types';

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
