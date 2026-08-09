import logging
from dataclasses import dataclass, field

from app.eligibility.criteria import (
    CriterionDef,
    FLOOR_AREA_LIMITS,
    USE_CLASS_TO_PDR,
    detect_pdr_class,
    get_criteria_for_class,
)
from app.integrations.article4 import Article4Result, lookup_article4
from app.integrations.epc import EpcResult, lookup_epc
from app.integrations.flood import FloodRiskResult, lookup_flood_risk
from app.integrations.postcodes import PostcodeLookupResult, lookup_postcode
from app.models import (
    EligibilityCriterion,
    EligibilityVerdict,
    PdrClass,
    Project,
)

logger = logging.getLogger(__name__)


@dataclass
class EligibilityEngineResult:
    pdr_class: PdrClass
    criteria: list[EligibilityCriterion]
    verdict: EligibilityVerdict
    suggested_next_steps: list[str] = field(default_factory=list)


async def run_eligibility(
    project: Project,
    manual_overrides: dict[str, bool | None] | None = None,
    epc_api_key: str = "",
) -> EligibilityEngineResult:
    overrides = manual_overrides or {}

    pdr_class = detect_pdr_class(project.use_class, project.floor_area_sqm)
    if pdr_class is None:
        mapped_class = USE_CLASS_TO_PDR.get(project.use_class)
        if mapped_class is None:
            return EligibilityEngineResult(
                pdr_class=PdrClass.CLASS_MA,
                criteria=[
                    EligibilityCriterion(
                        key="no_pdr_route",
                        label="No PDR route available",
                        passed=False,
                        source="auto",
                        auto_checked=True,
                        value=f"Use class '{project.use_class}' has no applicable Permitted Development Right.",
                    ),
                ],
                verdict=EligibilityVerdict.RED,
                suggested_next_steps=[
                    "Consider a full planning application or verify the property's use class."
                ],
            )
        pdr_class = mapped_class

    criteria_defs = get_criteria_for_class(pdr_class)

    pc_result: PostcodeLookupResult | None = None
    flood_result: FloodRiskResult | None = None
    article4_result: Article4Result | None = None
    epc_result: EpcResult | None = None

    if project.address_postcode:
        pc_result = await lookup_postcode(project.address_postcode)
        if pc_result:
            flood_result = await lookup_flood_risk(
                project.address_postcode, pc_result.latitude, pc_result.longitude
            )
            article4_result = await lookup_article4(pc_result.lpa_code)
        if epc_api_key:
            epc_result = await lookup_epc(
                project.address_postcode,
                address_fragment=project.address_raw,
                api_key=epc_api_key,
            )

    evaluated: list[EligibilityCriterion] = []
    next_steps: list[str] = []

    for cdef in criteria_defs:
        criterion = _evaluate_criterion(
            cdef, project, pdr_class, pc_result, flood_result, article4_result, epc_result, overrides
        )
        evaluated.append(criterion)
        if criterion.passed is None:
            step = _next_step_for(cdef)
            if step:
                next_steps.append(step)

    verdict = _compute_verdict(evaluated)

    return EligibilityEngineResult(
        pdr_class=pdr_class,
        criteria=evaluated,
        verdict=verdict,
        suggested_next_steps=next_steps,
    )


def _evaluate_criterion(
    cdef: CriterionDef,
    project: Project,
    pdr_class: PdrClass,
    pc_result: PostcodeLookupResult | None,
    flood_result: FloodRiskResult | None,
    article4_result: Article4Result | None,
    epc_result: EpcResult | None,
    overrides: dict[str, bool | None],
) -> EligibilityCriterion:
    if cdef.key in overrides:
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=overrides[cdef.key],
            source="user",
            auto_checked=False,
        )

    if cdef.key == "floor_area_limit":
        limit = FLOOR_AREA_LIMITS.get(pdr_class)
        floor_area = project.floor_area_sqm
        source_label = "project"
        if floor_area is None and epc_result and epc_result.floor_area_sqm:
            floor_area = epc_result.floor_area_sqm
            source_label = "EPC"
        if limit and floor_area is not None:
            passed = floor_area <= limit
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=passed,
                source="auto",
                auto_checked=True,
                value=f"{floor_area:.0f} sq m (limit: {limit:.0f} sq m, from {source_label})",
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="auto",
            auto_checked=False,
            value="Floor area not provided",
        )

    if cdef.key == "flood_zone":
        if flood_result:
            passed = not flood_result.in_flood_zone_2_or_3
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=passed,
                source="auto",
                auto_checked=True,
                value=flood_result.flood_zone,
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="auto",
            auto_checked=False,
            value="Could not check — postcode lookup failed",
        )

    if cdef.key == "article_4":
        if article4_result:
            relevant = [
                d
                for d in article4_result.directions
                if pdr_class.value in d.pdr_classes_restricted
            ]
            if relevant:
                return EligibilityCriterion(
                    key=cdef.key,
                    label=cdef.label,
                    passed=None,
                    source="semi_auto",
                    auto_checked=False,
                    value=f"Possible Article 4 direction: {relevant[0].name}",
                    risk_flag="Verify current Article 4 status with the LPA before relying on PDR.",
                )
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=True,
                source="semi_auto",
                auto_checked=True,
                value="No Article 4 direction found in dataset",
                risk_flag="Dataset may not be exhaustive — verify with LPA",
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value="Could not check — postcode lookup failed",
        )

    if cdef.key == "aonb_national_park":
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value=f"Region: {pc_result.region}" if pc_result else "Postcode lookup failed",
            risk_flag="No AONB/National Park boundary data available — confirm with LPA or check Magic Maps",
        )

    if cdef.key == "conservation_area":
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value="Not automatically checkable — confirm with LPA",
        )

    if cdef.key == "use_class_check":
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value=f"Listed as: {project.use_class}",
        )

    return EligibilityCriterion(
        key=cdef.key,
        label=cdef.label,
        passed=None,
        source="manual",
        auto_checked=False,
    )


def _compute_verdict(criteria: list[EligibilityCriterion]) -> EligibilityVerdict:
    has_fail = any(c.passed is False for c in criteria)
    has_pending = any(c.passed is None for c in criteria)
    if has_fail:
        return EligibilityVerdict.RED
    if has_pending:
        return EligibilityVerdict.AMBER
    return EligibilityVerdict.GREEN


NEXT_STEPS: dict[str, str] = {
    "use_class_check": "Confirm the property's current planning use class with the LPA or lease documents.",
    "vacancy_period": "Verify the property has been vacant for at least 3 continuous months with evidence (utility bills, rates records).",
    "conservation_area": "Check with the LPA whether the property is in a conservation area.",
    "listed_building": "Confirm the building is not listed (check Historic England's National Heritage List).",
    "natural_light": "Assess whether habitable rooms will have adequate natural light (site visit recommended).",
    "transport_access": "Assess transport accessibility (proximity to public transport, parking, road access).",
    "contamination": "Check for contamination risk — review environmental reports and site history.",
    "prior_refusal": "Confirm no prior approval application was refused for this property within the past 2 years.",
    "agricultural_use_period": "Verify the building has been in agricultural use for at least 10 continuous years.",
    "agricultural_building_date": "Confirm the agricultural building existed before 20 March 2013.",
    "article_4": "Verify current Article 4 direction status with the local planning authority.",
}


def _next_step_for(cdef: CriterionDef) -> str | None:
    return NEXT_STEPS.get(cdef.key)
