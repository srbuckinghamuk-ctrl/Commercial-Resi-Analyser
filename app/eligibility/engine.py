import asyncio
import logging
from dataclasses import dataclass, field

from app.eligibility.criteria import (
    CriterionDef,
    FLOOR_AREA_LIMITS,
    RULESET_VERSION,
    USE_CLASS_TO_PDR,
    detect_pdr_class,
    get_criteria_for_class,
)
from app.integrations.article4 import Article4Result, lookup_article4
from app.integrations.epc import EpcResult, lookup_epc
from app.integrations.flood import FloodWarningsResult, lookup_flood_warnings
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
    ruleset_version: str = RULESET_VERSION


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
                        category="statutory",
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
    flood_result: FloodWarningsResult | None = None
    article4_result: Article4Result | None = None
    epc_result: EpcResult | None = None

    if project.address_postcode:
        # Postcode lookup must run first: the flood lookup needs its
        # coordinates and Article 4 needs its LPA code. The remaining
        # network lookups (flood, EPC) are independent of each other and
        # run concurrently.
        pc_result = await lookup_postcode(project.address_postcode)

        flood_coro = (
            lookup_flood_warnings(
                project.address_postcode, pc_result.latitude, pc_result.longitude
            )
            if pc_result
            else _none()
        )
        epc_coro = (
            lookup_epc(
                project.address_postcode,
                address_fragment=project.address_raw,
                api_key=epc_api_key,
            )
            if epc_api_key
            else _none()
        )
        flood_result, epc_result = await asyncio.gather(flood_coro, epc_coro)

        if pc_result:
            # Local dataset lookup — cheap, no network I/O.
            article4_result = await lookup_article4(pc_result.lpa_code)

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
        elif criterion.passed is False and cdef.category == "prior_approval":
            step = _mitigation_step_for(cdef)
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
    flood_result: FloodWarningsResult | None,
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
            category=cdef.category,
        )

    if cdef.key == "floor_area_limit":
        limit = FLOOR_AREA_LIMITS.get(pdr_class)
        floor_area = project.floor_area_sqm
        source_label = "project"
        # EPC floor area may only be used when the EPC row actually matched
        # the project address — an unmatched row can describe a neighbouring
        # property and must never drive a statutory test.
        if (
            floor_area is None
            and epc_result
            and epc_result.matched_address
            and epc_result.floor_area_sqm
        ):
            floor_area = epc_result.floor_area_sqm
            source_label = "EPC (address-matched)"
        if limit and floor_area is not None:
            passed = floor_area <= limit
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=passed,
                source="auto",
                auto_checked=True,
                value=f"{floor_area:.0f} sq m (limit: {limit:.0f} sq m, from {source_label})",
                category=cdef.category,
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="auto",
            auto_checked=False,
            value="Floor area unknown — add it to the project",
            category=cdef.category,
        )

    if cdef.key == "flood_zone":
        # The EA live warnings feed cannot answer the flood-zone question,
        # so this criterion is NEVER auto-passed. Live warnings, if any,
        # are surfaced as an additional risk note only.
        risk_flag = None
        if flood_result and flood_result.has_active_warnings:
            risk_flag = "Active flood alert/warning in this area as of assessment date"
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="manual",
            auto_checked=False,
            value=(
                "Flood zone data unavailable — check the Environment Agency "
                "Flood Map for Planning (flood-map-for-planning.service.gov.uk)"
            ),
            risk_flag=risk_flag,
            category=cdef.category,
        )

    if cdef.key == "article_4":
        if article4_result and article4_result.lpa_in_dataset:
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
                    category=cdef.category,
                )
            # Only an LPA that is actually covered by the bundled dataset may
            # auto-pass this criterion.
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=True,
                source="semi_auto",
                auto_checked=True,
                value="No Article 4 direction recorded for this LPA in the bundled dataset",
                risk_flag="Dataset may not be exhaustive — verify with LPA",
                category=cdef.category,
            )
        if article4_result and not article4_result.lpa_in_dataset and article4_result.lpa_code:
            return EligibilityCriterion(
                key=cdef.key,
                label=cdef.label,
                passed=None,
                source="semi_auto",
                auto_checked=False,
                value=(
                    "This council is not in the bundled Article 4 dataset — "
                    "check the LPA's Article 4 register"
                ),
                category=cdef.category,
            )
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value="Could not check — postcode lookup failed",
            category=cdef.category,
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
            category=cdef.category,
        )

    if cdef.key == "conservation_area":
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value="Not automatically checkable — confirm with LPA",
            category=cdef.category,
        )

    if cdef.key == "use_class_check":
        return EligibilityCriterion(
            key=cdef.key,
            label=cdef.label,
            passed=None,
            source="semi_auto",
            auto_checked=False,
            value=f"Listed as: {project.use_class}",
            category=cdef.category,
        )

    return EligibilityCriterion(
        key=cdef.key,
        label=cdef.label,
        passed=None,
        source="manual",
        auto_checked=False,
        category=cdef.category,
    )


