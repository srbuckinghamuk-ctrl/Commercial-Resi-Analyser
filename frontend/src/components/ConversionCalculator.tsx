import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Project, FinancialAppraisal, FinancialAppraisalCreate } from '../types';
import { migrateInputsToV5 } from '../lib/model';
import { safeRunAppraisal } from '../lib/safe-run';
import type { AppraisalRun, CalculatorInputsV4 } from '../lib/model';
import { defaultCalculatorInputsV4 } from '../lib/conversion-defaults';
import { getAppraisal, saveAppraisal, ApiError, formatApiErrorDetail } from '../lib/api';
import CalculatorErrorBoundary from './CalculatorErrorBoundary';
import CalculatorFailurePanel from './CalculatorFailurePanel';

import AcquisitionPage from './calculator/AcquisitionPage';
import UnitMixPage from './calculator/UnitMixPage';
import ConversionCostsPage from './calculator/ConversionCostsPage';
import FinancePage from './calculator/FinancePage';
import ProgrammePage from './calculator/ProgrammePage';
import CashflowPage from './calculator/CashflowPage';
import AppraisalSummaryPage from './calculator/AppraisalSummaryPage';
import ScenariosPage from './calculator/ScenariosPage';
import SensitivityPage from './calculator/SensitivityPage';
import ExitStrategyPage from './calculator/ExitStrategyPage';
import RiskRegisterPage from './calculator/RiskRegisterPage';
import DealSpiderPage from './calculator/DealSpiderPage';
import InvestorSummaryPage from './calculator/InvestorSummaryPage';

type CalcPage =
  | 'acquisition'
  | 'unit_mix'
  | 'conversion_costs'
  | 'finance'
  | 'programme'
  | 'cashflow'
  | 'appraisal'
  | 'scenarios'
  | 'sensitivity'
  | 'exit_strategy'
  | 'risk_register'
  | 'deal_spider'
  | 'investor_summary';

const PAGES: { key: CalcPage; label: string; num: number }[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'unit_mix', label: 'Unit Mix', num: 2 },
  { key: 'conversion_costs', label: 'Costs', num: 3 },
  { key: 'finance', label: 'Finance', num: 4 },
  { key: 'programme', label: 'Programme', num: 5 },
  { key: 'cashflow', label: 'Cashflow', num: 6 },
  { key: 'appraisal', label: 'Appraisal', num: 7 },
  { key: 'scenarios', label: 'Scenarios', num: 8 },
  { key: 'sensitivity', label: 'Sensitivity', num: 9 },
  { key: 'exit_strategy', label: 'Exit', num: 10 },
  { key: 'risk_register', label: 'Risk', num: 11 },
  { key: 'deal_spider', label: 'Deal Spider', num: 12 },
  { key: 'investor_summary', label: 'Investor', num: 13 },
];

interface Props {
  project: Project | null;
}

/** Renders an ApiError as newline-joined lines: the summary followed by any
 * field-level messages from a 422/validation `detail` payload. */
function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const lines = formatApiErrorDetail(err.detail);
    return lines.length > 0 ? lines.join('\n') : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

const STATUS_BANNER: Record<
  'reconciled' | 'draft' | 'legacy_unreconciled',
  { label: string; color: string; background: string }
> = {
  reconciled: { label: 'Reconciled', color: '#22c55e', background: 'rgba(34, 197, 94, 0.12)' },
  draft: { label: 'Draft — unreconciled', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)' },
  legacy_unreconciled: {
    label: 'Legacy — recalculation required, save to migrate',
    color: '#ef4444',
    background: 'rgba(239, 68, 68, 0.12)',
  },
};

