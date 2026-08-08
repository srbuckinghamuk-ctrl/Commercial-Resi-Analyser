from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models import (
    ProjectCreate,
    ProjectUpdate,
    UseClass,
    PipelineStage,
    EligibilityAssessmentCreate,
    EligibilityCriterion,
    EligibilityVerdict,
    PdrClass,
    FinancialAppraisalCreate,
    StageTransitionCreate,
)
from app.persistence.repositories import (
    ProjectRepository,
    EligibilityAssessmentRepository,
    FinancialAppraisalRepository,
    StageTransitionRepository,
)


class TestProjectRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = ProjectRepository(mock_db)
        assert repo.db is mock_db


class TestEligibilityAssessmentRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = EligibilityAssessmentRepository(mock_db)
        assert repo.db is mock_db


class TestFinancialAppraisalRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = FinancialAppraisalRepository(mock_db)
        assert repo.db is mock_db


class TestStageTransitionRepositoryInit:
    def test_constructor_accepts_session(self):
        mock_db = AsyncMock()
        repo = StageTransitionRepository(mock_db)
        assert repo.db is mock_db
