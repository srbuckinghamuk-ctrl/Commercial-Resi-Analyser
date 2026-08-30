"""R14b: the Python governance twin of frontend/src/lib/report-provenance.ts.

Every case here mirrors a case in report-provenance.test.ts (and the R14b
additions Task 6 makes there) so the two engines' governance answers are
pinned against each other case-for-case, the same discipline the metric
engines use. The ordering diagonals matter most: each is a case where a
wrong order would silently produce a *plausible* wrong banner.
"""
from datetime import datetime, timezone
import hashlib

from app.financial_model.provenance import (
    ALLOWED_TRANSITIONS,
    CREATE_ROLES,
    ROLE_TRANSITIONS,
    can_transition,
    APPROVED_STATUSES,
    document_status,
    draft_reason,
    due_diligence_complete,
    is_stale,
)
from app.financial_model.hashing import case_hash, _utc_iso
from app.financial_model import run_appraisal
from app.financial_model.due_diligence import DdTotals, DueDiligenceResult
from app.financial_model.types import SourceClaims, SourceConflictResolution, SourceEvidenceRecord

from .fixtures_due_diligence import dd_doc


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
        # R15: stale must not outrank the due-diligence gate either -- an
        # unevidenced document is exactly the same failure mode as an approval
        # read over a moved document, so the earlier-seated gate wins.
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
            due_diligence_complete=False,
        ) == "due_diligence_incomplete"

    def test_due_diligence_gate_sits_between_vat_and_approval(self):
        # R15, spec Sec 23.7. An unknown due-diligence item does not make a
        # figure wrong, so it must not outrank the two reasons that say
        # figures may be (tax/VAT basis unconfirmed); it must outrank
        # not_approved because an approval read over unevidenced title is the
        # stale case's cousin -- both print FINAL over something the lender
        # never actually saw confirmed.
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved",
            due_diligence_complete=False,
        ) == "due_diligence_incomplete"
        # No lender case at all: due_diligence_incomplete still wins over
        # not_approved -- the diagonal that makes the gate's position a
        # decision rather than dead code.
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status=None,
            due_diligence_complete=False,
        ) == "due_diligence_incomplete"
        # A more fundamental basis gate still outranks it.
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved",
            vat_basis_confirmed=False, due_diligence_complete=False,
        ) == "vat_basis_unconfirmed"


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


class TestRoleTransitions:
    def test_the_table_is_exactly_the_design_sec_10_3_table(self):
        # R17. Restated literally and mirrored literally in
        # report-provenance.test.ts, the ALLOWED_TRANSITIONS discipline.
        assert ROLE_TRANSITIONS == {
            "submitted": ("developer", "broker", "administrator"),
            "under_review": ("underwriter", "credit_approver"),
            "information_required": ("underwriter", "credit_approver"),
            "credit_approved": ("credit_approver",),
            "approved_with_conditions": ("credit_approver",),
            "declined": ("credit_approver",),
            "superseded": (
                "developer", "broker", "underwriter", "credit_approver", "administrator",
            ),
        }
        assert CREATE_ROLES == ("developer", "broker", "administrator")

    def test_every_non_draft_status_has_a_row(self):
        assert set(ROLE_TRANSITIONS) == set(ALLOWED_TRANSITIONS) - {"draft"}

    def test_can_transition_reads_the_table_and_nothing_else(self):
        assert can_transition("developer", "submitted")
        assert not can_transition("developer", "under_review")
        assert not can_transition("underwriter", "credit_approved")
        assert can_transition("credit_approver", "declined")
        assert can_transition("broker", "superseded")
        assert not can_transition("administrator", "draft")
        assert not can_transition("viewer", "superseded")