export default function ConversionCalculator({ project }: Props) {
  const [activePage, setActivePage] = useState<CalcPage>('acquisition');
  const [inputs, setInputs] = useState<CalculatorInputsV4>(() =>
    defaultCalculatorInputsV4(project ?? undefined),
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [appraisalRecord, setAppraisalRecord] = useState<FinancialAppraisal | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setInputs(defaultCalculatorInputsV4(project));
      setSavedId(null);
      setAppraisalRecord(null);
      setSaveError(null);
      setLoadError(null);
      getAppraisal(project.id)
        .then((appraisal) => {
          if (appraisal.inputs_snapshot && typeof appraisal.inputs_snapshot === 'object') {
            // Migrate onto v5 defaults so snapshots saved before newer
            // sections (or v1/v2/v3/v4 snapshots) existed still load cleanly.
            // R8 Task 10: migrateInputsToV4 now throws on a v5 document (the
            // server already normalises to v5, per app/api/app.py), so this
            // must use migrateInputsToV5 too.
            //
            // The cast back to CalculatorInputsV4 is deliberate and narrow:
            // widening this component's state (and every calculator sub-page
            // prop it feeds) to CalculatorInputsV5 is Task 11's job, which
            // also builds the UI that reads/writes the six new acquisition
            // fields. Until then the runtime object still carries them (a JS
            // object keeps every property regardless of the TS view of it),
            // so nothing is lost on save -- only unreadable to this
            // component's own code, which never branches on inputs_version's
            // literal value (grep confirms) so the mismatched literal type is
            // safe to paper over here.
            setInputs(
              migrateInputsToV5(
                appraisal.inputs_snapshot as Record<string, unknown>, project,
              ) as unknown as CalculatorInputsV4,
            );
            setSavedId(appraisal.id);
          }
          setAppraisalRecord(appraisal);
        })
        .catch((err) => {
          // No appraisal saved yet for this project is expected, not an error.
          if (err instanceof ApiError && err.status === 404) return;
          setLoadError(describeApiError(err, 'Failed to load the saved appraisal.'));
        });
    }
  }, [project]);

  // R3b: state is v4-native, so the engine is fed `inputs` directly -- no
  // widening call site needed any more.
  //
  // This call sits in THIS component's render body, above CalculatorErrorBoundary
  // in the tree. A React boundary only catches throws from its descendants, so an
  // engine throw here escapes it entirely and unmounts the calculator along with
  // every unsaved edit. safeRunAppraisal turns that throw into a value so this
  // component survives and can offer a way back (spec §2 forbids substituting a
  // stale or default run for a failed one, so nothing is displayed from the last
  // successful calculation).
  const runResult = useMemo(() => safeRunAppraisal(inputs), [inputs]);
  const run: AppraisalRun | null = runResult.ok ? runResult.run : null;

  // The most recent inputs the engine could compute, so the failure panel can
  // offer a genuine undo. Recorded after commit -- never mutated during render.
  const lastComputableInputs = useRef<CalculatorInputsV4 | null>(null);
  useEffect(() => {
    if (runResult.ok) lastComputableInputs.current = inputs;
  }, [runResult, inputs]);

  const updateInputs = useCallback((partial: Partial<CalculatorInputsV4>) => {
    setInputs((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleSave = useCallback(async () => {
    // No run means the engine could not compute this document, so the advisory
    // client metrics below cannot be derived. The save button is disabled in
    // that state; this guard keeps the invariant if it is ever called directly.
    if (!project || run == null) return;
    setSaving(true);
    setSaveError(null);
    try {
      // inputs_snapshot is always v4 (R3b: this component's state is v4-native); the
      // seven client metric fields are used server-side ONLY to record mismatches for
      // audit -- the server always recalculates and persists its own values (Task 12).
      const payload: FinancialAppraisalCreate = {
        project_id: project.id,
        name: `Appraisal — ${project.address_raw}`,
        inputs_snapshot: inputs as unknown as Record<string, unknown>,
        gdv_pence: run.metrics.gdv_pence,
        total_cost_pence: run.metrics.total_development_cost_pence,
        profit_on_cost_pct: run.metrics.profit_on_cost_pct ?? undefined,
        profit_on_gdv_pct: run.metrics.profit_on_gdv_pct ?? undefined,
        return_on_equity_pct: run.metrics.return_on_equity_pct ?? undefined,
        irr: run.metrics.irr_annual_pct ?? undefined,
        rlv_pence: run.metrics.rlv_pence,
      };
      const result = await saveAppraisal(project.id, payload, savedId);
      setSavedId(result.id);
      setAppraisalRecord(result);
    } catch (err) {
      setSaveError(describeApiError(err, 'Failed to save the appraisal.'));
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

      {/* Page content — CRITICAL 1d: scoped to the page body + run-derived UI
          only, not the whole component, so nav/save/status chrome and this
          component's own state survive a thrown render. `resetKeys` clears the
          fallback when the user navigates to another page, so one page throwing
          does not leave every tab blank until a full reload. */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {run == null ? (
          // The engine threw for these inputs. Every page reads the run, so no
          // page can be shown -- and showing the previous run would present a
          // number that is not the current calculation (spec §2). The undo below
          // is the recovery that actually works: this component survived, so it
          // still holds the last inputs that computed.
          <CalculatorFailurePanel
            title="The appraisal could not be calculated"
            actionLabel={lastComputableInputs.current ? 'Undo last change' : undefined}
            onAction={() => {
              const restore = lastComputableInputs.current;
              if (restore) setInputs(restore);
            }}
          >
            The last change produced inputs this engine cannot compute, so no figures are shown
            rather than stale ones. Your saved appraisal is unaffected and nothing has been sent
            to the server. Undo the change to carry on{lastComputableInputs.current ? '' : ', or reload'}.
          </CalculatorFailurePanel>
        ) : (
        <CalculatorErrorBoundary resetKeys={[activePage]}>
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
        {activePage === 'programme' && (
          <ProgrammePage inputs={inputs} onChange={updateInputs} run={run} />
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
        {activePage === 'sensitivity' && (
          <SensitivityPage inputs={inputs} />
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
        </CalculatorErrorBoundary>
        )}
      </div>

      {/* Status / error banners */}
      {(appraisalRecord?.status || saveError || loadError) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 24px',
            borderTop: '1px solid #1e3a5f',
            background: '#0d1b2a',
            flexShrink: 0,
          }}
        >
          {appraisalRecord?.status && (
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color: STATUS_BANNER[appraisalRecord.status].color,
                background: STATUS_BANNER[appraisalRecord.status].background,
                border: `1px solid ${STATUS_BANNER[appraisalRecord.status].color}`,
              }}
            >
              {STATUS_BANNER[appraisalRecord.status].label}
              {(appraisalRecord.validation?.client_mismatches?.length ?? 0) > 0 && (
                <span style={{ fontWeight: 400, marginLeft: 8 }}>
                  ({appraisalRecord.validation!.client_mismatches.length} client metric{' '}
                  {appraisalRecord.validation!.client_mismatches.length === 1 ? 'mismatch' : 'mismatches'}{' '}
                  recorded for audit)
                </span>
              )}
            </div>
          )}
          {loadError && (
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 13,
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Failed to load saved appraisal</div>
              {loadError.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
          {saveError && (
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 13,
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Save failed</div>
              {saveError.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

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
          // A document the engine cannot compute has no client metrics to send
          // and should not be persisted as if it were a valid appraisal.
          disabled={saving || run == null}
          title={run == null ? 'The appraisal must calculate before it can be saved.' : undefined}
          style={{
            padding: '8px 24px',
            background: saving || run == null ? '#1e293b' : '#2563eb',
            color: saving || run == null ? '#475569' : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: saving || run == null ? 'default' : 'pointer',
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
