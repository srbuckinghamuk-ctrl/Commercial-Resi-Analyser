import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Project } from '../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from '../lib/conversion-types';
import { defaultCalculatorInputs } from '../lib/conversion-defaults';
import { calculateAppraisal } from '../lib/conversion-calc-engine';
import { buildCashflow } from '../lib/conversion-cashflow';
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
  { key: 'investor_summary', label: 'Investor', num: 10 },
];

interface Props {
  project: Project | null;
}

export default function ConversionCalculator({ project }: Props) {
  const [activePage, setActivePage] = useState<CalcPage>('acquisition');
  const [inputs, setInputs] = useState<CalculatorInputs>(() =>
    defaultCalculatorInputs(project ?? undefined),
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setInputs(defaultCalculatorInputs(project));
      setSavedId(null);
      getAppraisal(project.id)
        .then((appraisal) => {
          if (appraisal.inputs_snapshot && typeof appraisal.inputs_snapshot === 'object') {
            setInputs(appraisal.inputs_snapshot as unknown as CalculatorInputs);
            setSavedId(appraisal.id);
          }
        })
        .catch(() => {});
    }
  }, [project]);

  const metrics: AppraisalMetrics = useMemo(() => calculateAppraisal(inputs), [inputs]);
  const cashflow: CashflowResult = useMemo(() => buildCashflow(inputs), [inputs]);

  const updateInputs = useCallback((partial: Partial<CalculatorInputs>) => {
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
        gdv_pence: metrics.total_gdv_pence,
        total_cost_pence: metrics.total_cost_pence,
        profit_on_cost_pct: metrics.profit_on_cost_pct,
        profit_on_gdv_pct: metrics.profit_on_gdv_pct,
        return_on_equity_pct: metrics.return_on_equity_pct,
        irr: metrics.irr_annual,
        rlv_pence: metrics.rlv_pence,
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
  }, [project, inputs, metrics, savedId]);

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
          <AcquisitionPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'unit_mix' && (
          <UnitMixPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'conversion_costs' && (
          <ConversionCostsPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'finance' && (
          <FinancePage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'cashflow' && (
          <CashflowPage inputs={inputs} cashflow={cashflow} />
        )}
        {activePage === 'appraisal' && (
          <AppraisalSummaryPage metrics={metrics} inputs={inputs} />
        )}
        {activePage === 'scenarios' && (
          <ScenariosPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'exit_strategy' && (
          <ExitStrategyPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'risk_register' && (
          <RiskRegisterPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'investor_summary' && (
          <InvestorSummaryPage inputs={inputs} metrics={metrics} cashflow={cashflow} project={project} />
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
