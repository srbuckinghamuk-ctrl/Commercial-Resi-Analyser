import { useMemo } from 'react';
import type { ScenarioOverrides } from '../../lib/conversion-types';
import type { AppraisalRun, CalculatorInputsV16, ValidationIssue } from '../../lib/model';
import { runAppraisal, validateInputs, isProgrammeNetwork } from '../../lib/model';
import { applyScenario } from '../../lib/model/apply-scenario';
import { unmeasuredCellNote } from '../../lib/sensitivity-format';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV16;
  onChange: (partial: Partial<CalculatorInputsV16>) => void;
}

type ScenarioKey = 'base' | 'upside' | 'downside' | 'severe';

const scenarioKeys: ScenarioKey[] = ['base', 'upside', 'downside', 'severe'];

/**
 * Every numeric `ScenarioOverrides` field, declaratively (spec §25) — labels
 * and steps only; `phase_slip_phase_id` is excluded because it is not a
 * number, and gets its own picker below.
 *
 * The `satisfies Record<Exclude<keyof ScenarioOverrides, 'label' |
 * 'phase_slip_phase_id'>, ...>` below is what makes this exhaustive: TS
 * excess/missing-property checking on a `satisfies` object literal requires
 * every one of those keys to be present and rejects any key that is not one
 * of them, so a future field added to `ScenarioOverrides` without an entry
 * here — or a stale entry for a field since removed — is a compile error, not
 * a silent gap a caller discovers at runtime. A bare `ReadonlyArray<{ field:
 * Union }>` (this file's previous shape) cannot make that guarantee: it
 * constrains each entry's `field` to a valid member but has no way to notice
 * a member with NO entry, since nothing forces the array's length to track
 * the union's size.
 */
const SCENARIO_INPUT_META = {
  gdv_adjustment_pct: { label: 'GDV adjustment (%)', step: '1' },
  construction_cost_adjustment_pct: { label: 'Construction cost adjustment (%)', step: '1' },
  timeline_adjustment_months: { label: 'Timeline adjustment (months)', step: '1' },
  interest_rate_adjustment_pct: { label: 'Interest rate adjustment (%)', step: '0.1' },
  sales_slip_months: { label: 'Sales slip (months)', step: '1' },
  exit_yield_adjustment_pct: { label: 'Exit yield adjustment (pp)', step: '0.1' },
  operating_cost_adjustment_pct: { label: 'Operating cost adjustment (%)', step: '1' },
  vacancy_adjustment_pct: { label: 'Vacancy adjustment (pp)', step: '0.1' },
  phase_slip_months: { label: 'Phase slip (months)', step: '1' },
  saleable_area_adjustment_pct: { label: 'Saleable area adjustment (%)', step: '1' },
  abnormal_cost_adjustment_pct: { label: 'Abnormal cost (pp)', step: '0.1' },
  programme_slip_months: { label: 'Programme slip (months)', step: '1' },
  refi_ltv_adjustment_pct: { label: 'Refinance LTV reduction (pp)', step: '0.1' },
} satisfies Record<Exclude<keyof ScenarioOverrides, 'label' | 'phase_slip_phase_id'>, { label: string; step: string }>;

/** `SCENARIO_INPUT_META`, as the ordered array the cards render — object key
 *  order for these string keys is insertion order, so this reproduces the
 *  literal's own field order above. */
const SCENARIO_INPUTS: ReadonlyArray<{
  field: keyof typeof SCENARIO_INPUT_META;
  label: string;
  step: string;
}> = (Object.keys(SCENARIO_INPUT_META) as Array<keyof typeof SCENARIO_INPUT_META>)
  .map((field) => ({ field, ...SCENARIO_INPUT_META[field] }));

function pctOrNa(v: number | null): string {
  return v == null ? 'n/a' : `${v.toFixed(1)}%`;
}

/** A card's outcome (spec §12.7): the levered document is validated before it
 *  is appraised, and a document that fails validation is never appraised —
 *  it is reported as not measured, with the engine's own reason. */
type ScenarioOutcome =
  | { ok: true; run: AppraisalRun }
  | { ok: false; errors: ValidationIssue[] };

function measureScenario(inputs: CalculatorInputsV16, overrides: ScenarioOverrides): ScenarioOutcome {
  const levered = applyScenario(inputs, overrides);
  const errors = validateInputs(levered).filter((i) => i.severity === 'error');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, run: runAppraisal(levered) };
}