async def _none() -> None:
    """Placeholder coroutine for asyncio.gather when a lookup is skipped."""
    return None


def _compute_verdict(criteria: list[EligibilityCriterion]) -> EligibilityVerdict:
    """Two-tier verdict.

    - Any STATUTORY criterion failed -> RED (the PDR route is not available).
    - All statutory passed/pending but a PRIOR_APPROVAL criterion failed ->
      AMBER (approvability risk, not ineligibility).
    - Any pending criterion (either category) -> AMBER.
    - Everything passed -> GREEN.
    """
    statutory_fail = any(c.passed is False and c.category == "statutory" for c in criteria)
    if statutory_fail:
        return EligibilityVerdict.RED
    prior_approval_fail = any(
        c.passed is False and c.category == "prior_approval" for c in criteria
    )
    has_pending = any(c.passed is None for c in criteria)
    if prior_approval_fail or has_pending:
        return EligibilityVerdict.AMBER
    return EligibilityVerdict.GREEN


NEXT_STEPS: dict[str, str] = {
    "use_class_check": "Confirm the property's current planning use class with the LPA or lease documents.",
    "class_e_use_period": "Verify the building has been in Class E use for a continuous period of at least 2 years before the prior approval application date (lease records, rates records).",
    "conservation_area": "Check with the LPA whether the property is in a conservation area.",
    "listed_building": "Confirm the building is not listed (check Historic England's National Heritage List).",
    "natural_light": "Assess whether habitable rooms will have adequate natural light (site visit recommended).",
    "transport_access": "Assess transport accessibility (proximity to public transport, parking, road access).",
    "contamination": "Check for contamination risk — review environmental reports and site history.",
    "noise_impact": "Assess noise from nearby commercial premises and its impact on future residents.",
    "prior_refusal": "Confirm no prior approval application was refused for this property within the past 2 years.",
    "agricultural_use_period": "Verify the building has been in agricultural use for at least 10 continuous years.",
    "agricultural_building_date": "Confirm the building was part of an established agricultural unit on or before 24 July 2023.",
    "article_4": "Verify current Article 4 direction status with the local planning authority.",
    "flood_zone": (
        "Check the flood zone on the Environment Agency Flood Map for Planning "
        "(flood-map-for-planning.service.gov.uk)."
    ),
    "floor_area_limit": "Add the property's floor area (sq m) to the project.",
}

# Mitigation suggestions for FAILED prior-approval matters. These do not
# mean the PDR route is unavailable — they are risks the LPA will weigh at
# prior-approval stage and can often be mitigated with specialist input.
MITIGATION_STEPS: dict[str, str] = {
    "flood_zone": (
        "Flood risk is a prior-approval matter, not an automatic bar — commission a "
        "site-specific Flood Risk Assessment and consult a flood risk specialist on mitigation."
    ),
    "transport_access": (
        "Transport access is a prior-approval matter — consider a transport statement or "
        "highway consultant input to address accessibility concerns."
    ),
    "contamination": (
        "Contamination is a prior-approval matter — commission a Phase 1 (and if needed "
        "Phase 2) contamination assessment with a remediation strategy."
    ),
    "noise_impact": (
        "Noise is a prior-approval matter — commission a noise impact assessment and "
        "consider acoustic mitigation (glazing, layout) for future residents."
    ),
    "conservation_area": (
        "Conservation-area location does not block Class MA — prepare evidence addressing "
        "the impact of losing ground-floor commercial use, ideally with planning consultant input."
    ),
}


def _next_step_for(cdef: CriterionDef) -> str | None:
    return NEXT_STEPS.get(cdef.key)


def _mitigation_step_for(cdef: CriterionDef) -> str | None:
    return MITIGATION_STEPS.get(
        cdef.key,
        f"'{cdef.label}' is a prior-approval consideration — seek specialist/planning input on mitigation.",
    )
