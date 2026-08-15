import { useMemo, useCallback } from 'react';
import type { ExitRoute } from '../../lib/conversion-types';
import type { CalculatorInputsV4, AppraisalRun, SalesPhasingInputs, RefinanceInputs } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV4;
  onChange: (partial: Partial<CalculatorInputsV4>) => void;
  run: AppraisalRun;
}

export default function ExitStrategyPage({ inputs, onChange, run }: Props) {
  const exit = inputs.exit_strategy;
  const units = inputs.unit_mix.units;

  const updateExit = useCallback(
    (partial: Partial<typeof exit>) => {
      onChange({ exit_strategy: { ...exit, ...partial } });
    },
    [exit, onChange],
  );

  const updateRetained = useCallback(
    (unitId: string, rent: number) => {
      const existing = exit.retained_units.filter((r) => r.unit_id !== unitId);
      if (rent > 0) {
        existing.push({ unit_id: unitId, monthly_rent_pence: rent });
      }
      updateExit({ retained_units: existing });
    },
    [exit, updateExit],
  );

  const totalAnnualRent = useMemo(
    () => exit.retained_units.reduce((s, r) => s + r.monthly_rent_pence * 12, 0),
    [exit.retained_units],
  );

  const retainedCapitalValue = useMemo(
    () =>
      exit.retained_units.reduce((s, r) => {
        const unit = units.find((u) => u.id === r.unit_id);
        return s + (unit?.estimated_value_pence ?? 0);
      }, 0),
    [exit.retained_units, units],
  );

  const grossYield = retainedCapitalValue > 0 ? (totalAnnualRent / retainedCapitalValue) * 100 : 0;

  // Selling costs come from the shared engine (run.schedule / run.metrics) —
  // component-local disposal formulas are prohibited.
  const sellingCosts = run.metrics.selling_costs_pence;

  const phasing = inputs.sales_phasing;
  const refinance = inputs.refinance;
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const pctSum = phasing?.tranches.reduce((a, b) => a + b.pct_of_gross_receipts, 0) ?? 0;

  const togglePhasing = () => onChange({
    sales_phasing: phasing ? null
      : { tranches: [{ month_offset: term - 1, pct_of_gross_receipts: 100 }] },
  });
  const updateTranche = (i: number, partial: Partial<SalesPhasingInputs['tranches'][number]>) => {
    if (!phasing) return;
    const tranches = phasing.tranches.map((t, j) => (j === i ? { ...t, ...partial } : t));
    onChange({ sales_phasing: { tranches } });
  };
  const addTranche = () => phasing && onChange({ sales_phasing: {
    tranches: [...phasing.tranches, { month_offset: term - 1, pct_of_gross_receipts: 0 }],
  } });
  const removeTranche = (i: number) => phasing && onChange({ sales_phasing: {
    tranches: phasing.tranches.filter((_, j) => j !== i),
  } });

  const toggleRefinance = () => onChange({
    refinance: refinance ? null : {
      month_offset: term - 1, investment_value_pence: retainedCapitalValue,
      ltv_pct: 65, arrangement_fee_pence: 0, legal_costs_pence: 0,
    },
  });
  const updateRefinance = (partial: Partial<RefinanceInputs>) => {
    if (!refinance) return;
    onChange({ refinance: { ...refinance, ...partial } });
  };

  // Display-only mirror of spec §4.5's net-proceeds formula
  // (investment_value_pence * ltv_pct / 100, rounded, minus fees). The engine's
  // Schedule.refinance.net_proceeds_pence is not reachable from a prop-driven
  // preview before the block is saved and re-run, so this recomputes the same
  // arithmetic locally for preview purposes only.
  const refinanceNetProceeds = refinance
    ? Math.round(refinance.investment_value_pence * (refinance.ltv_pct / 100))
      - refinance.arrangement_fee_pence - refinance.legal_costs_pence
    : 0;

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>9. Exit Strategy</h3>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {(['sell_all', 'retain_all', 'blended'] as ExitRoute[]).map((route) => (
          <button
            key={route}
            onClick={() => updateExit({ route })}
            style={{
              padding: '10px 24px',
              background: exit.route === route ? '#1e3a5f' : '#0f172a',
              border: `1px solid ${exit.route === route ? '#2563eb' : '#1e3a5f'}`,
              borderRadius: 6,
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {route === 'sell_all' ? 'Sell All' : route === 'retain_all' ? 'Retain All (BTL)' : 'Blended'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 14 }}>Agent fee (%)</label>
          <input type="number" step="0.1" value={exit.selling_agent_fee_pct} onChange={(e) => updateExit({ selling_agent_fee_pct: Number(e.target.value) })} style={{ width: 100, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 14 }}>Legal fee (£)</label>
          <div style={{ position: 'relative', width: 140, display: 'inline-block' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
            <input type="number" value={exit.selling_legal_fee_pence ? exit.selling_legal_fee_pence / 100 : ''} onChange={(e) => updateExit({ selling_legal_fee_pence: Math.round(Number(e.target.value) * 100) })} style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
          </div>
        </div>
      </div>

      {(exit.route === 'retain_all' || exit.route === 'blended') && units.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Retained Units — Monthly Rent</h4>
          {units.map((unit, i) => {
            const retained = exit.retained_units.find((r) => r.unit_id === unit.id);
            return (
              <div key={unit.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ color: '#94a3b8', width: 140, fontSize: 14 }}>Unit {i + 1} ({unit.type})</span>
                <div style={{ position: 'relative', width: 140, display: 'inline-block' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                  <input
                    type="number"
                    value={(retained?.monthly_rent_pence ?? 0) ? (retained?.monthly_rent_pence ?? 0) / 100 : ''}
                    onChange={(e) => updateRetained(unit.id, Math.round(Number(e.target.value) * 100))}
                    style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
                <span style={{ color: '#64748b', fontSize: 13 }}>/month</span>
              </div>
            );
          })}
        </div>
      )}

      {exit.route !== 'retain_all' && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h4 style={{ color: '#94a3b8', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Sales Phasing</h4>
            <button
              onClick={togglePhasing}
              style={{
                padding: '6px 16px', background: phasing ? '#1e3a5f' : '#2563eb', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}
            >
              {phasing ? 'Disable phasing' : 'Phase the sales'}
            </button>
            {phasing && (
              <span style={{ color: Math.abs(pctSum - 100) > 1e-9 ? '#ef4444' : '#94a3b8', fontSize: 13, fontWeight: 600 }}>
                Σ {pctSum}%
              </span>
            )}
          </div>

          {phasing && (
            <div>
              {phasing.tranches.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 13, width: 50 }}>Month</label>
                  <input
                    type="number"
                    min={0}
                    max={term - 1}
                    value={t.month_offset}
                    onChange={(e) => updateTranche(i, { month_offset: Number(e.target.value) })}
                    style={{ width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                  <label style={{ color: '#94a3b8', fontSize: 13 }}>%</label>
                  <input
                    type="number"
                    step="0.1"
                    value={t.pct_of_gross_receipts}
                    onChange={(e) => updateTranche(i, { pct_of_gross_receipts: Number(e.target.value) })}
                    style={{ width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                  <button
                    onClick={() => removeTranche(i)}
                    aria-label="Remove tranche"
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={addTranche}
                style={{ padding: '6px 16px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Add tranche
              </button>
            </div>
          )}
        </div>
      )}

      {exit.route !== 'sell_all' && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h4 style={{ color: '#94a3b8', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Refinance</h4>
            <button
              onClick={toggleRefinance}
              style={{
                padding: '6px 16px', background: refinance ? '#1e3a5f' : '#2563eb', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}
            >
              {refinance ? 'Remove refinance' : 'Add refinance'}
            </button>
          </div>

          {refinance && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 13 }}>Month</label>
                  <input
                    type="number"
                    min={0}
                    max={term - 1}
                    value={refinance.month_offset}
                    onChange={(e) => updateRefinance({ month_offset: Number(e.target.value) })}
                    style={{ width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 13 }}>Investment value (£)</label>
                  <div style={{ position: 'relative', width: 140, display: 'inline-block' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                    <input
                      type="number"
                      value={refinance.investment_value_pence ? refinance.investment_value_pence / 100 : ''}
                      onChange={(e) => updateRefinance({ investment_value_pence: Math.round(Number(e.target.value) * 100) })}
                      style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 13 }}>LTV (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={refinance.ltv_pct}
                    onChange={(e) => updateRefinance({ ltv_pct: Number(e.target.value) })}
                    style={{ width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 13 }}>Arrangement fee (£)</label>
                  <div style={{ position: 'relative', width: 140, display: 'inline-block' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                    <input
                      type="number"
                      value={refinance.arrangement_fee_pence ? refinance.arrangement_fee_pence / 100 : ''}
                      onChange={(e) => updateRefinance({ arrangement_fee_pence: Math.round(Number(e.target.value) * 100) })}
                      style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 13 }}>Legal costs (£)</label>
                  <div style={{ position: 'relative', width: 140, display: 'inline-block' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                    <input
                      type="number"
                      value={refinance.legal_costs_pence ? refinance.legal_costs_pence / 100 : ''}
                      onChange={(e) => updateRefinance({ legal_costs_pence: Math.round(Number(e.target.value) * 100) })}
                      style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 14 }}>
                <span>Net refinance proceeds (preview)</span><span>{penceToPounds(refinanceNetProceeds)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Selling costs</span><span>{penceToPounds(sellingCosts)}</span>
        </div>
        {exit.retained_units.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
              <span>Annual rental income</span><span>{penceToPounds(totalAnnualRent)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600 }}>
              <span>Gross yield</span><span>{grossYield.toFixed(1)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