class TestCaseHash:
    def test_recomputable_from_the_printed_parts(self):
        # Spec Sec 21.4: derived here independently -- sha256 over the joined
        # tuple -- rather than by calling the helper's own internals, the
        # same discipline test_audit_hash_binds_inputs_outputs_and_status
        # uses for the audit hash.
        decided = datetime(2026, 8, 24, 12, 30, 45, 123456, tzinfo=timezone.utc)
        value = case_hash(
            case_id="c1", project_id="p1", status="credit_approved",
            submitted_by="S. Sponsor", reviewer="R. Reviewer",
            decided_by="D. Director", decided_at=decided,
            locked_audit_hash="e" * 64,
        )
        expected = hashlib.sha256("|".join([
            "c1", "p1", "credit_approved", "S. Sponsor", "R. Reviewer",
            "D. Director", "2026-08-24T12:30:45.123456Z", "e" * 64,
        ]).encode()).hexdigest()
        assert value == expected

    def test_absent_parts_encode_as_empty_strings(self):
        value = case_hash(
            case_id="c1", project_id="p1", status="draft",
            submitted_by=None, reviewer=None, decided_by=None,
            decided_at=None, locked_audit_hash="e" * 64,
        )
        expected = hashlib.sha256(
            ("c1|p1|draft||||" + "|" + "e" * 64).encode()
        ).hexdigest()
        assert value == expected

    def test_moves_with_status_alone(self):
        common = dict(
            case_id="c1", project_id="p1", submitted_by=None, reviewer=None,
            decided_by=None, decided_at=None, locked_audit_hash="e" * 64,
        )
        assert case_hash(status="draft", **common) != case_hash(status="submitted", **common)

    def test_naive_and_aware_utc_datetimes_hash_identically(self):
        # sqlite hands back naive datetimes for DateTime(timezone=True)
        # columns; the write path hashes the aware value it just built. The
        # canonicaliser treats naive as UTC so a re-read recomputation agrees
        # byte for byte with the write-time value.
        aware = datetime(2026, 8, 24, 12, 30, 45, 123456, tzinfo=timezone.utc)
        naive = datetime(2026, 8, 24, 12, 30, 45, 123456)
        assert _utc_iso(aware) == _utc_iso(naive) == "2026-08-24T12:30:45.123456Z"
        assert _utc_iso(None) == ""


class TestDueDiligenceComplete:
    """R17 (spec Sec 23.5 amended, design decision 12). The gate's second
    count: two source records disagreeing on a claim, with no evidenced
    resolution, hold the document in DRAFT under the SAME reason the unknown
    items do. Twin of report-provenance.test.ts's 'R17 -- the source-conflict
    half of the due-diligence gate'."""

    EVIDENCE = {"source": "Site solicitor", "reference": "Report ref 1", "date": "2026-08-01"}

    @classmethod
    def _evidenced(cls):
        return dd_doc({
            "status": {"cil_s106": "green", "leases_tenancies": "green", "fire_strategy": "green"},
            "evidence": {"cil_s106": cls.EVIDENCE, "leases_tenancies": cls.EVIDENCE, "fire_strategy": cls.EVIDENCE},
        })

    @staticmethod
    def _record(record_id, kind, existing_use):
        return SourceEvidenceRecord(
            id=record_id, kind=kind, captured_at="2026-08-01", reference=f"ref {record_id}",
            captured_by="tester", claims=SourceClaims(existing_use=existing_use),
        )

    def _with_records(self, records, resolutions):
        doc = self._evidenced()
        doc.due_diligence.source_records = list(records)
        doc.due_diligence.source_resolutions = list(resolutions)
        return doc

    def _conflicting(self):
        return [
            self._record("rec-1", "listing_structured", "office"),
            self._record("rec-2", "measured_survey", "retail"),
        ]

    def test_reads_both_counts_and_treats_no_result_as_complete(self):
        assert due_diligence_complete(None) is True
        assert due_diligence_complete(DueDiligenceResult(totals=DdTotals(entered_unknown_count=0))) is True
        assert due_diligence_complete(DueDiligenceResult(totals=DdTotals(entered_unknown_count=1))) is False
        assert due_diligence_complete(DueDiligenceResult(
            totals=DdTotals(entered_unknown_count=0), unresolved_source_conflicts=1,
        )) is False

    def test_two_conflicting_records_without_a_resolution_hold_the_document_in_draft(self):
        run = run_appraisal(self._with_records(self._conflicting(), []))
        dd = run.metrics.due_diligence
        assert dd.totals.entered_unknown_count == 0
        assert dd.unresolved_source_conflicts == 1
        assert due_diligence_complete(dd) is False
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status="credit_approved",
            due_diligence_complete=due_diligence_complete(dd),
        ) == "due_diligence_incomplete"

    def test_an_evidenced_resolution_closes_the_gate(self):
        resolution = SourceConflictResolution(
            id="res-1", field="existing_use", resolved_value="office", chosen_record_id="rec-1",
            evidence_reference="Survey p.3", resolved_by="tester", resolved_at="2026-08-02", reason="measured",
        )
        run = run_appraisal(self._with_records(self._conflicting(), [resolution]))
        dd = run.metrics.due_diligence
        assert dd.unresolved_source_conflicts == 0
        assert due_diligence_complete(dd) is True
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status="credit_approved",
            due_diligence_complete=due_diligence_complete(dd),
        ) is None
