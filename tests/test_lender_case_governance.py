"""R14b: lender case governance (spec Sec 21) -- persistence invariants and,
from Task 4 on, the /lender-cases endpoints end-to-end against in-memory
sqlite, the test_appraisal_governance.py pattern."""
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.persistence.database import Base, LenderCaseORM


@pytest.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


def _case_row(project_id, status: str) -> LenderCaseORM:
    return LenderCaseORM(
        project_id=project_id, status=status,
        locked_inputs_snapshot={}, locked_calc_version="2.13.0",
        locked_inputs_version=11, locked_input_hash="a" * 64,
        locked_outputs_hash="b" * 64, locked_audit_hash="c" * 64,
        case_hash="d" * 64, created_by="T. Test",
    )


async def test_second_live_case_is_refused_by_the_database(db_engine):
    """The partial unique index itself, not the endpoint's 409 twin: two
    non-superseded cases for one project must be an IntegrityError."""
    from uuid import uuid4
    from app.persistence.database import ProjectORM

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        project = ProjectORM(
            id=uuid4(), address_raw="1 Test Street", price_pence=1, use_class="office",
        )
        session.add(project)
        await session.flush()
        session.add(_case_row(project.id, "superseded"))
        session.add(_case_row(project.id, "draft"))
        await session.flush()  # superseded + one live: fine
        session.add(_case_row(project.id, "submitted"))
        with pytest.raises(IntegrityError):
            await session.flush()