export default function ScenariosPage({ inputs, onChange }: Props) {
  // `isProgrammeNetwork` is the sole sanctioned discriminator (programme.ts),
  // the same check SensitivityPage.tsx uses — a `programme = null` document
  // has no phase to slip, so the picker stays off every card for it.
  const network = inputs.programme != null && isProgrammeNetwork(inputs.programme)
    ? inputs.programme
    : null;
  const phases = network?.phases ?? [];

  const outcomes = useMemo(
    () => Object.fromEntries(
      scenarioKeys.map((key) => [key, measureScenario(inputs, inputs.scenarios[key])]),
    ) as Record<ScenarioKey, ScenarioOutcome>,
    [inputs],
  );

  const updateScenario = (key: ScenarioKey, partial: Partial<ScenarioOverrides>) => {
    onChange({
      scenarios: {
        ...inputs.scenarios,
        [key]: { ...inputs.scenarios[key], ...partial },
      },
    });
  };

  const metricRows: { label: string; accessor: (r: AppraisalRun) => string }[] = [
    { label: 'GDV', accessor: (r) => penceToPounds(r.metrics.gdv_pence) },
    { label: 'Total Development Cost', accessor: (r) => penceToPounds(r.metrics.total_development_cost_pence) },
    { label: 'Profit', accessor: (r) => penceToPounds(r.metrics.profit_pence) },
    { label: 'Profit on Cost', accessor: (r) => pctOrNa(r.metrics.profit_on_cost_pct) },
    { label: 'Profit on GDV', accessor: (r) => pctOrNa(r.metrics.profit_on_gdv_pct) },
    { label: 'IRR (Annual)', accessor: (r) => pctOrNa(r.metrics.irr_annual_pct) },
    { label: 'Return on Equity', accessor: (r) => pctOrNa(r.metrics.return_on_equity_pct) },
  ];

  const failedCards = scenarioKeys
    .map((key) => ({ key, outcome: outcomes[key] }))
    .filter((c): c is { key: ScenarioKey; outcome: { ok: false; errors: ValidationIssue[] } } => !c.outcome.ok);

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>11. Scenario Comparison</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {scenarioKeys.map((key) => (
          <div key={key} style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
            <h4 style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 12 }}>{inputs.scenarios[key].label}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SCENARIO_INPUTS.map(({ field, label, step }) => (
                <label key={field} style={{ color: '#94a3b8', fontSize: 13 }}>
                  {label}
                  <input
                    type="number"
                    step={step}
                    value={inputs.scenarios[key][field]}
                    onChange={(e) => updateScenario(key, { [field]: Number(e.target.value) } as Partial<ScenarioOverrides>)}
                    style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </label>
              ))}
              {network != null && (
                <label style={{ color: '#94a3b8', fontSize: 13 }}>
                  Phase to slip
                  <select
                    value={inputs.scenarios[key].phase_slip_phase_id ?? ''}
                    onChange={(e) => updateScenario(key, { phase_slip_phase_id: e.target.value === '' ? null : e.target.value })}
                    style={{ display: 'block', width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  >
                    <option value="">— none —</option>
                    {phases.map((p) => (
                      <option key={p.id} value={p.id}>{p.label || p.id}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              <th style={{ padding: '8px 12px', color: '#94a3b8', textAlign: 'left' }}>Metric</th>
              {scenarioKeys.map((key) => (
                <th key={key} style={{ padding: '8px 12px', color: '#94a3b8', textAlign: 'right' }}>{inputs.scenarios[key].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{row.label}</td>
                {scenarioKeys.map((key) => {
                  const outcome = outcomes[key];
                  return (
                    <td key={key} style={{ padding: '8px 12px', color: outcome.ok ? '#e2e8f0' : '#94a3b8', textAlign: 'right', fontWeight: key === 'base' ? 600 : 400 }}>
                      {outcome.ok ? row.accessor(outcome.run) : 'not measured'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failedCards.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          {failedCards.map(({ key, outcome }) => (
            <p key={key} style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0' }}>
              {inputs.scenarios[key].label}: {unmeasuredCellNote(outcome.errors[0].message)}
            </p>
          ))}
        </div>
      )}

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Flags by Scenario</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
        {scenarioKeys.map((key) => {
          const outcome = outcomes[key];
          return (
            <div key={key} style={{ padding: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', minHeight: 40 }}>
              {!outcome.ok ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  {unmeasuredCellNote(outcome.errors[0].message)}
                </div>
              ) : outcome.run.metrics.flags.length === 0 ? (
                <span style={{ color: '#22c55e', fontSize: 12 }}>No flags</span>
              ) : (
                outcome.run.metrics.flags.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12, marginBottom: 6,
                      color: f.severity === 'red' ? '#fca5a5' : f.severity === 'amber' ? '#fbbf24' : '#94a3b8',
                    }}
                  >
                    {f.message}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
