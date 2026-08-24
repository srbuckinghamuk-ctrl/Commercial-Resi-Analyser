"""Repository pattern for all database operations."""
from uuid import UUID

from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    EligibilityAssessmentUpdate,
    EligibilityCriterion,
    FinancialAppraisal,
    LenderCase,
    LenderCaseEvent,
    PipelineStage,
    Project,
    ProjectCreate,
    ProjectUpdate,
    StageTransition,
    StageTransitionCreate,
    UseClass,
)
from app.persistence.database import (
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    LenderCaseEventORM,
    LenderCaseORM,
    ProjectORM,
    StageTransitionORM,
)


class ProjectRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: ProjectORM) -> Project:
        return Project(
            id=row.id,
            address_raw=row.address_raw,
            address_line1=row.address_line1,
            address_line2=row.address_line2,
            address_town=row.address_town,
            address_county=row.address_county,
            address_postcode=row.address_postcode,
            address_postcode_district=row.address_postcode_district,
            price_pence=row.price_pence,
            price_qualifier=row.price_qualifier,
            use_class=row.use_class,
            floor_area_sqft=row.floor_area_sqft,
            floor_area_sqm=row.floor_area_sqm,
            floors=row.floors,
            tenure=row.tenure,
            lease_years_remaining=row.lease_years_remaining,
            current_use_description=row.current_use_description,
            epc_rating=row.epc_rating,
            is_vacant=row.is_vacant,
            vacancy_date=row.vacancy_date,
            source_url=row.source_url,
            source_name=row.source_name,
            description=row.description,
            image_urls=row.image_urls or [],
            stage=row.stage,
            pa_submitted_date=row.pa_submitted_date,
            pa_decision_date=row.pa_decision_date,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: ProjectCreate) -> Project:
        orm = ProjectORM(**data.model_dump())
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_all(
        self,
        stage: PipelineStage | None = None,
        use_class: UseClass | None = None,
        limit: int = 500,
        offset: int = 0,
    ) -> list[Project]:
        stmt = select(ProjectORM).order_by(ProjectORM.created_at.desc())
        if stage:
            stmt = stmt.where(ProjectORM.stage == stage)
        if use_class:
            stmt = stmt.where(ProjectORM.use_class == use_class)
        stmt = stmt.limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]

    async def get_by_id(self, project_id: UUID) -> Project | None:
        stmt = select(ProjectORM).where(ProjectORM.id == project_id)
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

    async def update(self, project_id: UUID, updates: ProjectUpdate) -> Project | None:
        values = updates.model_dump(exclude_unset=True)
        if not values:
            return await self.get_by_id(project_id)
        stmt = (
            update(ProjectORM)
            .where(ProjectORM.id == project_id)
            .values(**values)
            .returning(ProjectORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)

    async def delete(self, project_id: UUID) -> bool:
        stmt = delete(ProjectORM).where(ProjectORM.id == project_id)
        result = await self.db.execute(stmt)
        await self.db.flush()
        return result.rowcount > 0


class EligibilityAssessmentRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: EligibilityAssessmentORM) -> EligibilityAssessment:
        return EligibilityAssessment(
            id=row.id,
            project_id=row.project_id,
            pdr_class=row.pdr_class,
            criteria=[EligibilityCriterion(**c) for c in row.criteria],
            verdict=row.verdict,
            suggested_next_steps=row.suggested_next_steps or [],
            notes=row.notes,
            ruleset_version=row.ruleset_version,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: EligibilityAssessmentCreate) -> EligibilityAssessment:
        dump = data.model_dump()
        dump["criteria"] = [c.model_dump() for c in data.criteria]
        orm = EligibilityAssessmentORM(**dump)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_by_project_id(self, project_id: UUID) -> EligibilityAssessment | None:
        # Resilient to legacy duplicate rows: return the most recent one
        # instead of raising MultipleResultsFound.
        stmt = (
            select(EligibilityAssessmentORM)
            .where(EligibilityAssessmentORM.project_id == project_id)
            .order_by(
                EligibilityAssessmentORM.updated_at.desc(),
                EligibilityAssessmentORM.created_at.desc(),
            )
            .limit(1)
        )
        result = await self.db.execute(stmt)
        row = result.scalars().first()
        return self._to_domain(row) if row else None

    async def update(
        self, project_id: UUID, updates: EligibilityAssessmentUpdate
    ) -> EligibilityAssessment | None:
        values = updates.model_dump(exclude_unset=True)
        if "criteria" in values and values["criteria"] is not None:
            values["criteria"] = [c.model_dump() for c in updates.criteria]
        if not values:
            return await self.get_by_project_id(project_id)
        stmt = (
            update(EligibilityAssessmentORM)
            .where(EligibilityAssessmentORM.project_id == project_id)
            .values(**values)
            .returning(EligibilityAssessmentORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)


class FinancialAppraisalRepository:
    """Reads/writes pre-computed appraisal dicts. Task 12 made the server the
    sole author of appraisal outputs/governance columns, so `create`/`update`
    take a plain dict (built by app.api.app.calculate_authoritative) rather
    than a client-facing Pydantic model -- there is no longer a 1:1 mapping
    between the request schema and the persisted columns."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: FinancialAppraisalORM) -> FinancialAppraisal:
        return FinancialAppraisal(
            id=row.id,
            project_id=row.project_id,
            name=row.name,
            inputs_snapshot=row.inputs_snapshot,
            outputs=row.outputs,
            validation=row.validation,
            calc_version=row.calc_version,
            inputs_version=row.inputs_version,
            status=row.status,
            input_hash=row.input_hash,
            outputs_hash=row.outputs_hash,
            audit_hash=row.audit_hash,
            gdv_pence=row.gdv_pence,
            total_cost_pence=row.total_cost_pence,
            profit_on_cost_pct=row.profit_on_cost_pct,
            profit_on_gdv_pct=row.profit_on_gdv_pct,
            return_on_equity_pct=row.return_on_equity_pct,
            irr=row.irr,
            rlv_pence=row.rlv_pence,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: dict) -> FinancialAppraisal:
        orm = FinancialAppraisalORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_by_project_id(self, project_id: UUID) -> FinancialAppraisal | None:
        # Resilient to legacy duplicate rows: return the most recent one
        # instead of raising MultipleResultsFound.
        stmt = (
            select(FinancialAppraisalORM)
            .where(FinancialAppraisalORM.project_id == project_id)
            .order_by(
                FinancialAppraisalORM.updated_at.desc(),
                FinancialAppraisalORM.created_at.desc(),
            )
            .limit(1)
        )
        result = await self.db.execute(stmt)
        row = result.scalars().first()
        return self._to_domain(row) if row else None

    async def update(self, project_id: UUID, data: dict) -> FinancialAppraisal | None:
        if not data:
            return await self.get_by_project_id(project_id)
        stmt = (
            update(FinancialAppraisalORM)
            .where(FinancialAppraisalORM.project_id == project_id)
            .values(**data)
            .returning(FinancialAppraisalORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)


class StageTransitionRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: StageTransitionORM) -> StageTransition:
        return StageTransition(
            id=row.id,
            project_id=row.project_id,
            from_stage=row.from_stage,
            to_stage=row.to_stage,
            notes=row.notes,
            transitioned_at=row.transitioned_at,
        )

    async def create(self, data: StageTransitionCreate) -> StageTransition:
        orm = StageTransitionORM(**data.model_dump())
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_by_project_id(self, project_id: UUID) -> list[StageTransition]:
        # Newest first — this feeds the project timeline endpoint.
        stmt = (
            select(StageTransitionORM)
            .where(StageTransitionORM.project_id == project_id)
            .order_by(StageTransitionORM.transitioned_at.desc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]


class LenderCaseRepository:
    """R14b (spec Sec 21). Like FinancialAppraisalRepository, `create`/`update`
    take a plain dict built by the endpoint: the server is the sole author of
    the locked snapshot and case_hash, so there is no 1:1 request/column
    mapping to type."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: LenderCaseORM) -> LenderCase:
        return LenderCase(
            id=row.id,
            project_id=row.project_id,
            status=row.status,
            locked_inputs_snapshot=row.locked_inputs_snapshot,
            locked_calc_version=row.locked_calc_version,
            locked_inputs_version=row.locked_inputs_version,
            locked_input_hash=row.locked_input_hash,
            locked_outputs_hash=row.locked_outputs_hash,
            locked_audit_hash=row.locked_audit_hash,
            case_hash=row.case_hash,
            created_by=row.created_by,
            submitted_by=row.submitted_by,
            reviewer=row.reviewer,
            decided_by=row.decided_by,
            conditions=row.conditions,
            submitted_at=row.submitted_at,
            decided_at=row.decided_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: dict) -> LenderCase:
        orm = LenderCaseORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_live_by_project_id(self, project_id: UUID) -> LenderCase | None:
        stmt = (
            select(LenderCaseORM)
            .where(
                LenderCaseORM.project_id == project_id,
                LenderCaseORM.status != "superseded",
            )
            .order_by(LenderCaseORM.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        row = result.scalars().first()
        return self._to_domain(row) if row else None

    async def list_by_project_id(self, project_id: UUID) -> list[LenderCase]:
        # Newest first, superseded included -- this is the case history.
        # Secondary sort key: sqlite's CURRENT_TIMESTAMP is 1-second
        # resolution, so two cases opened within the same second (a
        # supersede immediately followed by a fresh case) tie on created_at
        # alone. Each case's most recent event id is the schema's monotonic
        # record of creation order -- every case writes its creation event
        # in the same transaction it is created in -- so it breaks the tie
        # correctly rather than arbitrarily (unlike the case's own id,
        # which is a random UUID).
        latest_event_id = (
            select(func.max(LenderCaseEventORM.id))
            .where(LenderCaseEventORM.case_id == LenderCaseORM.id)
            .scalar_subquery()
        )
        stmt = (
            select(LenderCaseORM)
            .where(LenderCaseORM.project_id == project_id)
            .order_by(LenderCaseORM.created_at.desc(), latest_event_id.desc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]

    async def update(
        self, case_id: UUID, values: dict, *, expected_status: str | None = None
    ) -> LenderCase | None:
        stmt = update(LenderCaseORM).where(LenderCaseORM.id == case_id)
        if expected_status is not None:
            # The state machine's compare-and-swap: a transition validated
            # against a stale read must fail, not apply, when another
            # transition has moved the case's status since that read.
            stmt = stmt.where(LenderCaseORM.status == expected_status)
        stmt = stmt.values(**values).returning(LenderCaseORM)
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)


class LenderCaseEventRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: LenderCaseEventORM) -> LenderCaseEvent:
        return LenderCaseEvent(
            id=row.id,
            case_id=row.case_id,
            from_status=row.from_status,
            to_status=row.to_status,
            actor=row.actor,
            note=row.note,
            occurred_at=row.occurred_at,
        )

    async def create(self, data: dict) -> LenderCaseEvent:
        orm = LenderCaseEventORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_by_project_id(self, project_id: UUID) -> list[LenderCaseEvent]:
        # Newest first across ALL the project's cases (history included).
        # id desc, not occurred_at desc: same-second writes are routine and
        # the integer key is what keeps the order deterministic.
        stmt = (
            select(LenderCaseEventORM)
            .where(
                LenderCaseEventORM.case_id.in_(
                    select(LenderCaseORM.id).where(LenderCaseORM.project_id == project_id)
                )
            )
            .order_by(LenderCaseEventORM.id.desc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]
