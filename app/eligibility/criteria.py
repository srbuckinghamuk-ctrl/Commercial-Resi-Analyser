from dataclasses import dataclass

from app.models import PdrClass, UseClass

# Version stamp for the eligibility ruleset. Bump when criteria definitions
# or evaluation logic change, so stored assessments record which rules
# produced them.
RULESET_VERSION = "gpdo-2026-08.1"

# ---------------------------------------------------------------------------
# IMPORTANT — screening baseline only.
#
# The criteria below are a screening-level encoding of the GPDO 2015 (as
# amended) permitted development rights for commercial-to-residential
# conversion. They are NOT a substitute for the legislation itself and may
# lag behind amendments. Every output of this engine must be verified
# against the current GPDO and the local planning authority's position by a
# qualified planning professional before being relied upon. This tool gives
# screening guidance, not planning advice.
# ---------------------------------------------------------------------------

# Criterion categories:
#   "statutory"      — a gate: if the criterion fails, the PDR route is not
#                      available at all (e.g. floor-area cap, Article 4).
#   "prior_approval" — a matter the LPA weighs at prior-approval stage:
#                      failing it is an approvability risk, not loss of the
#                      right itself (e.g. transport, contamination, noise).
CATEGORY_STATUTORY = "statutory"
CATEGORY_PRIOR_APPROVAL = "prior_approval"


@dataclass(frozen=True)
class CriterionDef:
    key: str
    label: str
    applicable_classes: list[PdrClass]
    check_type: str  # "auto" | "semi_auto" | "manual"
    description: str
    category: str = CATEGORY_STATUTORY  # "statutory" | "prior_approval"


FLOOR_AREA_LIMITS: dict[PdrClass, float] = {
    PdrClass.CLASS_MA: 1500.0,
    # Class G retains its statutory 150 sqm cap, but since the Sept 2020
    # use-class reform no use class here routes to it for straight
    # conversions (retail is Class E and routes to Class MA).
    PdrClass.CLASS_G: 150.0,
    PdrClass.CLASS_M: 150.0,
    PdrClass.CLASS_N: 150.0,
    # Class Q (as amended May 2024): 1,000 sqm cumulative floorspace,
    # each dwelling <= 150 sqm, max 10 dwellings.
    PdrClass.CLASS_Q: 1000.0,
}

