"""R15 spec Sec 23. The due-diligence evidence schedule.

Port of frontend/src/lib/model/due-diligence.ts. Task 1 declares the
catalogue; Task 2 adds the seed builder; Task 3 adds the derivation. It never
imports schedule or metrics (they import it)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .acquisition_tax import AcquisitionTaxResult
from .cost_plan import CostPlanResult
from .engine import ModelFlag, pct
from .programme import is_programme_network
from .schedule import Schedule
from .types import DdItem
from .vat import VatResult, vat_basis_confirmed

DD_CATEGORIES: tuple[str, ...] = (
    "planning", "title_occupation", "existing_building", "construction", "finance", "exit",
)
DD_STATUSES: tuple[str, ...] = ("red", "amber", "green", "unknown", "not_applicable")


@dataclass(frozen=True)
class DdCatalogueEntry:
    code: str
    category: str
    label: str
    derived: bool


#: Spec Sec 23.2, normative and ORDERED. Pinned byte-identical against
#: due-diligence.ts by test_financial_model_due_diligence.py (Sec 21.2's
#: ALLOWED_TRANSITIONS precedent).
DD_CATALOGUE: tuple[DdCatalogueEntry, ...] = (
    DdCatalogueEntry("planning_route", "planning", "Planning consent or prior approval", False),
    DdCatalogueEntry("planning_conditions", "planning", "Planning conditions", False),
    DdCatalogueEntry("article_4_direction", "planning", "Article 4 direction", False),
    DdCatalogueEntry("conservation_listed", "planning", "Conservation area and listed status", False),
    DdCatalogueEntry("cil_s106", "planning", "CIL and S106 liability", False),
    DdCatalogueEntry("title_report", "title_occupation", "Report on title", False),
    DdCatalogueEntry("vacant_possession", "title_occupation", "Vacant possession", False),
    DdCatalogueEntry("leases_tenancies", "title_occupation", "Occupational leases and tenancies", False),
    DdCatalogueEntry("rights_of_light", "title_occupation", "Rights of light", False),
    DdCatalogueEntry("party_wall", "title_occupation", "Party wall", False),
    DdCatalogueEntry("structural_survey", "existing_building", "Structural survey", False),
    DdCatalogueEntry("asbestos_survey", "existing_building", "Asbestos survey", False),
    DdCatalogueEntry("measured_survey", "existing_building", "Measured survey", False),
    DdCatalogueEntry("higher_risk_building", "existing_building", "Higher-risk building confirmation", False),
    DdCatalogueEntry("fire_strategy", "existing_building", "Fire strategy", False),
    DdCatalogueEntry("acoustic_thermal", "existing_building", "Acoustic and thermal compliance", False),
    DdCatalogueEntry("services_mande", "existing_building", "Services, drainage and utilities", False),
    DdCatalogueEntry("cost_plan_qs", "construction", "QS cost plan", True),
    DdCatalogueEntry("procurement_contractor", "construction", "Procurement and contractor", False),
    DdCatalogueEntry("warranties_building_control", "construction", "Warranty and building control", False),
    DdCatalogueEntry("insurance", "construction", "Insurance", False),
    DdCatalogueEntry("facility_terms", "finance", "Facility terms", True),
    DdCatalogueEntry("equity_sources", "finance", "Equity sources", True),
    DdCatalogueEntry("sponsor_entity", "finance", "Sponsor entity", False),
    DdCatalogueEntry("tax_basis", "finance", "Tax and VAT basis", True),
    DdCatalogueEntry("sales_evidence", "exit", "Sales evidence", False),
    DdCatalogueEntry("lender_valuation", "exit", "Lender valuation", True),
    DdCatalogueEntry("exit_route_evidence", "exit", "Exit route evidence", False),
)

ENTERED_CODES: tuple[str, ...] = tuple(e.code for e in DD_CATALOGUE if not e.derived)
DERIVED_CODES: tuple[str, ...] = tuple(e.code for e in DD_CATALOGUE if e.derived)


def seed_items() -> list[DdItem]:
    """R15 spec Sec 23.10's seed: every ENTERED catalogue item `unknown`, ids
    deterministic (`dd-<code>`) so the migration is reproducible. Port of the
    `items` half of defaultDueDiligence."""
    return [
        DdItem(
            id=f"dd-{e.code}", code=e.code, category=e.category, label="",
            status="unknown", evidence=None, expiry_date=None, owner="",
            due_date=None, cost_impact_pence=None, programme_impact_months=None,
            action="", notes="",
        )
        for e in DD_CATALOGUE if not e.derived
    ]


def default_due_diligence() -> dict[str, Any]:
    """R15 spec Sec 23.10's seed document: no source record captured, every
    entered item unknown. Port of defaultDueDiligence. Returns a plain dict
    (this module's dict-level convention -- migrate.py validates the final
    output)."""
    return {
        "source_record": None,
        "items": [item.model_dump(mode="json") for item in seed_items()],
    }


# --- R15 spec Sec 23.3/Sec 23.4: the derivation ------------------------------


def months_between(a: str, b: str) -> int:
    """Whole months from ISO date a to ISO date b, floored (spec Sec 23.9)."""
    ya, ma, da = (int(x) for x in a.split("-"))
    yb, mb, db = (int(x) for x in b.split("-"))
    return (yb - ya) * 12 + (mb - ma) - (1 if db < da else 0)


def construction_start_month(inputs: Any, schedule: Schedule) -> int:
    """Spec Sec 23.9: the resolved start of the phase carrying construction spend
    (network), else the legacy construction package's start_offset, else 0."""
    programme = getattr(inputs, "programme", None)
    if programme is None:
        return 0
    if is_programme_network(programme):
        if schedule.programme is None:
            return 0
        wanted = programme.category_phase_ids.construction
        for p in schedule.programme.phases:
            if p.id == wanted:
                return p.start_month
        return 0
    return programme.packages.construction.start_offset


