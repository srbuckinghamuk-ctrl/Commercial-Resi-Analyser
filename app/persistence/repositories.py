"""Repository pattern for all database operations."""
from uuid import UUID

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    EligibilityAssessmentUpdate,
    EligibilityCriterion,
    FinancialAppraisal,
    FinancialAppraisalCreate,
    FinancialAppraisalUpdate,
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
    ) -> list[Project]:
        stmt = select(ProjectORM).order_by(ProjectORM.created_at.desc())
        if stage:
            stmt = stmt.where(ProjectORM.stage == stage)
        if use_class:
            stmt = stmt.where(ProjectORM.use_class == use_class)
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
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: FinancialAppraisalORM) -> FinancialAppraisal:
        return FinancialAppraisal(
            id=row.id,
            project_id=row.project_id,
            name=row.name,
            inputs_snapshot=row.inputs_snapshot,
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

    async def create(self, data: FinancialAppraisalCreate) -> FinancialAppraisal:
        orm = FinancialAppraisalORM(**data.model_dump())
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

    async def update(
        self, project_id: UUID, updates: FinancialAppraisalUpdate
    ) -> FinancialAppraisal | None:
        values = updates.model_dump(exclude_unset=True)
        if not values:
            return await self.get_by_project_id(project_id)
        stmt = (
            update(FinancialAppraisalORM)
            .where(FinancialAppraisalORM.project_id == project_id)
            .values(**values)
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
        stmt = (
            select(StageTransitionORM)
            .where(StageTransitionORM.project_id == project_id)
            .order_by(StageTransitionORM.transitioned_at.asc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]
