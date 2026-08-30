"""Repository pattern for all database operations."""
from uuid import UUID

from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AppraisalVersion,
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
    StaleAppraisal,
    UseClass,
)
from app.persistence.database import (
    AppraisalVersionORM,
    EligibilityAssessmentORM,
    FinancialAppraisalORM,
    LenderCaseEventORM,
    LenderCaseORM,
    ProjectORM,
    StageTransitionORM,
    UserORM,
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

    async def list_stale(
        self, *, current_inputs_version: int, current_calc_version: str,
    ) -> list[StaleAppraisal]:
        """R17 spec Sec 11: every stored row whose inputs_version or
        calc_version is behind the server's, with the project it belongs to.
        A NULL calc_version (a pre-governance row) counts as behind."""
        stmt = (
            select(FinancialAppraisalORM, ProjectORM.address_raw)
            .join(ProjectORM, ProjectORM.id == FinancialAppraisalORM.project_id)
            .where(
                (FinancialAppraisalORM.inputs_version != current_inputs_version)
                | (FinancialAppraisalORM.calc_version != current_calc_version)
                | (FinancialAppraisalORM.calc_version.is_(None))
            )
            .order_by(FinancialAppraisalORM.updated_at.asc())
        )
        result = await self.db.execute(stmt)
        return [
            StaleAppraisal(
                project_id=row.project_id,
                project_address=address,
                appraisal_id=row.id,
                name=row.name,
                inputs_version=row.inputs_version,
                calc_version=row.calc_version,
                status=row.status,
                updated_at=row.updated_at,
                current_inputs_version=current_inputs_version,
                current_calc_version=current_calc_version,
            )
            for row, address in result.all()
        ]


class AppraisalVersionRepository:
    """R17 spec Sec 11. Append-only history of a project's appraisal states:
    a row per ordinary save ('save') and per governed resave
    ('governed_resave'), holding the pre-save state exactly as stored."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: AppraisalVersionORM) -> AppraisalVersion:
        return AppraisalVersion.model_validate(row)

    async def create(self, data: dict) -> AppraisalVersion:
        orm = AppraisalVersionORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_for_project(self, project_id: UUID) -> list[AppraisalVersion]:
        """Newest first."""
        stmt = (
            select(AppraisalVersionORM)
            .where(AppraisalVersionORM.project_id == project_id)
            .order_by(AppraisalVersionORM.superseded_at.desc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(r) for r in result.scalars().all()]


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
            version=row.version,
            created_by_user_id=row.created_by_user_id,
            submitted_by_user_id=row.submitted_by_user_id,
            reviewer_user_id=row.reviewer_user_id,
            decided_by_user_id=row.decided_by_user_id,
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
        self,
        case_id: UUID,
        values: dict,
        *,
        expected_status: str | None = None,
        expected_version: int | None = None,
    ) -> LenderCase | None:
        stmt = update(LenderCaseORM).where(LenderCaseORM.id == case_id)
        if expected_status is not None:
            # The state machine's compare-and-swap: a transition validated
            # against a stale read must fail, not apply, when another
            # transition has moved the case's status since that read.
            stmt = stmt.where(LenderCaseORM.status == expected_status)
        if expected_version is not None:
            # R17 (spec Sec 21.5 amended): the version joins the predicate,
            # so two writes racing from the same read cannot both apply even
            # when they would leave the status unchanged.
            stmt = stmt.where(LenderCaseORM.version == expected_version)
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
            actor_user_id=row.actor_user_id,
            idempotency_key=row.idempotency_key,
            reason=row.reason,
            input_snapshot_hash=row.input_snapshot_hash,
            outputs_hash=row.outputs_hash,
            case_hash_after=row.case_hash_after,
            case_version_after=row.case_version_after,
        )

    async def create(self, data: dict) -> LenderCaseEvent:
        orm = LenderCaseEventORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_by_idempotency_key(
        self, case_id: UUID, idempotency_key: str
    ) -> LenderCaseEvent | None:
        # R17 (spec Sec 21.5 amended): the replay lookup. Unique per case by
        # the uq_lender_case_event_idempotency index, so at most one row.
        stmt = select(LenderCaseEventORM).where(
            LenderCaseEventORM.case_id == case_id,
            LenderCaseEventORM.idempotency_key == idempotency_key,
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        return self._to_domain(row) if row else None

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


class UserRepository:
    """R17 (spec Sec 10.1). Returns UserORM rows rather than a domain model:
    the password hash and salt must reach the login check and nothing else,
    so the public shape (app/auth/schemas.py's UserOut) is built by the
    auth router, not here. Emails are stored and looked up lower-cased."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_email(self, email: str) -> UserORM | None:
        stmt = select(UserORM).where(UserORM.email == email.strip().lower())
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: UUID) -> UserORM | None:
        return await self.db.get(UserORM, user_id)

    async def list(self) -> list[UserORM]:
        stmt = select(UserORM).order_by(UserORM.created_at, UserORM.email)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def count(self) -> int:
        result = await self.db.execute(select(func.count()).select_from(UserORM))
        return int(result.scalar_one())

    async def count_active_admins(self) -> int:
        stmt = (
            select(func.count())
            .select_from(UserORM)
            .where(UserORM.role == "administrator", UserORM.is_active.is_(True))
        )
        result = await self.db.execute(stmt)
        return int(result.scalar_one())

    async def create(
        self,
        *,
        email: str,
        display_name: str,
        role: str,
        password_hash: str,
        password_salt: str,
        is_active: bool = True,
    ) -> UserORM:
        orm = UserORM(
            email=email.strip().lower(),
            display_name=display_name,
            role=role,
            password_hash=password_hash,
            password_salt=password_salt,
            is_active=is_active,
        )
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return orm

    async def update(self, user_id: UUID, **fields) -> UserORM | None:
        orm = await self.db.get(UserORM, user_id)
        if orm is None:
            return None
        for key, value in fields.items():
            setattr(orm, key, value)
        await self.db.flush()
        await self.db.refresh(orm)
        return orm


# --- R17 benchmark library and index datasets (spec Sec 27.6) -----------------
#
# Both repositories flush and never commit: the router owns the transaction so
# an import that fails after a partial insert rolls back whole. No update or
# delete method exists on purpose -- a set and a dataset version are immutable
# once imported (no PUT, no DELETE).


def _iso_date(value):
    """ISO text (or date/datetime) -> date; None/blank -> None."""
    from datetime import date, datetime
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value).strip()[:10])