@dataclass
class DdRow:
    """One line of the schedule. `kind` says where the status came from:
    'entered' and 'custom' rows read `items[]`; a 'derived' row reads the field
    named in `source` and is never editable here (spec Sec 23.2)."""

    id: str
    code: str
    category: str
    label: str
    kind: str                       # 'entered' | 'custom' | 'derived'
    status: str
    evidence: dict[str, str] | None
    expiry_date: str | None
    owner: str
    due_date: str | None
    cost_impact_pence: int | None
    programme_impact_months: int | None
    action: str
    notes: str
    source: str | None              # derived rows: the field read


@dataclass
class DdCategorySummary:
    category: str
    red: int = 0
    amber: int = 0
    green: int = 0
    unknown: int = 0
    not_applicable: int = 0
    total: int = 0


@dataclass
class DdTotals:
    red: int = 0
    amber: int = 0
    green: int = 0
    unknown: int = 0
    not_applicable: int = 0
    total: int = 0
    # ENTERED rows only (spec Sec 23.4): a derived row's `unknown` is a fact
    # about another block's inputs, not evidence anyone can go and gather here.
    entered_unknown_count: int = 0
    addressed_pct: float | None = None
    cost_impact_total_pence: int = 0
    programme_impact_max_months: int | None = None
    unassessed_impact_count: int = 0
    # R15 Task 8 fix round 1 (I1). The three counts the REPORT prints, published
    # here rather than counted by each surface: a report generator that filters
    # `rows` itself is a second implementation of a count (spec Sec 11.9), and
    # the two engines' reports would be free to disagree about the same
    # document. `entered_total` is also the denominator of the flag message
    # ("N of M entered items unknown"), so message and memo read one field.
    entered_total: int = 0
    # Red plus amber over ALL rows -- the rows carrying an assessment.
    assessed_count: int = 0
    # Assessed rows with a NON-NULL cost_impact_pence: exactly the set
    # `cost_impact_total_pence` sums, so "stated cost impact X across N items"
    # counts the rows the total is made of.
    stated_impact_count: int = 0
    # I2. Unknown over DERIVED rows. The report's Sec 13 limitation is worded
    # over entered items, and a derived row left unknown must not be silently
    # covered by "every item is evidenced" -- so it is stated separately.
    derived_unknown_count: int = 0
    # R15 Task 9 fix round 1. The numerator `addressed_pct` is taken over, and
    # the count the Due Diligence page's coverage line prints ("N of M
    # addressed"). Published rather than left to each surface to work out as
    # `entered_total - entered_unknown_count`: a subtraction in a component is
    # a second implementation of a count (spec Sec 11.9), and the page and the
    # percentage would be free to disagree about the same document.
    entered_addressed_count: int = 0