ALL_CRITERIA: list[CriterionDef] = [
    CriterionDef(
        key="use_class_check",
        label="Property is in applicable use class",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="semi_auto",
        description="Confirm the property's planning use class matches the PDR class requirement.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="floor_area_limit",
        label="Floor area within limit",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description=(
            "Floor area must not exceed the PDR class limit. For Class Q the "
            "limit is 1,000 sq m cumulative, with each dwelling no larger "
            "than 150 sq m and a maximum of 10 dwellings."
        ),
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="class_e_use_period",
        label="Class E use for ≥ 2 continuous years",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description=(
            "Building in Class E use for a continuous period of at least 2 "
            "years before the prior approval application date."
        ),
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="vacancy_period",
        label="Building vacant for ≥ 3 continuous months",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="The building must have been vacant for at least 3 continuous months prior to the application.",
        category=CATEGORY_STATUTORY,
    ),
    # Class MA: a conservation area does NOT block the right — it adds a
    # prior-approval consideration (impact of losing ground-floor
    # commercial use).
    CriterionDef(
        key="conservation_area",
        label="Conservation area considerations",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="semi_auto",
        description=(
            "A conservation area does not block Class MA, but if the site is "
            "in one the LPA will weigh the impact of losing ground-floor "
            "commercial use at prior-approval stage."
        ),
        category=CATEGORY_PRIOR_APPROVAL,
    ),
    # Classes G/M/N: conservation-area location remains a hard exclusion.
    CriterionDef(
        key="conservation_area",
        label="Not in a conservation area",
        applicable_classes=[PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="semi_auto",
        description="The property must not be located in a designated conservation area.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="aonb_national_park",
        label="Not in AONB / National Park / SSSI",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Checked via postcode-based geographic lookup.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="article_4",
        label="Not in Article 4 direction area",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="semi_auto",
        description="Checked against bundled Article 4 dataset. Verify with LPA as dataset may not be exhaustive.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="flood_zone",
        label="Flood risk acceptable",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="manual",
        description=(
            "Flooding risk is a prior-approval matter. Flood zone must be "
            "confirmed on the Environment Agency Flood Map for Planning "
            "(flood-map-for-planning.service.gov.uk). Live EA flood "
            "warnings are surfaced as advisory context only."
        ),
        category=CATEGORY_PRIOR_APPROVAL,
    ),
    CriterionDef(
        key="listed_building",
        label="Not a listed building",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="manual",
        description="User must confirm the building is not Grade I, II*, or II listed.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="natural_light",
        label="Adequate natural light to habitable rooms",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description=(
            "The LPA MUST refuse prior approval if adequate natural light is "
            "not provided to all habitable rooms — effectively decisive."
        ),
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="transport_access",
        label="Adequate transport access",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="Prior-approval matter: transport links and accessibility of the site.",
        category=CATEGORY_PRIOR_APPROVAL,
    ),
    CriterionDef(
        key="contamination",
        label="No contamination risk",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_Q],
        check_type="manual",
        description="Prior-approval matter: contamination risk to future residents.",
        category=CATEGORY_PRIOR_APPROVAL,
    ),
    CriterionDef(
        key="noise_impact",
        label="Noise from nearby commercial premises",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="Impact of noise from nearby commercial premises on future residents.",
        category=CATEGORY_PRIOR_APPROVAL,
    ),
    CriterionDef(
        key="prior_refusal",
        label="Prior approval not refused within 2 years",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="manual",
        description="User must confirm no prior approval application was refused for this property within the past 2 years.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="agricultural_use_period",
        label="Agricultural use for ≥ 10 years",
        applicable_classes=[PdrClass.CLASS_Q],
        check_type="manual",
        description="The building must have been in agricultural use for at least 10 years before the application.",
        category=CATEGORY_STATUTORY,
    ),
    CriterionDef(
        key="agricultural_building_date",
        label="Part of established agricultural unit on or before 24 July 2023",
        applicable_classes=[PdrClass.CLASS_Q],
        check_type="manual",
        description=(
            "The building must have been part of an established agricultural "
            "unit on or before 24 July 2023 (Class Q as amended 2024)."
        ),
        category=CATEGORY_STATUTORY,
    ),
]


def get_criteria_for_class(pdr_class: PdrClass) -> list[CriterionDef]:
    return [c for c in ALL_CRITERIA if pdr_class in c.applicable_classes]


# Use-class → PDR route mapping.
#
# Since 1 September 2020, retail (former A1), restaurants/cafes (former A3)
# and light industrial (former B1c) all sit within Class E, so their PDR
# route to residential is Class MA. Class G's 150 sqm route and Class M's A3
# element (removed August 2021) are obsolete for straight conversions. Hot
# food takeaways remained sui generis and keep the Class M route.
USE_CLASS_TO_PDR: dict[UseClass, PdrClass] = {
    UseClass.OFFICE: PdrClass.CLASS_MA,
    UseClass.RETAIL: PdrClass.CLASS_MA,
    UseClass.RESTAURANT_CAFE: PdrClass.CLASS_MA,
    UseClass.LIGHT_INDUSTRIAL: PdrClass.CLASS_MA,
    UseClass.TAKEAWAY: PdrClass.CLASS_M,
    UseClass.AMUSEMENT: PdrClass.CLASS_N,
    UseClass.LAUNDERETTE: PdrClass.CLASS_N,
    UseClass.AGRICULTURAL: PdrClass.CLASS_Q,
}


def detect_pdr_class(use_class: UseClass, floor_area_sqm: float | None) -> PdrClass | None:
    pdr_class = USE_CLASS_TO_PDR.get(use_class)
    if pdr_class is None:
        return None
    if floor_area_sqm is not None:
        limit = FLOOR_AREA_LIMITS.get(pdr_class)
        if limit and floor_area_sqm > limit:
            return None
    return pdr_class
