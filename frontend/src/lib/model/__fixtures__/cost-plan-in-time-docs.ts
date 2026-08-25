/**
 * R15b spec §24.3. The shared cost-plan-in-time document builders. `docS()`
 * loads fixture S (fixtures/financial-model/s-dated-programme.json) via
 * `migrateInputsToV13` — never a hand-authored default object. `docZ()` is
 * "S plus Z's changes, and no other" (design §13): a QS provenance record
 * with a tender-price inflation allowance, a new `mande_fitout` phase carrying
 * pkg-mande's spend, per-package price basis tags, a VAT override on
 * pkg-externals, an extra pct-of-construction-total fee line, and VAT
 * registration switched on. Twin of `tests/fixtures_cost_plan_in_time.py`,
 * using this language's own naming convention for the same functions
 * (camelCase here, snake_case there).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV13 } from '../migrate';   // Task 7 moves this to V14 and loads Z directly
import type { CalculatorInputsV13 } from '../finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

export function docS(): CalculatorInputsV13 {
  return migrateInputsToV13(JSON.parse(readFileSync(resolve(FIXTURE_DIR, 's-dated-programme.json'), 'utf-8')).inputs);
}

/** Design §13: S plus Z's changes, and no other. */
export function docZ(): CalculatorInputsV13 {
  const d = docS();
  d.cost_plan.qs = {
    source: 'Gleeds', stage: 'riba_3', date: '2026-02-15', status: 'issued',
    base_date: '2026-02-01', inflation: { annual_pct: 6 },
  };
  d.programme!.phases.push({
    id: 'mande_fitout', code: 'other', label: 'M&E fit-out', duration_months: 3,
    slip_months: 0, start_offset: 0, curve: { kind: 'back_loaded' },
    predecessors: [{ phase_id: 'construction', type: 'SS', lag_months: 3 }],
  });
  const basis = {
    'pkg-enabling': 'fixed_price', 'pkg-structure': 'fixed_price', 'pkg-envelope': 'fixed_price',
    'pkg-mande': 'estimate', 'pkg-externals': 'provisional_sum',
  } as const;
  d.cost_plan.packages = d.cost_plan.packages.map((p) => {
    // `...p` carries every other package's `vat_override` through untouched
    // (a SpreadElement, not a direct read) — spec §17.2 rule 2's single-
    // accessor guard forbids reading `.vat_override` by name outside
    // resolveVatTreatment(), so pkg-externals' override is added as a key on
    // top of the spread rather than read-then-conditionally-replaced.
    const priced = {
      ...p,
      price_basis: basis[p.id as keyof typeof basis],
      phase_id: p.id === 'pkg-mande' ? 'mande_fitout' : p.phase_id,
    };
    return p.id === 'pkg-externals'
      ? { ...priced, vat_override: { rate_pct: 20, recoverable_pct: 0, recovery_basis: 'blocked' as const } }
      : priced;
  });
  d.cost_plan.fee_lines = [...d.cost_plan.fee_lines, {
    id: 'fee-pm', code: 'other_professional', category: 'professional', label: 'Project manager',
    basis: 'pct_of_construction_total', amount_pence: 0, pct: 1, per_dwelling: false,
    vat_override: null, phase_id: null,
  }];
  d.vat = { ...d.vat, registered: true };
  return d;
}

/** Z with the QS provenance kept but the allowance cleared: months_from_base
 *  and the latest-midpoint fields are still published, every inflation_pence
 *  is 0 and every inflation_factor is null. */
export function docZNoAllowance(): CalculatorInputsV13 {
  const d = docZ();
  d.cost_plan.qs = { ...d.cost_plan.qs!, inflation: null };
  return d;
}
