from dataclasses import dataclass

from app.models import PdrClass, UseClass


@dataclass(frozen=True)
class CriterionDef:
    key: str
    label: str
    applicable_classes: list[PdrClass]
    check_type: str  # "auto" | "semi_auto" | "manual"
    description: str


FLOOR_AREA_LIMITS: dict[PdrClass, float] = {
    PdrClass.CLASS_MA: 1500.0,
    PdrClass.CLASS_G: 150.0,
    PdrClass.CLASS_M: 150.0,
    PdrClass.CLASS_N: 150.0,
    PdrClass.CLASS_Q: 465.0,
}

ALL_CRITERIA: list[CriterionDef] = [
    CriterionDef(
        key="use_class_check",
        label="Property is in applicable use class",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="semi_auto",
        description="Confirm the property's planning use class matches the PDR class requirement.",
    ),
    CriterionDef(
        key="floor_area_limit",
        label="Floor area within limit",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Floor area must not exceed the PDR class limit.",
    ),
    CriterionDef(
        key="vacancy_period",
        label="Building vacant for ≥ 3 continuous months",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="The building must have been vacant for at least 3 continuous months prior to the application.",
    ),
    CriterionDef(
        key="conservation_area",
        label="Not in a conservation area",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="semi_auto",
        description="The property must not be located in a designated conservation area.",
    ),
    CriterionDef(
        key="aonb_national_park",
        label="Not in AONB / National Park / SSSI",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Checked via postcode-based geographic lookup.",
    ),
    CriterionDef(
        key="article_4",
        label="Not in Article 4 direction area",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="semi_auto",
        description="Checked against bundled Article 4 dataset. Verify with LPA as dataset may not be exhaustive.",
    ),
    CriterionDef(
        key="flood_zone",
        label="Not in flood zone 2 or 3",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="auto",
        description="Checked via EA Flood Risk API.",
    ),
    CriterionDef(
        key="listed_building",
        label="Not a listed building",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N, PdrClass.CLASS_Q],
        check_type="manual",
        description="User must confirm the building is not Grade I, II*, or II listed.",
    ),
    CriterionDef(
        key="natural_light",
        label="Adequate natural light to habitable rooms",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="User assessment of whether habitable rooms will have adequate natural light.",
    ),
    CriterionDef(
        key="transport_access",
        label="Adequate transport access",
        applicable_classes=[PdrClass.CLASS_MA],
        check_type="manual",
        description="User assessment of transport links and accessibility.",
    ),
    CriterionDef(
        key="contamination",
        label="No contamination risk",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_Q],
        check_type="manual",
        description="User assessment that the site does not pose contamination risk to future residents.",
    ),
    CriterionDef(
        key="prior_refusal",
        label="Prior approval not refused within 2 years",
        applicable_classes=[PdrClass.CLASS_MA, PdrClass.CLASS_G, PdrClass.CLASS_M, PdrClass.CLASS_N],
        check_type="manual",
        description="User must confirm no prior approval application was refused for this property within the past 2 years.",
    ),
    CriterionDef(
        key="agricultural_use_period",
        label="Agricultural use for ≥ 10 years",
        applicable_classes=[PdrClass.CLASS_Q],
        check_type="manual",
        description="The building must have been in agricultural use for at least 10 years before the application.",
    ),
    CriterionDef(
        key="agricultural_building_date",
        label="Building established before 20 March 2013",
        applicable_classes=[PdrClass.CLASS_Q],
        check_type="manual",
        description="The agricultural building must have existed before 20 March 2013.",
    ),
]


def get_criteria_for_class(pdr_class: PdrClass) -> list[CriterionDef]:
    return [c for c in ALL_CRITERIA if pdr_class in c.applicable_classes]


USE_CLASS_TO_PDR: dict[UseClass, PdrClass] = {
    UseClass.OFFICE: PdrClass.CLASS_MA,
    UseClass.RETAIL: PdrClass.CLASS_G,
    UseClass.RESTAURANT_CAFE: PdrClass.CLASS_M,
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