@dataclass
class DdSourceConflict:
    rule: str          # 'occupation' | 'existing_area'
    statement: str


@dataclass
class DdConsentExpiry:
    expiry_month: int
    construction_start_month: int
    expires_before_start: bool


@dataclass
class DueDiligenceResult:
    rows: list[DdRow] = field(default_factory=list)
    categories: list[DdCategorySummary] = field(default_factory=list)
    totals: DdTotals = field(default_factory=DdTotals)
    source_record: dict[str, Any] | None = None
    source_conflicts: list[DdSourceConflict] = field(default_factory=list)
    consent_expiry: DdConsentExpiry | None = None


OCCUPATION_CONFLICT = (
    "source conflict: the listing records the property as occupied; vacant possession is marked "
    "green - evidence the surrender or correct the status"
)
EXISTING_AREA_CONFLICT = (
    "source conflict: the listing floor area and the entered existing GIA differ by more than 25%"
)


def _seed_items() -> list[DdItem]:
    """Sec 23.10's seed, as the derivation's pre-v13 fallback. Delegates to
    seed_items() rather than restating the list -- one seed, one definition."""
    return seed_items()


def _derived_status(
    code: str, inputs: Any, cost_plan: CostPlanResult, vat: VatResult,
    acquisition_tax: AcquisitionTaxResult,
) -> tuple[str, str, dict[str, str] | None]:
    """(status, source, evidence) per spec Sec 23.3's table."""
    if code == "cost_plan_qs":
        qs = getattr(getattr(inputs, "cost_plan", None), "qs", None)
        if cost_plan.mode != "detailed" or qs is None:
            return "unknown", "cost_plan.qs", None
        ev = {"source": qs.source, "reference": f"{qs.stage} / {qs.status}", "date": qs.date}
        return ("amber" if qs.status == "draft" else "green"), "cost_plan.qs", ev
    if code == "facility_terms":
        confirm = inputs.finance.requires_confirmation
        return ("unknown" if confirm else "green"), "finance.requires_confirmation", None
    if code == "equity_sources":
        statuses = [e.evidence_status for e in inputs.equity_sources]
        if any(s == "rejected" for s in statuses):
            status = "red"
        elif any(s == "unconfirmed" for s in statuses):
            status = "unknown"
        else:
            status = "green"
        counts = {s: statuses.count(s) for s in ("confirmed", "unconfirmed", "rejected")}
        ev = {
            "source": "equity_sources",
            "reference": ", ".join(f"{k}: {v}" for k, v in counts.items()),
            "date": "",
        }
        return status, "equity_sources[].evidence_status", ev
    if code == "tax_basis":
        acq = inputs.acquisition
        confirmed = (
            getattr(acq, "jurisdiction_evidence_status", None) == "confirmed"
            and acquisition_tax.date_basis == "transaction_date"
            and vat_basis_confirmed(vat)
        )
        ev = {
            "source": str(getattr(acq, "jurisdiction_source", "")),
            "reference": acquisition_tax.jurisdiction,
            "date": acquisition_tax.band_set_effective_from,
        }
        return ("green" if confirmed else "unknown"), "acquisition.jurisdiction_evidence_status + vat", ev
    if code == "lender_valuation":
        lv = getattr(inputs, "lender_valuation", None)
        if lv is None:
            return "unknown", "lender_valuation", None
        return "green", "lender_valuation", {"source": lv.author, "reference": lv.reason, "date": lv.date}
    raise ValueError(code)


def _row_from_item(item: Any, label: str, kind: str) -> DdRow:
    return DdRow(
        id=item.id, code=item.code, category=item.category, label=label, kind=kind,
        status=item.status,
        evidence=None if item.evidence is None else item.evidence.model_dump(mode="json"),
        expiry_date=item.expiry_date, owner=item.owner, due_date=item.due_date,
        cost_impact_pence=item.cost_impact_pence,
        programme_impact_months=item.programme_impact_months,
        action=item.action, notes=item.notes, source=None,
    )


