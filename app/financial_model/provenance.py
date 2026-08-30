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

from typing import Any, Literal

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

#: R17 (spec Sec 21.2 amended, design Sec 10.3), normative. Which roles may
#: move a case INTO each status; creation (-> draft) is CREATE_ROLES. The
#: server enforces this table; report-provenance.ts mirrors it literally for
#: the UI's buttons only, pinned by tests restating the whole table in both
#: languages. `superseded` is any authenticated role, so its row is the full
#: role set rather than an "any" sentinel -- a sentinel would need a second
#: rule to interpret it, and the full set is what the sentinel would mean.
ROLE_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "submitted": ("developer", "broker", "administrator"),
    "under_review": ("underwriter", "credit_approver"),
    "information_required": ("underwriter", "credit_approver"),
    "credit_approved": ("credit_approver",),
    "approved_with_conditions": ("credit_approver",),
    "declined": ("credit_approver",),
    "superseded": ("developer", "broker", "underwriter", "credit_approver", "administrator"),
}

#: Who may open a case (-> draft). Same row as `-> submitted`, stated
#: separately because creation is not a transition in ALLOWED_TRANSITIONS.
CREATE_ROLES: tuple[str, ...] = ("developer", "broker", "administrator")

#: The three statuses maker-checker guards (design decision 6).
DECISION_STATUSES: tuple[str, ...] = ("credit_approved", "approved_with_conditions", "declined")


def can_transition(role: str, to_status: str) -> bool:
    """True when `role` may move a case into `to_status` under
    ROLE_TRANSITIONS. Says nothing about whether the move is legal from the
    current status (ALLOWED_TRANSITIONS) or about maker-checker, which are
    the endpoint's next two checks."""
    return role in ROLE_TRANSITIONS.get(to_status, ())


def due_diligence_complete(dd_result: Any) -> bool:
    """Spec Sec 23.7's seventh FINAL condition, read off the computed
    due-diligence result: no ENTERED item still `unknown` (a derived row's
    unknown is a fact about another block, never gathered evidence) and --
    R17, spec Sec 23.5 amended, design decision 12 -- no source-field
    conflict left without an evidenced resolution. Both counts are the
    engine's own (`due_diligence.py`); this reads, it does not derive. A
    caller with no due-diligence result at all (a pre-v13 document) passes
    None and is complete, the R8 exemption `dueDiligenceGateFor` applies.
    Port of report-provenance.ts's `dueDiligenceGateFor`."""
    if dd_result is None:
        return True
    return (
        dd_result.totals.entered_unknown_count == 0
        and getattr(dd_result, "unresolved_source_conflicts", 0) == 0
    )


DraftReason = Literal[
    "unreconciled", "senior_not_repaid", "tax_basis_unconfirmed",
    "vat_basis_unconfirmed", "due_diligence_incomplete", "not_approved",
    "lender_case_stale",
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
    due_diligence_complete: bool = True,
) -> str | None:
    """Spec Sec 13.3's seven conditions, in their load-bearing order -- the
    port of report-provenance.ts's draftReason. See that function's comments
    for why each gate sits where it does; the R14b addition is the last: an
    approved case whose document has moved must not print FINAL over figures
    the lender never saw, and it fires only when an approval exists, so it is
    mutually exclusive with not_approved by construction.

    The R15 addition (spec Sec 23.7) sits after the VAT gate and before the
    approval check: an entered-and-unknown due-diligence item does not make a
    figure wrong, so it must not outrank the two reasons that say figures may
    be (tax_basis_unconfirmed, vat_basis_unconfirmed) -- but it must outrank
    not_approved, because a credit committee reading an approval over an
    unevidenced title, lease or consent is the same failure the stale-case
    gate exists to catch: a FINAL banner over something the lender never
    actually saw confirmed."""
    if not report_safe:
        return "unreconciled"
    if not senior_repaid:
        return "senior_not_repaid"
    if not tax_basis_confirmed:
        return "tax_basis_unconfirmed"
    if not vat_basis_confirmed:
        return "vat_basis_unconfirmed"
    if not due_diligence_complete:
        return "due_diligence_incomplete"
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
    due_diligence_complete: bool = True,
) -> str:
    """'FINAL' only when every Sec 13.3 condition holds; 'DRAFT' otherwise."""
    reason = draft_reason(
        report_safe=report_safe,
        senior_repaid=senior_repaid,
        lender_case_status=lender_case_status,
        tax_basis_confirmed=tax_basis_confirmed,
        vat_basis_confirmed=vat_basis_confirmed,
        lender_case_stale=lender_case_stale,
        due_diligence_complete=due_diligence_complete,
    )
    return "FINAL" if reason is None else "DRAFT"
