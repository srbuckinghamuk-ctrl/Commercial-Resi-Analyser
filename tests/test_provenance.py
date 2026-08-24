"""R14b: the Python governance twin of frontend/src/lib/report-provenance.ts.

Every case here mirrors a case in report-provenance.test.ts (and the R14b
additions Task 6 makes there) so the two engines' governance answers are
pinned against each other case-for-case, the same discipline the metric
engines use. The ordering diagonals matter most: each is a case where a
wrong order would silently produce a *plausible* wrong banner.
"""
from app.financial_model.provenance import (
    ALLOWED_TRANSITIONS,
    APPROVED_STATUSES,
    document_status,
    draft_reason,
    is_stale,
)


class TestDraftReasonOrdering:
    def test_unreconciled_wins_over_everything(self):
        assert draft_reason(
            report_safe=False, senior_repaid=False, lender_case_status=None,
            tax_basis_confirmed=False, vat_basis_confirmed=False,
            lender_case_stale=True,
        ) == "unreconciled"

    def test_senior_not_repaid_is_second(self):
        assert draft_reason(
            report_safe=True, senior_repaid=False, lender_case_status=None,
        ) == "senior_not_repaid"

    def test_tax_gate_sits_above_not_approved(self):
        # The R8 diagonal, now pinned in Python too: with no lender case in
        # existence, not_approved would otherwise win every time and the tax
        # gate would be unreachable dead code.
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status=None,
            tax_basis_confirmed=False,
        ) == "tax_basis_unconfirmed"

    def test_vat_gate_sits_between_tax_and_approval(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status=None,
            vat_basis_confirmed=False,
        ) == "vat_basis_unconfirmed"

    def test_no_case_is_not_approved(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status=None,
        ) == "not_approved"

    def test_unapproved_case_is_not_approved(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status="under_review",
        ) == "not_approved"

    def test_approved_and_current_is_final(self):
        for status in APPROVED_STATUSES:
            assert draft_reason(
                report_safe=True, senior_repaid=True, lender_case_status=status,
            ) is None

    def test_approved_but_stale_is_lender_case_stale(self):
        # The R14b diagonal: an approved case whose document has moved must
        # not print FINAL over figures the lender never saw (spec Sec 21.3).
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
        ) == "lender_case_stale"

    def test_stale_never_outranks_not_approved(self):
        # Mutually exclusive by construction: an UNapproved stale case reports
        # not_approved -- staleness only qualifies an approval that exists.
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="declined", lender_case_stale=True,
        ) == "not_approved"

    def test_stale_never_outranks_the_basis_gates(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
            tax_basis_confirmed=False,
        ) == "tax_basis_unconfirmed"


class TestDocumentStatus:
    def test_final_only_when_no_reason(self):
        assert document_status(
            report_safe=True, senior_repaid=True,
            lender_case_status="approved_with_conditions",
        ) == "FINAL"

    def test_draft_otherwise(self):
        assert document_status(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
        ) == "DRAFT"


class TestStale:
    def test_matching_hash_is_current(self):
        assert is_stale("a" * 64, "a" * 64) is False

    def test_differing_hash_is_stale(self):
        assert is_stale("a" * 64, "b" * 64) is True

    def test_absent_current_hash_is_stale(self):
        # A row stripped of its hash cannot demonstrate it is the approved one.
        assert is_stale(None, "a" * 64) is True


class TestAllowedTransitions:
    def test_the_table_is_exactly_the_spec_sec_21_2_table(self):
        # Restated literally rather than derived, and mirrored literally in
        # report-provenance.test.ts -- the point is that a drive-by edit to
        # either language's table fails a test naming the whole machine.
        assert ALLOWED_TRANSITIONS == {
            "draft": ("submitted", "superseded"),
            "submitted": ("under_review", "superseded"),
            "under_review": (
                "information_required", "credit_approved",
                "approved_with_conditions", "declined", "superseded",
            ),
            "information_required": ("under_review", "superseded"),
            "credit_approved": ("superseded",),
            "approved_with_conditions": ("superseded",),
            "declined": ("superseded",),
            "superseded": (),
        }

    def test_superseded_is_terminal_and_universal(self):
        for status, allowed in ALLOWED_TRANSITIONS.items():
            if status == "superseded":
                assert allowed == ()
            else:
                assert "superseded" in allowed
