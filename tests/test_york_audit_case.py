"""The audited York case, reconstructed from the second lender-readiness audit.

Mirror of frontend/src/lib/model/york-audit-case.test.ts, case for case. See that
file's header for why the reconstruction is determinate and why these particular
numbers are worth pinning: they were derived by a reviewer working by hand,
without the code, and they are the strongest external check this model has.

Both engines assert the same pence values, so a divergence between them shows up
here as well as in the shared golden fixtures.
"""
from app.financial_model import run_appraisal
from app.financial_model.migrate import migrate_inputs


def york_v1_snapshot() -> dict:
    """The v1-shaped snapshot, as the record predates the versioned schema."""
    return {
        "project_id": "york-stonegate",
        "acquisition": {
            "purchase_price_pence": 42_500_000,      # 425,000 pounds
            "legal_fees_pence": 500_000,
            "survey_cost_pence": 150_000,
            "broker_fee_pct": 1.0,
            "other_acquisition_costs_pence": 150_000,
        },
        "unit_mix": {
            "units": [
                {"id": "u1", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 25_000_000, "comparable_notes": ""},
                {"id": "u2", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 25_000_000, "comparable_notes": ""},
                {"id": "u3", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 25_000_000, "comparable_notes": ""},
                {"id": "u4", "type": "1bed", "floor_area_sqm": 51, "estimated_value_pence": 25_000_000, "comparable_notes": ""},
                {"id": "u5", "type": "1bed", "floor_area_sqm": 51, "estimated_value_pence": 25_000_000, "comparable_notes": ""},
            ]
        },
        "conversion_costs": {
            "prior_approval_fee_per_dwelling_pence": 9_600,
            "cil_s106_pence": 0,
            "architect_pence": 1_500_000,
            "structural_engineer_pence": 500_000,
            "mande_pence": 500_000,
            "planning_consultant_pence": 300_000,
            "building_control_pence": 200_000,        # statutory, per spec Sec 3.6
            "other_professional_fees_pence": 0,
            "construction_cost_per_sqm_pence": 50_000,
            "total_construction_sqm": 500,
            "contingency_pct": 10.0,
            "fire_safety_pence": 100,                 # the audit's "1 pound each" allowances
            "sound_insulation_pence": 100,
            "part_l_compliance_pence": 0,
        },
        "finance": {
            "funding_source": "bridging",
            "ltv_pct": 70,
            "interest_rate_annual_pct": 8.0,
            "arrangement_fee_pct": 2.0,
            "exit_fee_pct": 1.0,
            "loan_term_months": 12,
            "interest_type": "rolled_up",
        },
        "exit_strategy": {
            "route": "retain_all",
            "selling_agent_fee_pct": 1.5,
            "selling_legal_fee_pence": 100_000,
            "retained_units": [
                {"unit_id": f"u{i}", "monthly_rent_pence": 300_000} for i in range(1, 6)
            ],
        },
        "risks": [],
    }


def york_run():
    # migrate_inputs returns a parsed CalculatorInputsV2; the TypeScript mirror's
    # migrateInputs does the same, so both engines are given the identical
    # migrated document rather than one each side normalised for itself.
    return run_appraisal(migrate_inputs(york_v1_snapshot()))


class TestYorkAuditCase:
    def test_reconstruction_matches_the_audit_s_stated_inputs(self):
        run = york_run()
        m, inputs = run.metrics, run.inputs
        assert m.acquisition_cost_pence == 44_800_000      # 448,000 pounds
        assert m.sdlt_pence == 1_075_000                   # 10,750 pounds
        assert m.gdv_pence == 125_000_000                  # 1,250,000 pounds
        assert sum(u.floor_area_sqm for u in inputs.unit_mix.units) == 252
        assert inputs.finance.term_months == 12
        # Audit Sec 6.1: migrated net facility 527,437.40 -- 70% of cost before finance.
        assert inputs.finance.committed_net_facility_pence == 52_743_740
        assert inputs.finance.requires_confirmation is True

    def test_every_figure_of_the_audit_s_pence_level_recalculation(self):
        m = york_run().metrics
        # Audit Sec 6.2, "Independent amount" column, in pence.
        assert m.construction_cost_pence == 27_500_200      # 275,002.00
        assert m.professional_fees_pence == 2_800_000       # 28,000.00
        assert m.statutory_costs_pence == 248_000           # 2,480.00
        assert m.cost_before_finance_pence == 75_348_200    # 753,482.00
        assert m.finance_costs_pence == 1_142_430           # 11,424.30
        assert m.total_development_cost_pence == 76_490_630  # 764,906.30
        assert m.profit_pence == 48_509_370                 # 485,093.70
        assert m.profit_on_cost_pct == 63.42
        assert m.profit_on_gdv_pct == 38.81
        assert m.peak_debt_pence == 1_142_430               # 11,424.30

    def test_finance_cost_splits_as_the_audit_split_it(self):
        model = york_run().model
        assert model.totals.arrangement_fee_pence == 1_054_875   # 10,548.75
        assert model.totals.interest_pence == 87_555             # 875.55
        # Sec 6.2's note on why peak debt is low: equity funds the development
        # cost under the migrated fund_as_required rule, so only the capitalised
        # finance charge sits in the senior ledger.
        assert model.totals.draws_pence == 0
        assert model.totals.exit_fee_pence == 0                  # no applicable exit

    def test_still_reported_as_the_audit_read_it(self):
        run = york_run()
        assert run.reconciliation.sources_equal_uses is True
        assert run.reconciliation.report_safe is False    # migrated terms unconfirmed
        assert run.reconciliation.senior_repaid is False  # retain-all books no receipts
        assert run.metrics.irr_annual_pct is None
        assert run.metrics.profit_is_unrealised is True
        assert run.metrics.return_on_equity_is_unrealised is True

    def test_the_equity_multiple_is_unavailable_not_zero(self):
        # Audit Sec 6.3: "equity multiple is 0.00x ... Showing it beside a 64.38%
        # ROE can confuse a non-specialist investor." Under spec Sec 3.16.1 there
        # is no realisation event here, so there is no multiple to report.
        run = york_run()
        assert run.model.totals.distributions_pence == 0
        assert run.metrics.has_realisation_event is False
        assert run.metrics.equity_multiple is None
        assert run.metrics.return_on_equity_pct is not None
