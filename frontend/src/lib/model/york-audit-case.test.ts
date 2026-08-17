import { describe, it, expect } from 'vitest';
import { runAppraisal, migrateInputs } from './index';

/**
 * The audited York case, reconstructed from the second lender-readiness audit's
 * own statement of it, and pinned to the figures that audit derived
 * independently.
 *
 * `docs/reviews/2026-08-17-lender-readiness-second-audit.md` §6 records a
 * pence-level manual recalculation of 9 & 9A Stonegate that matched the engine
 * exactly. That reconciliation is the single strongest external check this model
 * has, and it is worth strictly more than a fixture the project derived for
 * itself: the numbers below were computed by a reviewer who did not have the
 * code in front of them.
 *
 * The inputs are reconstructed rather than loaded, because the audited record
 * lives in a database this suite cannot reach. Two facts in the audit make the
 * reconstruction determinate rather than a guess:
 *
 *   - total acquisition cost £448,000 on a £425,000 price fixes the £12,250 of
 *     acquisition costs once commercial SDLT (£10,750) is taken out;
 *   - the migrated net facility of £527,437.40 is exactly 70% of the £753,482
 *     cost before finance, which fixes the v1 `ltv_pct` the migration read.
 *
 * If a later release moves any of these figures, it has moved a number a
 * qualified reviewer checked by hand, and that is a decision to take
 * deliberately rather than to discover.
 */

/** The v1-shaped snapshot, as the record predates the versioned schema. */
function yorkV1Snapshot(): Record<string, unknown> {
  return {
    project_id: 'york-stonegate',
    acquisition: {
      purchase_price_pence: 42_500_000,   // £425,000
      legal_fees_pence: 500_000,          // £5,000
      survey_cost_pence: 150_000,         // £1,500
      broker_fee_pct: 1.0,                // £4,250
      other_acquisition_costs_pence: 150_000, // £1,500
    },
    unit_mix: {
      units: [
        { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
        { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
        { id: 'u3', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
        { id: 'u4', type: '1bed', floor_area_sqm: 51, estimated_value_pence: 25_000_000, comparable_notes: '' },
        { id: 'u5', type: '1bed', floor_area_sqm: 51, estimated_value_pence: 25_000_000, comparable_notes: '' },
      ],
    },
    conversion_costs: {
      prior_approval_fee_per_dwelling_pence: 9_600,
      cil_s106_pence: 0,
      architect_pence: 1_500_000,
      structural_engineer_pence: 500_000,
      mande_pence: 500_000,
      planning_consultant_pence: 300_000,
      building_control_pence: 200_000,     // statutory, per spec §3.6
      other_professional_fees_pence: 0,
      construction_cost_per_sqm_pence: 50_000,  // £500/m²
      total_construction_sqm: 500,
      contingency_pct: 10.0,
      fire_safety_pence: 100,              // the audit's "£1 each" allowances
      sound_insulation_pence: 100,
      part_l_compliance_pence: 0,
    },
    finance: {
      funding_source: 'bridging',
      ltv_pct: 70,
      interest_rate_annual_pct: 8.0,
      arrangement_fee_pct: 2.0,
      exit_fee_pct: 1.0,
      loan_term_months: 12,
      interest_type: 'rolled_up',
    },
    exit_strategy: {
      route: 'retain_all',
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 100_000,
      retained_units: [
        { unit_id: 'u1', monthly_rent_pence: 300_000 },
        { unit_id: 'u2', monthly_rent_pence: 300_000 },
        { unit_id: 'u3', monthly_rent_pence: 300_000 },
        { unit_id: 'u4', monthly_rent_pence: 300_000 },
        { unit_id: 'u5', monthly_rent_pence: 300_000 },
      ],
    },
    risks: [],
  };
}

describe('York (9 & 9A Stonegate) — the audit\'s independently reconciled case', () => {
  const run = () => runAppraisal(migrateInputs(yorkV1Snapshot()));

  it('reproduces the reconstruction the audit describes', () => {
    const { inputs, metrics } = run();
    // Audit §6.1's stated inputs, which the reconstruction has to hit before
    // any output assertion below means anything.
    expect(metrics.acquisition_cost_pence).toBe(44_800_000);       // £448,000
    expect(metrics.sdlt_pence).toBe(1_075_000);                    // £10,750
    expect(metrics.gdv_pence).toBe(125_000_000);                   // £1,250,000
    expect(inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0)).toBe(252);
    expect(inputs.finance.term_months).toBe(12);
    // §6.1: "Migrated net facility: £527,437.40" — 70% of cost before finance.
    expect(inputs.finance.committed_net_facility_pence).toBe(52_743_740);
    expect(inputs.finance.requires_confirmation).toBe(true);
  });

  it('reproduces every figure of the audit\'s pence-level recalculation', () => {
    const { metrics } = run();
    // Audit §6.2, "Independent amount" column, in pence.
    expect(metrics.construction_cost_pence).toBe(27_500_200);      // £275,002.00
    expect(metrics.professional_fees_pence).toBe(2_800_000);       // £28,000.00
    expect(metrics.statutory_costs_pence).toBe(248_000);           // £2,480.00
    expect(metrics.cost_before_finance_pence).toBe(75_348_200);    // £753,482.00
    expect(metrics.finance_costs_pence).toBe(1_142_430);           // £11,424.30
    expect(metrics.total_development_cost_pence).toBe(76_490_630); // £764,906.30
    expect(metrics.profit_pence).toBe(48_509_370);                 // £485,093.70
    expect(metrics.profit_on_cost_pct).toBe(63.42);
    expect(metrics.profit_on_gdv_pct).toBe(38.81);
    expect(metrics.peak_debt_pence).toBe(1_142_430);               // £11,424.30
  });

  it('splits the finance cost as the audit did: arrangement fee plus compounded interest', () => {
    const { model } = run();
    expect(model.totals.arrangement_fee_pence).toBe(1_054_875);    // £10,548.75
    expect(model.totals.interest_pence).toBe(87_555);              // £875.55
    // §6.2's note on why peak debt is low: equity funds the development cost
    // under the migrated `fund_as_required` rule, so only the capitalised
    // finance charge sits in the senior ledger. The model does not invent a
    // draw merely because a facility limit exists.
    expect(model.totals.draws_pence).toBe(0);
    expect(model.totals.exit_fee_pence).toBe(0);                   // no applicable exit
  });

  it('still reports the case exactly as the audit read it: unsafe, unrepaid, unrealised', () => {
    const { metrics, reconciliation } = run();
    expect(reconciliation.sources_equal_uses).toBe(true);
    expect(reconciliation.report_safe).toBe(false);   // migrated terms unconfirmed
    expect(reconciliation.senior_repaid).toBe(false); // retain-all books no receipts
    expect(metrics.irr_annual_pct).toBeNull();
    expect(metrics.profit_is_unrealised).toBe(true);
    expect(metrics.return_on_equity_is_unrealised).toBe(true);
  });

  it('is the case R7 corrected: the equity multiple is unavailable, not zero', () => {
    // Audit §6.3: "equity multiple is 0.00x ... Showing it beside a 64.38% ROE
    // can confuse a non-specialist investor." Under spec §3.16.1 there is no
    // realisation event here, so there is no multiple to report.
    const { metrics, model } = run();
    expect(model.totals.distributions_pence).toBe(0);
    expect(metrics.has_realisation_event).toBe(false);
    expect(metrics.equity_multiple).toBeNull();
    // The return on equity itself is unchanged — only its label and the
    // suppressed multiple beside it have moved.
    expect(metrics.return_on_equity_pct).not.toBeNull();
  });
});