def compute_due_diligence(
    inputs: Any, cost_plan: CostPlanResult, vat: VatResult,
    acquisition_tax: AcquisitionTaxResult, schedule: Schedule,
) -> DueDiligenceResult:
    """Spec Sec 23.3/Sec 23.4. Pure: reads the document plus the three already-
    computed results the derived rows grade against, and returns the schedule.
    A pre-v13 document has no `due_diligence` block, so it is read as Sec
    23.10's SEED -- 23 unknown entered rows -- and not as an empty schedule,
    which would read as "there is nothing to evidence"."""
    dd = getattr(inputs, "due_diligence", None)
    items = list(dd.items) if dd is not None else _seed_items()
    source_record = dd.source_record if dd is not None else None
    by_code = {i.code: i for i in items if i.code != "custom"}

    rows: list[DdRow] = []
    for entry in DD_CATALOGUE:
        if entry.derived:
            status, source, ev = _derived_status(entry.code, inputs, cost_plan, vat, acquisition_tax)
            rows.append(DdRow(
                id=f"dd-{entry.code}", code=entry.code, category=entry.category, label=entry.label,
                kind="derived", status=status, evidence=ev, expiry_date=None, owner="",
                due_date=None, cost_impact_pence=None, programme_impact_months=None,
                action="", notes="", source=source,
            ))
            continue
        item = by_code.get(entry.code)
        if item is None:
            continue   # validation rule 1 reports it; the dashboard cannot invent a row
        rows.append(_row_from_item(item, entry.label, "entered"))
    for item in items:
        if item.code == "custom":
            rows.append(_row_from_item(item, item.label, "custom"))

    categories = [DdCategorySummary(category=c) for c in DD_CATEGORIES]
    by_cat = {c.category: c for c in categories}
    totals = DdTotals()
    entered_rows = [r for r in rows if r.kind != "derived"]
    for r in rows:
        for target in (by_cat[r.category], totals):
            setattr(target, r.status, getattr(target, r.status) + 1)
            target.total += 1
    totals.entered_unknown_count = sum(1 for r in entered_rows if r.status == "unknown")
    totals.addressed_pct = pct(len(entered_rows) - totals.entered_unknown_count, len(entered_rows))
    # Sec 23.4: only an ASSESSED row (red or amber) carries an impact into the
    # totals -- a green row with a stale figure on it contributes nothing.
    assessed = [r for r in rows if r.status in ("red", "amber")]
    totals.cost_impact_total_pence = sum(
        r.cost_impact_pence for r in assessed if r.cost_impact_pence is not None
    )
    months = [r.programme_impact_months for r in assessed if r.programme_impact_months is not None]
    totals.programme_impact_max_months = max(months) if months else None
    totals.unassessed_impact_count = sum(
        1 for r in assessed if r.cost_impact_pence is None or r.programme_impact_months is None
    )
    # R15 Task 8 fix round 1 (I1/I2). Counted here, where every other total is,
    # from the same `rows`/`entered_rows`/`assessed` partitions above.
    totals.entered_total = len(entered_rows)
    totals.assessed_count = len(assessed)
    totals.stated_impact_count = sum(1 for r in assessed if r.cost_impact_pence is not None)
    totals.derived_unknown_count = sum(
        1 for r in rows if r.kind == "derived" and r.status == "unknown"
    )
    # A projection of `entered_rows`, not `entered_total - entered_unknown_count`:
    # counted from the same partition every other total above is counted from.
    totals.entered_addressed_count = sum(1 for r in entered_rows if r.status != "unknown")

    conflicts: list[DdSourceConflict] = []
    if source_record is not None:
        vp = by_code.get("vacant_possession")
        if source_record.is_vacant is False and vp is not None and vp.status == "green":
            conflicts.append(DdSourceConflict("occupation", OCCUPATION_CONFLICT))
        listing = source_record.floor_area_sqm
        existing = getattr(getattr(inputs, "areas", None), "existing_gia_sqm", 0) or 0
        # STRICT: exactly 25% does not fire. Multiplied out rather than divided
        # so the comparison never rests on a float quotient's last bit.
        if listing is not None and listing > 0 and existing > 0 and abs(existing - listing) * 4 > listing:
            conflicts.append(DdSourceConflict("existing_area", EXISTING_AREA_CONFLICT))

    consent: DdConsentExpiry | None = None
    planning = by_code.get("planning_route")
    acq_date = getattr(inputs.acquisition, "acquisition_date", None)
    # R15 fix wave (I1). BLANK-AFTER-TRIM is absence, exactly as validation's
    # `_is_unreal_date` reads it (spec Sec 23.9 rule 5): a whitespace-only
    # expiry raises no validation error, so it must not reach months_between,
    # which would split "  " and raise ValueError on an HTTP request path (the
    # TS twin would yield NaN). `acq_date` is trimmed the same way defensively
    # -- one absence rule for both dates the consent block reads.
    expiry = planning.expiry_date if planning is not None else None
    if expiry is not None and expiry.strip() != "" and acq_date is not None and acq_date.strip() != "":
        expiry_month = months_between(acq_date, expiry)
        start = construction_start_month(inputs, schedule)
        consent = DdConsentExpiry(expiry_month, start, expiry_month < start)

    return DueDiligenceResult(
        rows=rows, categories=categories, totals=totals,
        source_record=None if source_record is None else source_record.model_dump(mode="json"),
        source_conflicts=conflicts, consent_expiry=consent,
    )


