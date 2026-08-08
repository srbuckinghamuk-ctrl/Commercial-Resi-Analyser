import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ApiResponse,
    EligibilityAssessment,
    EligibilityAssessmentCreate,
    EligibilityAssessmentUpdate,
    FinancialAppraisal,
    FinancialAppraisalCreate,
    FinancialAppraisalUpdate,
    PipelineStage,
    Project,
    ProjectCreate,
    ProjectUpdate,
    ScrapeUrlRequest,
    StageTransitionCreate,
    UseClass,
)
from app.persistence.database import Base, engine, get_db
from app.persistence.repositories import (
    EligibilityAssessmentRepository,
    FinancialAppraisalRepository,
    ProjectRepository,
    StageTransitionRepository,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

DbDep = Annotated[AsyncSession, Depends(get_db)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("commercial-resi-analyser started")
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Commercial-Resi-Analyser",
        description="UK commercial-to-residential PDR conversion analyser",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(projects_router, prefix=settings.api_prefix, tags=["projects"])
    app.include_router(eligibility_router, prefix=settings.api_prefix, tags=["eligibility"])
    app.include_router(appraisals_router, prefix=settings.api_prefix, tags=["appraisals"])
    app.include_router(scrape_router, prefix=settings.api_prefix, tags=["scrape"])
    app.include_router(system_router, tags=["system"])

    dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="spa")

    return app


# --- Projects Router ---

from fastapi import APIRouter

projects_router = APIRouter(prefix="/projects")


@projects_router.get("", response_model=list[Project])
async def list_projects(
    db: DbDep,
    stage: PipelineStage | None = None,
    use_class: UseClass | None = None,
):
    repo = ProjectRepository(db)
    return await repo.list_all(stage=stage, use_class=use_class)


@projects_router.post("", response_model=Project, status_code=201)
async def create_project(body: ProjectCreate, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.create(body)
    transition_repo = StageTransitionRepository(db)
    await transition_repo.create(
        StageTransitionCreate(
            project_id=project.id,
            to_stage=project.stage,
            notes="Project created",
        )
    )
    await db.commit()
    return project


@projects_router.get("/{project_id}", response_model=Project)
async def get_project(project_id: UUID, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@projects_router.put("/{project_id}", response_model=Project)
async def update_project(project_id: UUID, body: ProjectUpdate, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.update(project_id, body)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.commit()
    return project


@projects_router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: UUID, db: DbDep):
    repo = ProjectRepository(db)
    deleted = await repo.delete(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.commit()


class StageChangeRequest(BaseModel):
    to_stage: PipelineStage
    notes: str | None = None


@projects_router.post("/{project_id}/stage", response_model=Project)
async def change_stage(project_id: UUID, body: StageChangeRequest, db: DbDep):
    repo = ProjectRepository(db)
    project = await repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    old_stage = project.stage
    updated = await repo.update(project_id, ProjectUpdate(stage=body.to_stage))
    transition_repo = StageTransitionRepository(db)
    await transition_repo.create(
        StageTransitionCreate(
            project_id=project_id,
            from_stage=old_stage,
            to_stage=body.to_stage,
            notes=body.notes,
        )
    )
    await db.commit()
    return updated


# --- Eligibility Router ---

eligibility_router = APIRouter(prefix="/eligibility")


@eligibility_router.post("/{project_id}", response_model=EligibilityAssessment, status_code=201)
async def create_eligibility(project_id: UUID, body: EligibilityAssessmentCreate, db: DbDep):
    project_repo = ProjectRepository(db)
    project = await project_repo.get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    body.project_id = project_id
    repo = EligibilityAssessmentRepository(db)
    assessment = await repo.create(body)
    await db.commit()
    return assessment


@eligibility_router.get("/{project_id}", response_model=EligibilityAssessment)
async def get_eligibility(project_id: UUID, db: DbDep):
    repo = EligibilityAssessmentRepository(db)
    assessment = await repo.get_by_project_id(project_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Eligibility assessment not found")
    return assessment


@eligibility_router.put("/{project_id}", response_model=EligibilityAssessment)
async def update_eligibility(project_id: UUID, body: EligibilityAssessmentUpdate, db: DbDep):
    repo = EligibilityAssessmentRepository(db)
    assessment = await repo.update(project_id, body)
    if not assessment:
        raise HTTPException(status_code=404, detail="Eligibility assessment not found")
    await db.commit()
    return assessment


# --- Appraisals Router ---

appraisals_router = APIRouter(prefix="/appraisals")


@appraisals_router.post("", response_model=FinancialAppraisal, status_code=201)
async def create_appraisal(body: FinancialAppraisalCreate, db: DbDep):
    project_repo = ProjectRepository(db)
    project = await project_repo.get_by_id(body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    repo = FinancialAppraisalRepository(db)
    appraisal = await repo.create(body)
    await db.commit()
    return appraisal


@appraisals_router.get("/{project_id}", response_model=FinancialAppraisal)
async def get_appraisal(project_id: UUID, db: DbDep):
    repo = FinancialAppraisalRepository(db)
    appraisal = await repo.get_by_project_id(project_id)
    if not appraisal:
        raise HTTPException(status_code=404, detail="Financial appraisal not found")
    return appraisal


@appraisals_router.put("/{project_id}", response_model=FinancialAppraisal)
async def update_appraisal(project_id: UUID, body: FinancialAppraisalUpdate, db: DbDep):
    repo = FinancialAppraisalRepository(db)
    appraisal = await repo.update(project_id, body)
    if not appraisal:
        raise HTTPException(status_code=404, detail="Financial appraisal not found")
    await db.commit()
    return appraisal


# --- Scrape Router ---

scrape_router = APIRouter()


@scrape_router.post("/scrape-url", response_model=ApiResponse)
async def scrape_url_endpoint(request: ScrapeUrlRequest):
    return ApiResponse(error="Scraping not yet implemented — commercial adapters coming in Plan 4")


# --- System Router ---

system_router = APIRouter()


@system_router.get("/health")
async def system_health():
    from datetime import datetime, timezone

    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@system_router.get("/metrics")
async def metrics():
    try:
        from prometheus_client import generate_latest
        from starlette.responses import Response

        return Response(content=generate_latest(), media_type="text/plain")
    except ImportError:
        return {"error": "prometheus_client not installed"}


app = create_app()
