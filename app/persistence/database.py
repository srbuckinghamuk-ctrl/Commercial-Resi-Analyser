"""SQLAlchemy ORM models and async database setup."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from config.settings import get_settings


settings = get_settings()


# ---------------------------------------------------------------------------
# Engine & session factory
# ---------------------------------------------------------------------------

engine = create_async_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False,
)

AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class Base(AsyncAttrs, DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------------------

class ProjectORM(Base):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_postcode", "address_postcode"),
        Index("ix_projects_stage", "stage"),
        Index("ix_projects_use_class", "use_class"),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    address_raw: Mapped[str] = mapped_column(Text, nullable=False)
    address_line1: Mapped[str | None] = mapped_column(String(256))
    address_line2: Mapped[str | None] = mapped_column(String(256))
    address_town: Mapped[str | None] = mapped_column(String(128))
    address_county: Mapped[str | None] = mapped_column(String(128))
    address_postcode: Mapped[str | None] = mapped_column(String(16))
    address_postcode_district: Mapped[str | None] = mapped_column(String(8))
    price_pence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    price_qualifier: Mapped[str | None] = mapped_column(String(64))
    use_class: Mapped[str] = mapped_column(String(32), nullable=False)
    floor_area_sqft: Mapped[float | None] = mapped_column(Float)
    floor_area_sqm: Mapped[float | None] = mapped_column(Float)
    floors: Mapped[int | None] = mapped_column()
    tenure: Mapped[str] = mapped_column(String(32), default="unknown")
    lease_years_remaining: Mapped[int | None] = mapped_column()
    current_use_description: Mapped[str | None] = mapped_column(Text)
    epc_rating: Mapped[str | None] = mapped_column(String(8))
    is_vacant: Mapped[bool | None] = mapped_column(Boolean)
    vacancy_date: Mapped[str | None] = mapped_column(String(32))
    source_url: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    image_urls: Mapped[list | None] = mapped_column(JSON, default=list)
    stage: Mapped[str] = mapped_column(String(48), nullable=False, default="opportunity_identified")
    pa_submitted_date: Mapped[date | None] = mapped_column(Date)
    pa_decision_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    eligibility_assessments: Mapped[list["EligibilityAssessmentORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    financial_appraisals: Mapped[list["FinancialAppraisalORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    stage_transitions: Mapped[list["StageTransitionORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    lender_cases: Mapped[list["LenderCaseORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class EligibilityAssessmentORM(Base):
    __tablename__ = "eligibility_assessments"
    __table_args__ = (
        Index("ix_eligibility_project_id", "project_id"),
        # One assessment per project, enforced at the schema level.
        Index("uq_eligibility_project_id", "project_id", unique=True),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    pdr_class: Mapped[str] = mapped_column(String(32), nullable=False)
    criteria: Mapped[list] = mapped_column(JSON, nullable=False)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    suggested_next_steps: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    ruleset_version: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="eligibility_assessments")


class FinancialAppraisalORM(Base):
    __tablename__ = "financial_appraisals"
    __table_args__ = (
        Index("ix_appraisal_project_id", "project_id"),
        # One appraisal per project, enforced at the schema level.
        Index("uq_appraisal_project_id", "project_id", unique=True),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    inputs_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    # --- governance columns (Task 12) --------------------------------------
    outputs: Mapped[dict | None] = mapped_column(JSON)
    validation: Mapped[dict | None] = mapped_column(JSON)
    calc_version: Mapped[str | None] = mapped_column(String(32))
    inputs_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # 'legacy_unreconciled' marks every pre-Task-12 row as unmigrated until it
    # is next saved through the server-side recalculation path.
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="legacy_unreconciled"
    )
    input_hash: Mapped[str | None] = mapped_column(String(64))
    outputs_hash: Mapped[str | None] = mapped_column(String(64))
    # Spec Sec 13.2 -- printed in the report provenance panel.
    audit_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="financial_appraisals")


class StageTransitionORM(Base):
    __tablename__ = "stage_transitions"
    __table_args__ = (
        Index("ix_transition_project_id", "project_id"),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    from_stage: Mapped[str | None] = mapped_column(String(48))
    to_stage: Mapped[str] = mapped_column(String(48), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    transitioned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="stage_transitions")


class LenderCaseORM(Base):
    """R14b (spec Sec 21). A locked lender snapshot with governance state.
    Keyed by project (the Sec 13.2 record-identity reasoning); superseded
    rows remain as history, and at most one live case may exist per project
    -- enforced by the partial unique index below, declared for both dialects
    so Alembic and the lifespan create_all agree everywhere."""

    __tablename__ = "lender_cases"
    __table_args__ = (
        Index("ix_lender_case_project_id", "project_id"),
        Index(
            "uq_lender_case_live_project", "project_id", unique=True,
            postgresql_where=text("status != 'superseded'"),
            sqlite_where=text("status != 'superseded'"),
        ),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    # -- the lock, copied from the stored appraisal at creation; never rewritten --
    locked_inputs_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    locked_calc_version: Mapped[str] = mapped_column(String(32), nullable=False)
    locked_inputs_version: Mapped[int] = mapped_column(Integer, nullable=False)
    locked_input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    locked_outputs_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Not-null enforces spec Sec 21.1: no case on a pre-provenance appraisal.
    locked_audit_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Spec Sec 21.4 -- recomputed on every transition.
    case_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[str] = mapped_column(String(256), nullable=False)
    submitted_by: Mapped[str | None] = mapped_column(String(256))
    reviewer: Mapped[str | None] = mapped_column(String(256))
    decided_by: Mapped[str | None] = mapped_column(String(256))
    # --- R17 (spec Sec 10.2): optimistic-concurrency version and the user
    # identity behind each display name. The names stay: they are case_hash
    # components. Alembic 008.
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    submitted_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    reviewer_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    decided_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    conditions: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="lender_cases")
    events: Mapped[list["LenderCaseEventORM"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class LenderCaseEventORM(Base):
    """Append-only change log (spec Sec 21.5), the stage_transitions shape --
    with an integer autoincrement key instead of a UUID, deliberately: events
    written by fast successive requests share a same-second occurred_at, and
    the id is what keeps newest-first deterministic."""

    __tablename__ = "lender_case_events"
    __table_args__ = (
        Index("ix_lender_case_event_case_id", "case_id"),
        # R17 (spec Sec 10.4): a repeated idempotency_key on one case is
        # refused by the database. NULL keys (every pre-R17 event) are
        # distinct in a unique index on both Postgres and SQLite, so keyless
        # events coexist freely.
        Index(
            "uq_lender_case_event_idempotency", "case_id", "idempotency_key", unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("lender_cases.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(256), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # --- R17 (spec Sec 10.4): who, why, and the state the write left behind.
    actor_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(64))
    reason: Mapped[str | None] = mapped_column(Text)
    input_snapshot_hash: Mapped[str | None] = mapped_column(String(64))
    outputs_hash: Mapped[str | None] = mapped_column(String(64))
    case_hash_after: Mapped[str | None] = mapped_column(String(64))
    case_version_after: Mapped[int | None] = mapped_column(Integer)

    case: Mapped["LenderCaseORM"] = relationship(back_populates="events")


# ---------------------------------------------------------------------------
# R17 (Alembic 008): users, the benchmark library, index datasets and
# appraisal versions. Every column here is mirrored in
# migrations/versions/008_benchmark_library_and_users.py so create_all (the
# test and lifespan path) and the Alembic chain agree.
# ---------------------------------------------------------------------------

class UserORM(Base):
    """Spec Sec 10.1. `email` is stored lower-cased; the password is a PBKDF2
    hash plus its per-user salt (app/auth/passwords.py). Deactivation, not
    deletion: user ids are referenced by cases, events and versions."""

    __tablename__ = "users"
    __table_args__ = (
        Index("uq_users_email", "email", unique=True),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    password_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BenchmarkSetORM(Base):
    """Spec Sec 27.6. Immutable once imported: no update path exists, and a
    re-import of identical content is refused by uq_benchmark_set_content."""

    __tablename__ = "benchmark_sets"
    __table_args__ = (
        Index(
            "uq_benchmark_set_content",
            "provider_type", "dataset_version", "content_hash", unique=True,
        ),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_name: Mapped[str] = mapped_column(String(256), nullable=False)
    source_title: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    source_publication_date: Mapped[date | None] = mapped_column(Date)
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    licence_or_permission: Mapped[str] = mapped_column(Text, nullable=False)
    dataset_version: Mapped[str] = mapped_column(String(64), nullable=False)
    building_function: Mapped[str] = mapped_column(String(128), nullable=False)
    project_type: Mapped[str] = mapped_column(String(32), nullable=False)
    specification_level: Mapped[str] = mapped_column(String(128), nullable=False)
    region: Mapped[str] = mapped_column(String(128), nullable=False)
    location_factor: Mapped[float | None] = mapped_column(Float)
    location_factor_source: Mapped[str | None] = mapped_column(Text)
    base_date: Mapped[date] = mapped_column(Date, nullable=False)
    base_index_name: Mapped[str | None] = mapped_column(String(128))
    base_index_value: Mapped[float | None] = mapped_column(Float)
    current_index_name: Mapped[str | None] = mapped_column(String(128))
    current_index_value: Mapped[float | None] = mapped_column(Float)
    index_dataset_version: Mapped[str | None] = mapped_column(String(64))
    currentisation_date: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="GBP")
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    imported_by: Mapped[str] = mapped_column(String(256), nullable=False)
    imported_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    source_file_sha256: Mapped[str | None] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    rates: Mapped[list["BenchmarkRateORM"]] = relationship(
        back_populates="benchmark_set", cascade="all, delete-orphan",
        order_by="BenchmarkRateORM.position",
    )


class BenchmarkRateORM(Base):
    __tablename__ = "benchmark_rates"
    __table_args__ = (
        Index("ix_benchmark_rate_set_id", "set_id"),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    # R17 spec Sec 27.6: the import document's own rate id, kept so a set read
    # back from the library reproduces its content_hash (the row UUID is not in
    # the hash; this key is).
    rate_key: Mapped[str] = mapped_column(String(64), nullable=False, server_default="")
    set_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("benchmark_sets.id", ondelete="CASCADE"), nullable=False
    )
    element_code: Mapped[str] = mapped_column(String(64), nullable=False)
    element_label: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    measurement_basis: Mapped[str] = mapped_column(String(16), nullable=False)
    original_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    original_rate_pence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rate_pct: Mapped[float | None] = mapped_column(Float)
    lower_quartile_rate_pence: Mapped[int | None] = mapped_column(BigInteger)
    median_rate_pence: Mapped[int | None] = mapped_column(BigInteger)
    upper_quartile_rate_pence: Mapped[int | None] = mapped_column(BigInteger)
    sample_count: Mapped[int | None] = mapped_column(Integer)
    location_factor: Mapped[float | None] = mapped_column(Float)
    evidence_status: Mapped[str] = mapped_column(String(16), nullable=False)
    source_reference: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    # Import order -- the set's rates are returned in the order they came.
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    benchmark_set: Mapped["BenchmarkSetORM"] = relationship(back_populates="rates")


class IndexDatasetORM(Base):
    """Spec Sec 27.6. One version of one index series; no update, no delete."""

    __tablename__ = "index_datasets"
    __table_args__ = (
        Index(
            "uq_index_dataset_version", "publisher", "series_code", "dataset_version", unique=True,
        ),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    publisher: Mapped[str] = mapped_column(String(256), nullable=False)
    series_code: Mapped[str] = mapped_column(String(64), nullable=False)
    series_name: Mapped[str] = mapped_column(String(256), nullable=False)
    dataset_version: Mapped[str] = mapped_column(String(64), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    licence: Mapped[str] = mapped_column(Text, nullable=False)
    publication_date: Mapped[date | None] = mapped_column(Date)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    base_period: Mapped[str] = mapped_column(String(32), nullable=False)
    source_file_sha256: Mapped[str | None] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    imported_by: Mapped[str] = mapped_column(String(256), nullable=False)
    imported_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    observations: Mapped[list["IndexObservationORM"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan",
        order_by="IndexObservationORM.period",
    )


class IndexObservationORM(Base):
    __tablename__ = "index_observations"
    __table_args__ = (
        Index("ix_index_observation_dataset_id", "dataset_id"),
        Index("uq_index_observation_period", "dataset_id", "period", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("index_datasets.id", ondelete="CASCADE"), nullable=False
    )
    period: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    value: Mapped[float] = mapped_column(Float, nullable=False)

    dataset: Mapped["IndexDatasetORM"] = relationship(back_populates="observations")


class AppraisalVersionORM(Base):
    """Spec Sec 11. The pre-save state of a financial_appraisals row, written
    by every save and by the governed resave. Keyed by project like the row
    it shadows; appraisal_id is copied, not an FK, so history survives the
    row's replacement."""

    __tablename__ = "appraisal_versions"
    __table_args__ = (
        Index("ix_appraisal_version_project_id", "project_id"),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    appraisal_id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)  # 'save' | 'governed_resave'
    inputs_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    outputs: Mapped[dict | None] = mapped_column(JSON)
    validation: Mapped[dict | None] = mapped_column(JSON)
    calc_version: Mapped[str | None] = mapped_column(String(32))
    inputs_version: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str | None] = mapped_column(String(32))
    input_hash: Mapped[str | None] = mapped_column(String(64))
    outputs_hash: Mapped[str | None] = mapped_column(String(64))
    audit_hash: Mapped[str | None] = mapped_column(String(64))
    superseded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    superseded_by_user_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id")
    )
    superseded_by: Mapped[str | None] = mapped_column(String(256))
