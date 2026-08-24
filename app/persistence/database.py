"""SQLAlchemy ORM models and async database setup."""
from __future__ import annotations

from datetime import date, datetime
from uuid import uuid4

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
    # --- legacy metric columns, now always server-computed -----------------
    gdv_pence: Mapped[int | None] = mapped_column(BigInteger)
    total_cost_pence: Mapped[int | None] = mapped_column(BigInteger)
    profit_on_cost_pct: Mapped[float | None] = mapped_column(Float)
    profit_on_gdv_pct: Mapped[float | None] = mapped_column(Float)
    return_on_equity_pct: Mapped[float | None] = mapped_column(Float)
    irr: Mapped[float | None] = mapped_column(Float)
    rlv_pence: Mapped[int | None] = mapped_column(BigInteger)
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

    case: Mapped["LenderCaseORM"] = relationship(back_populates="events")
