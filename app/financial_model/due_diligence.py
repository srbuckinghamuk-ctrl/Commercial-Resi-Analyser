"""R15 spec Sec 23. The due-diligence evidence schedule.

Port of frontend/src/lib/model/due-diligence.ts. Task 1 declares the
catalogue; Task 2 adds the seed builder; Task 3 adds the derivation. It never
imports schedule or metrics (they import it)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .types import DdItem

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