def due_diligence_flags(result: DueDiligenceResult, cost_plan: CostPlanResult) -> list[ModelFlag]:
    """Spec Sec 23.9's flag table. Pure; mirrors dueDiligenceFlags. Defined
    here and CALLED from metrics.py (Task 5) -- this module is never imported
    by the engine modules it reads results from."""
    out: list[ModelFlag] = []
    t = result.totals
    # R15 Task 8 fix round 1 (I1): the denominator is the published count, not
    # a second partition of `rows` taken here -- the memo's Sec 13 limitation
    # prints the same "N of M" and now reads the identical field.
    entered = t.entered_total
    if t.entered_unknown_count > 0:
        out.append(ModelFlag(
            code="due_diligence_unknown", severity="amber", month=None, amount_pence=None,
            message=(
                f"due diligence: {t.entered_unknown_count} of {entered} entered items unknown "
                "- unknown is never treated as green"
            ),
        ))
    for c in result.source_conflicts:
        out.append(ModelFlag(
            code="source_conflict", severity="red", month=None, amount_pence=None,
            message=c.statement,
        ))
    ce = result.consent_expiry
    if ce is not None and ce.expires_before_start:
        out.append(ModelFlag(
            code="consent_expires_before_start", severity="red", month=ce.expiry_month,
            amount_pence=None,
            message=(
                f"planning consent lapses at month {ce.expiry_month}, before construction "
                f"starts at month {ce.construction_start_month}"
            ),
        ))
    pb = cost_plan.price_basis
    if pb is not None and pb.provisional_sums_pence > 0:
        out.append(ModelFlag(
            code="provisional_sums_present", severity="amber", month=None,
            amount_pence=pb.provisional_sums_pence,
            message=f"provisional sums are present in the cost plan: {pb.provisional_sums_pence}p",
        ))
    # R15b spec Sec 24.7. A QS record with no tender-price inflation
    # allowance, where the calendar IS known (a resolved acquisition date, so
    # latest_midpoint_months_from_base is not None) and at least one package
    # spend midpoint falls after the base date.
    # latest_midpoint_months_from_base is None whenever acquisition_date is
    # None (Task 2) -- that is this flag's own "skipped" arm, not a separate
    # guard. `> 0` (not `>= 0`): a base date at or after every midpoint clamps
    # the figure to exactly 0 (compute_cost_plan's own floor), which reads as
    # "nothing to inflate", not "record an allowance". `cost_plan.qs` is the
    # republished dict (model_dump(mode="json")), so read through
    # `.get("inflation")`, not attribute access.
    qs = cost_plan.qs
    if (
        cost_plan.mode == "detailed"
        and qs is not None
        and qs.get("inflation") is None
        and cost_plan.latest_midpoint_months_from_base is not None
        and cost_plan.latest_midpoint_months_from_base > 0
    ):
        # Published in Task 2; no arithmetic here -- the flag prints the same
        # whole-month figure the memo does, never a re-floored copy of the float.
        months = cost_plan.latest_midpoint_whole_months_from_base
        out.append(ModelFlag(
            code="no_inflation_allowance", severity="amber",
            month=math.floor(cost_plan.latest_midpoint_month),
            amount_pence=None,
            message=(
                f"no tender-price inflation allowance recorded: priced at {qs['base_date']}; "
                f"package spend midpoints fall up to {months} whole months later"
            ),
        ))
    return out
