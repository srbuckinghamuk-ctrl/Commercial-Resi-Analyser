"""Lender-case governance (spec Sec 13.3, Sec 21) -- the Python twin.

Port of the governance core of frontend/src/lib/report-provenance.ts (R14b),
line for line where the languages allow, under the same parity contract as
monitoring.py: a change to either side's rules is made to both in one change,
and tests/test_provenance.py mirrors report-provenance.test.ts case-for-case.

Until R14b this governance lived in TypeScript only; making the lender case
server state with server-enforced transitions is what forced the twin into
existence -- the API cannot validate a state machine that exists only in the
client.
"""
from __future__ import annotations

from typing import Literal

LenderCaseStatus = Literal[
    "draft", "submitted", "under_review", "information_required",
    "credit_approved", "approved_with_conditions", "declined", "superseded",
]

#: The lender-case statuses that permit a FINAL document (spec Sec 13.3).
APPROVED_STATUSES: tuple[str, ...] = ("credit_approved", "approved_with_conditions")

#: Spec Sec 21.2, normative. Keys are the current status; values are every
#: status a transition may move to. `superseded` is the universal exit and is
#: itself terminal. Mirrored literally in report-provenance.ts.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
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

DraftReason = Literal[
    "unreconciled", "senior_not_repaid", "tax_basis_unconfirmed",
    "vat_basis_unconfirmed", "not_approved", "lender_case_stale",
]


def is_stale(current_input_hash: str | None, locked_input_hash: str) -> bool:
    """Spec Sec 21.3. Derived at read time, never stored: the live appraisal
    row's input hash no longer matches the one the case locked. A row with no
    hash at all cannot demonstrate it is the approved document, so it is
    stale too."""
    return current_input_hash != locked_input_hash


def draft_reason(
    *,
    report_safe: bool,
    senior_repaid: bool,
    lender_case_status: str | None,
    tax_basis_confirmed: bool = True,
    vat_basis_confirmed: bool = True,
    lender_case_stale: bool = False,
) -> str | None:
    """Spec Sec 13.3's six conditions, in their load-bearing order -- the port
    of report-provenance.ts's draftReason. See that function's comments for
    why each gate sits where it does; the R14b addition is the last: an
    approved case whose document has moved must not print FINAL over figures
    the lender never saw, and it fires only when an approval exists, so it is
    mutually exclusive with not_approved by construction."""
    if not report_safe:
        return "unreconciled"
    if not senior_repaid:
        return "senior_not_repaid"
    if not tax_basis_confirmed:
        return "tax_basis_unconfirmed"
    if not vat_basis_confirmed:
        return "vat_basis_unconfirmed"
    if lender_case_status is None or lender_case_status not in APPROVED_STATUSES:
        return "not_approved"
    if lender_case_stale:
        return "lender_case_stale"
    return None


def document_status(
    *,
    report_safe: bool,
    senior_repaid: bool,
    lender_case_status: str | None,
    tax_basis_confirmed: bool = True,
    vat_basis_confirmed: bool = True,
    lender_case_stale: bool = False,
) -> str:
    """'FINAL' only when every Sec 13.3 condition holds; 'DRAFT' otherwise."""
    reason = draft_reason(
        report_safe=report_safe,
        senior_repaid=senior_repaid,
        lender_case_status=lender_case_status,
        tax_basis_confirmed=tax_basis_confirmed,
        vat_basis_confirmed=vat_basis_confirmed,
        lender_case_stale=lender_case_stale,
    )
    return "FINAL" if reason is None else "DRAFT"