def _iso_datetime(value):
    """ISO text (or date/datetime) -> tz-aware datetime; a bare date is
    midnight UTC; None/blank -> None."""
    from datetime import date, datetime, timezone
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class BenchmarkSetRepository:
    """Rows come back as ORM objects with `rates` eagerly loaded; the document
    shape is app/benchmarks/library.py's `set_document_from_row`."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _query(self):
        from sqlalchemy.orm import selectinload
        from app.persistence.database import BenchmarkSetORM
        return select(BenchmarkSetORM).options(selectinload(BenchmarkSetORM.rates))

    async def list(self):
        from app.persistence.database import BenchmarkSetORM
        stmt = self._query().order_by(BenchmarkSetORM.created_at, BenchmarkSetORM.name)
        result = await self.db.execute(stmt)
        return list(result.scalars().unique().all())

    async def get(self, set_id: UUID):
        from app.persistence.database import BenchmarkSetORM
        stmt = self._query().where(BenchmarkSetORM.id == set_id)
        result = await self.db.execute(stmt)
        return result.scalars().unique().one_or_none()

    async def find_by_content(self, provider_type: str, dataset_version: str, content_hash: str):
        """The uq_benchmark_set_content key: the row an identical re-import
        would collide with, or None."""
        from app.persistence.database import BenchmarkSetORM
        stmt = self._query().where(
            BenchmarkSetORM.provider_type == provider_type,
            BenchmarkSetORM.dataset_version == dataset_version,
            BenchmarkSetORM.content_hash == content_hash,
        )
        result = await self.db.execute(stmt)
        return result.scalars().unique().one_or_none()

    async def create(
        self,
        header: dict,
        rates: "list[dict]",
        *,
        content_hash: str,
        imported_by_user_id: UUID | None = None,
        source_file_sha256: str | None = None,
    ):
        """`header`/`rates` are the validated import document (ISO text
        dates); rates keep their import order in `position`."""
        from app.persistence.database import BenchmarkRateORM, BenchmarkSetORM
        orm = BenchmarkSetORM(
            name=header["name"],
            provider_type=header["provider_type"],
            provider_name=header.get("provider_name") or "",
            source_title=header.get("source_title") or "",
            source_url=header.get("source_url"),
            source_publication_date=_iso_date(header.get("source_publication_date")),
            retrieved_at=_iso_datetime(header.get("retrieved_at")),
            licence_or_permission=header.get("licence_or_permission") or "",
            dataset_version=header.get("dataset_version") or "",
            building_function=header.get("building_function") or "",
            project_type=header.get("project_type") or "conversion",
            specification_level=header.get("specification_level") or "",
            region=header.get("region") or "",
            location_factor=header.get("location_factor"),
            location_factor_source=header.get("location_factor_source"),
            base_date=_iso_date(header.get("base_date")),
            base_index_name=header.get("base_index_name"),
            base_index_value=header.get("base_index_value"),
            current_index_name=header.get("current_index_name"),
            current_index_value=header.get("current_index_value"),
            index_dataset_version=header.get("index_dataset_version"),
            currentisation_date=_iso_date(header.get("currentisation_date")),
            currency=header.get("currency") or "GBP",
            notes=header.get("notes") or "",
            imported_by=header.get("imported_by") or "",
            imported_by_user_id=imported_by_user_id,
            source_file_sha256=source_file_sha256,
            content_hash=content_hash,
        )
        for position, r in enumerate(rates):
            orm.rates.append(BenchmarkRateORM(
                rate_key=str(r.get("id") or ""),
                element_code=r["element_code"],
                element_label=r.get("element_label") or "",
                description=r.get("description") or "",
                measurement_basis=r["measurement_basis"],
                original_unit=r["original_unit"],
                original_rate_pence=int(r.get("original_rate_pence") or 0),
                rate_pct=r.get("rate_pct"),
                lower_quartile_rate_pence=r.get("lower_quartile_rate_pence"),
                median_rate_pence=r.get("median_rate_pence"),
                upper_quartile_rate_pence=r.get("upper_quartile_rate_pence"),
                sample_count=r.get("sample_count"),
                location_factor=r.get("location_factor"),
                evidence_status=r.get("evidence_status") or "unverified",
                source_reference=r.get("source_reference") or "",
                notes=r.get("notes") or "",
                position=position,
            ))
        self.db.add(orm)
        await self.db.flush()
        return await self.get(orm.id)


class IndexDatasetRepository:
    """One row per (publisher, series_code, dataset_version); observations
    eagerly loaded in period order."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _query(self):
        from sqlalchemy.orm import selectinload
        from app.persistence.database import IndexDatasetORM
        return select(IndexDatasetORM).options(selectinload(IndexDatasetORM.observations))

    async def list(self):
        from app.persistence.database import IndexDatasetORM
        stmt = self._query().order_by(
            IndexDatasetORM.publisher, IndexDatasetORM.series_code, IndexDatasetORM.dataset_version,
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().unique().all())

    async def get(self, dataset_id: UUID):
        from app.persistence.database import IndexDatasetORM
        stmt = self._query().where(IndexDatasetORM.id == dataset_id)
        result = await self.db.execute(stmt)
        return result.scalars().unique().one_or_none()

    async def find_version(self, publisher: str, series_code: str, dataset_version: str):
        from app.persistence.database import IndexDatasetORM
        stmt = self._query().where(
            IndexDatasetORM.publisher == publisher,
            IndexDatasetORM.series_code == series_code,
            IndexDatasetORM.dataset_version == dataset_version,
        )
        result = await self.db.execute(stmt)
        return result.scalars().unique().one_or_none()

    async def count(self) -> int:
        from app.persistence.database import IndexDatasetORM
        result = await self.db.execute(select(func.count()).select_from(IndexDatasetORM))
        return int(result.scalar_one())

    async def create(
        self,
        header: dict,
        observations: "list[dict]",
        *,
        content_hash: str,
        imported_by: str,
        imported_by_user_id: UUID | None = None,
        source_file_sha256: str | None = None,
    ):
        """`observations` are validated `[{period, value}]` in strictly
        increasing period order."""
        from app.persistence.database import IndexDatasetORM, IndexObservationORM
        orm = IndexDatasetORM(
            publisher=header["publisher"],
            series_code=header["series_code"],
            series_name=header.get("series_name") or header["series_code"],
            dataset_version=header["dataset_version"],
            source_url=header.get("source_url") or "",
            licence=header.get("licence") or "",
            publication_date=_iso_date(header.get("publication_date")),
            retrieved_at=_iso_datetime(header.get("retrieved_at")),
            base_period=header.get("base_period") or "",
            source_file_sha256=source_file_sha256,
            content_hash=content_hash,
            imported_by=imported_by,
            imported_by_user_id=imported_by_user_id,
            notes=header.get("notes") or "",
        )
        for o in observations:
            orm.observations.append(IndexObservationORM(period=o["period"], value=float(o["value"])))
        self.db.add(orm)
        await self.db.flush()
        return await self.get(orm.id)
