"""R15 spec Sec 23. Twin of due-diligence.test.ts."""
from app.financial_model.due_diligence import DD_CATALOGUE, DERIVED_CODES, ENTERED_CODES

# The literal table BOTH test files carry (spec Sec 23.2). A relabelled or
# reordered entry fails here and in due-diligence.test.ts alike.
CATALOGUE_TRIPLES = [
    ("planning_route", "planning", "Planning consent or prior approval", False),
    ("planning_conditions", "planning", "Planning conditions", False),
    ("article_4_direction", "planning", "Article 4 direction", False),
    ("conservation_listed", "planning", "Conservation area and listed status", False),
    ("cil_s106", "planning", "CIL and S106 liability", False),
    ("title_report", "title_occupation", "Report on title", False),
    ("vacant_possession", "title_occupation", "Vacant possession", False),
    ("leases_tenancies", "title_occupation", "Occupational leases and tenancies", False),
    ("rights_of_light", "title_occupation", "Rights of light", False),
    ("party_wall", "title_occupation", "Party wall", False),
    ("structural_survey", "existing_building", "Structural survey", False),
    ("asbestos_survey", "existing_building", "Asbestos survey", False),
    ("measured_survey", "existing_building", "Measured survey", False),
    ("higher_risk_building", "existing_building", "Higher-risk building confirmation", False),
    ("fire_strategy", "existing_building", "Fire strategy", False),
    ("acoustic_thermal", "existing_building", "Acoustic and thermal compliance", False),
    ("services_mande", "existing_building", "Services, drainage and utilities", False),
    ("cost_plan_qs", "construction", "QS cost plan", True),
    ("procurement_contractor", "construction", "Procurement and contractor", False),
    ("warranties_building_control", "construction", "Warranty and building control", False),
    ("insurance", "construction", "Insurance", False),
    ("facility_terms", "finance", "Facility terms", True),
    ("equity_sources", "finance", "Equity sources", True),
    ("sponsor_entity", "finance", "Sponsor entity", False),
    ("tax_basis", "finance", "Tax and VAT basis", True),
    ("sales_evidence", "exit", "Sales evidence", False),
    ("lender_valuation", "exit", "Lender valuation", True),
    ("exit_route_evidence", "exit", "Exit route evidence", False),
]


def test_catalogue_is_exactly_the_spec_sec_23_2_table():
    assert [(e.code, e.category, e.label, e.derived) for e in DD_CATALOGUE] == CATALOGUE_TRIPLES
    assert len(DD_CATALOGUE) == 28


def test_entered_and_derived_partition_the_catalogue():
    assert len(ENTERED_CODES) == 23
    assert set(DERIVED_CODES) == {"cost_plan_qs", "facility_terms", "equity_sources", "tax_basis", "lender_valuation"}
    assert set(ENTERED_CODES).isdisjoint(DERIVED_CODES)
