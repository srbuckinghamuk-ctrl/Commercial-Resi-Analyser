import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Project } from '../types';
import { runAppraisal, migrateInputs } from '../lib/model';
import type { AppraisalRun, CalculatorInputsV2 } from '../lib/model';
import { defaultCalculatorInputsV2 } from '../lib/conversion-defaults';
import { createAppraisal, getAppraisal, updateAppraisal } from '../lib/api';

import AcquisitionPage from './calculator/AcquisitionPage';
import UnitMixPage from './calculator/UnitMixPage';
import ConversionCostsPage from './calculator/ConversionCostsPage';
import FinancePage from './calculator/FinancePage';
import CashflowPage from './calculator/CashflowPage';
import AppraisalSummaryPage from './calculator/AppraisalSummaryPage';
import ScenariosPage from './calculator/ScenariosPage';
import ExitStrategyPage from './calculator/ExitStrategyPage';
import RiskRegisterPage from './calculator/RiskRegisterPage';
import DealSpiderPage from './calculator/DealSpiderPage';
import InvestorSummaryPage from './calculator/InvestorSummaryPage';

type CalcPage =
  | 'acquisition'
  | 'unit_mix'
  | 'conversion_costs'
  | 'finance'
  | 'cashflow'
  | 'appraisal'
  | 'scenarios'
  | 'exit_strategy'
  | 'risk_register'
  | 'deal_spider'
  | 'investor_summary';

const PAGES: { key: CalcPage; label: string; num: number }[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'unit_mix', label: 'Unit Mix', num: 2 },
  { key: 'conversion_costs', label: 'Costs', num: 3 },
  { key: 'finance', label: 'Finance', num: 4 },
  { key: 'cashflow', label: 'Cashflow', num: 5 },
  { key: 'appraisal', label: 'Appraisal', num: 6 },
  { key: 'scenarios', label: 'Scenarios', num: 7 },
  { key: 'exit_strategy', label: 'Exit', num: 8 },
  { key: 'risk_register', label: 'Risk', num: 9 },
  { key: 'deal_spider', label: 'Deal Spider', num: 10 },
  { key: 'investor_summary', label: 'Investor', num: 11 },
];

interface Props {
  project: Project | null;
}

export default function ConversionCalculator({ project }: Props) {
  const [activePage, setActivePage] = useState<CalcPage>('acquisition');
  const [inputs, setInputs] = useState<CalculatorInputsV2>(() =>
    defaultCalculatorInputsV2(project ?? undefined),
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setInputs(defaultCalculatorInputsV2(project));
      setSavedId(null);
      getAppraisal(project.id)
        .then((appraisal) => {
          if (appraisal.inputs_snapshot && typeof appraisal.inputs_snapshot === 'object') {
            // Migrate onto v2 defaults so snapshots saved before newer
            // sections (or v1 snapshots) existed still load cleanly.
            setInputs(migrateInputs(appraisal.inputs_snapshot as Record<string, unknown>, project));
            setSavedId(appraisal.id);
          }
        })
        .catch(() => {});
    }
  }, [project]);

  const run: AppraisalRun = useMemo(() => runAppraisal(inputs), [inputs]);

  const updateInputs = useCallback((partial: Partial<CalculatorInputsV2>) => {
    setInputs((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    try {
      const payload = {
        project_id: project.id,
        name: `Appraisal — ${project.address_raw}`,
        inputs_snapshot: inputs as unknown as Record<string, unknown>,
        gdv_pence: run.metrics.gdv_pence,
        total_cost_pence: run.metrics.total_development_cost_pence,
        profit_on_cost_pct: run.metrics.profit_on_cost_pct ?? 0,
        profit_on_gdv_pct: run.metrics.profit_on_gdv_pct ?? 0,
        return_on_equity_pct: run.metrics.return_on_equity_pct ?? 0,
        irr: run.metrics.irr_annual_pct ?? 0,
        rlv_pence: run.metrics.rlv_pence,
      };
      if (savedId) {
        await updateAppraisal(project.id, payload);
      } else {
        const result = await createAppraisal(payload);
        setSavedId(result.id);
      }
    } finally {
      setSaving(false);
    }
  }, [project, inputs, run, savedId]);

  const pageIndex = PAGES.findIndex((p) => p.key === activePage);

  const goNext = useCallback(() => {
    if (pageIndex < PAGES.length - 1) setActivePage(PAGES[pageIndex + 1].key);
  }, [pageIndex]);

  const goPrev = useCallback(() => {
    if (pageIndex > 0) setActivePage(PAGES[pageIndex - 1].key);
  }, [pageIndex]);

  if (!project) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Conversion Calculator</h2>
        <p style={{ color: '#94a3b8' }}>Select a project from the Pipeline tab to start a financial appraisal.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Sub-nav */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #1e3a5f',
          background: '#0d1b2a',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {PAGES.map((page) => (
          <button
            key={page.key}
            onClick={() => setActivePage(page.key)}
            style={{
              padding: '8px 14px',
              border: 'none',
              borderBottom: activePage === page.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activePage === page.key ? '#e2e8f0' : '#64748b',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activePage === page.key ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {page.num}. {page.label}
          </button>
        ))}
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {activePage === 'acquisition' && (
          <AcquisitionPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'unit_mix' && (
          <UnitMixPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'conversion_costs' && (
          <ConversionCostsPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'finance' && (
          <FinancePage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'cashflow' && (
          <CashflowPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'appraisal' && (
          <AppraisalSummaryPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'scenarios' && (
          <ScenariosPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'exit_strategy' && (
          <ExitStrategyPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'risk_register' && (
          <RiskRegisterPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'deal_spider' && (
          <DealSpiderPage inputs={inputs} onChange={updateInputs} project={project} />
        )}
        {activePage === 'investor_summary' && (
          <InvestorSummaryPage inputs={inputs} run={run} project={project} />
        )}
      </div>

      {/* Footer nav */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderTop: '1px solid #1e3a5f',
          background: '#0d1b2a',
          flexShrink: 0,
        }}
      >
        <button
          onClick={goPrev}
          disabled={pageIndex === 0}
          style={{
            padding: '8px 20px',
            background: pageIndex === 0 ? '#1e293b' : '#1e3a5f',
            color: pageIndex === 0 ? '#475569' : '#e2e8f0',
            border: 'none',
            borderRadius: 6,
            cursor: pageIndex === 0 ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          Previous
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 24px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving...' : savedId ? 'Update Appraisal' : 'Save Appraisal'}
        </button>
        <button
          onClick={goNext}
          disabled={pageIndex === PAGES.length - 1}
          style={{
            padding: '8px 20px',
            background: pageIndex === PAGES.length - 1 ? '#1e293b' : '#1e3a5f',
            color: pageIndex === PAGES.length - 1 ? '#475569' : '#e2e8f0',
            border: 'none',
            borderRadius: 6,
            cursor: pageIndex === PAGES.length - 1 ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
