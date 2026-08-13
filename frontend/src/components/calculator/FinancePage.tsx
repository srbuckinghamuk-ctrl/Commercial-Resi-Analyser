import { useCallback } from 'react';
import type {
  CalculatorInputsV2, AppraisalRun, FacilityTerms, EquitySource,
  FundingSource, InterestType, ArrangementFeeBasis, ExitFeeBasis, EquityDrawRule,
  EquityClassification, EvidenceStatus,
} from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV2;
  onChange: (partial: Partial<CalculatorInputsV2>) => void;
  run: AppraisalRun;
}

const rowLabel: React.CSSProperties = { color: '#94a3b8', width: 240, fontSize: 14 };
const numInput: React.CSSProperties = {
  width: 160, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 14,
};
const selectStyle: React.CSSProperties = {
  padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 14,
};

function PenceRow({ label, penceValue, onChangePence, nullable, disabled }: {
  label: string;
  penceValue: number | null;
  onChangePence: (v: number | null) => void;
  nullable?: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={rowLabel}>{label}</label>
      <div style={{ position: 'relative', width: 160 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
        <input
          type="number"
          disabled={disabled}
          value={penceValue != null && penceValue !== 0 ? penceValue / 100 : penceValue === 0 ? 0 : ''}
          placeholder={nullable ? 'unset' : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '' && nullable) { onChangePence(null); return; }
            onChangePence(Math.round(Number(raw) * 100));
          }}
          style={{ ...numInput, width: '100%', padding: '6px 10px 6px 24px', opacity: disabled ? 0.5 : 1 }}
        />
      </div>
    </div>
  );
}

function NumRow({ label, value, onChangeValue, suffix, step }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={rowLabel}>{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={numInput}
      />
      {suffix && <span style={{ color: '#64748b', fontSize: 13 }}>{suffix}</span>}
    </div>
  );
}

const EQUITY_CLASSES: { value: EquityClassification; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'land', label: 'Land' },
  { value: 'planning_uplift', label: 'Planning uplift' },
  { value: 'vendor_finance', label: 'Vendor finance' },
  { value: 'deferred_consideration', label: 'Deferred consideration' },
  { value: 'other_subordinated', label: 'Other subordinated' },
];

const EVIDENCE_STATUSES: EvidenceStatus[] = ['confirmed', 'unconfirmed', 'rejected'];

export default function FinancePage({ inputs, onChange, run }: Props) {
  const fin = inputs.finance;
  const equity = inputs.equity_sources;

  const updateFinance = useCallback(
    (partial: Partial<FacilityTerms>) => {
      onChange({ finance: { ...fin, ...partial } });
    },
    [fin, onChange],
  );

  const updateEquity = useCallback(
    (list: EquitySource[]) => onChange({ equity_sources: list }),
    [onChange],
  );

  const addEquitySource = useCallback(() => {
    updateEquity([
      ...equity,
      {
        id: crypto.randomUUID(),
        classification: 'cash',
        amount_pence: 0,
        timing_month: 0,
        repayment_priority: equity.length + 1,
        evidence_status: 'unconfirmed',
        notes: '',
      },
    ]);
  }, [equity, updateEquity]);

  const removeEquitySource = useCallback(
    (id: string) => updateEquity(equity.filter((e) => e.id !== id)),
    [equity, updateEquity],
  );

  const updateEquitySource = useCallback(
    (id: string, partial: Partial<EquitySource>) =>
      updateEquity(equity.map((e) => (e.id === id ? { ...e, ...partial } : e))),
    [equity, updateEquity],
  );

  const isCash = fin.funding_source === 'cash';

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>4. Finance Structure</h3>

      {fin.requires_confirmation && (
        <div style={{ background: '#451a03', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 16px', marginBottom: 20, color: '#fbbf24', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Facility terms were migrated from a legacy appraisal and are unevidenced. Confirm before lender use.</span>
          <button
            onClick={() => updateFinance({ requires_confirmation: false })}
            style={{ padding: '6px 14px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}
          >
            Mark confirmed
          </button>
        </div>
      )}

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Facility</h4>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={rowLabel}>Funding source</label>
        <select
          value={fin.funding_source}
          onChange={(e) => updateFinance({ funding_source: e.target.value as FundingSource })}
          style={selectStyle}
        >
          <option value="cash">Cash</option>
          <option value="bridging">Bridging Loan</option>
          <option value="development_finance">Development Finance</option>
        </select>
      </div>

      {!isCash && (
        <>
          <PenceRow
            label="Committed net facility (£)"
            penceValue={fin.committed_net_facility_pence}
            onChangePence={(v) => updateFinance({ committed_net_facility_pence: v })}
          />
          <PenceRow
            label="Committed gross facility (£)"
            penceValue={fin.committed_gross_facility_pence}
            onChangePence={(v) => updateFinance({ committed_gross_facility_pence: v })}
            nullable
          />
          <PenceRow
            label="Day-one advance (£)"
            penceValue={fin.day_one_advance_pence}
            onChangePence={(v) => updateFinance({ day_one_advance_pence: v })}
            nullable
          />
          <PenceRow
            label="Day-one market value (£)"
            penceValue={fin.day_one_market_value_pence}
            onChangePence={(v) => updateFinance({ day_one_market_value_pence: v })}
            nullable
          />
          <NumRow
            label="Development cost advance (%)"
            value={fin.development_cost_advance_pct}
            onChangeValue={(v) => updateFinance({ development_cost_advance_pct: v })}
          />
          <NumRow
            label="Interest rate (% p.a.)"
            value={fin.annual_interest_rate_pct}
            onChangeValue={(v) => updateFinance({ annual_interest_rate_pct: v })}
            step="0.1"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={rowLabel}>Interest type</label>
            <select
              value={fin.interest_type}
              onChange={(e) => updateFinance({ interest_type: e.target.value as InterestType })}
              style={selectStyle}
            >
              <option value="rolled_up">Rolled Up</option>
              <option value="serviced">Serviced</option>
            </select>
          </div>
          <NumRow
            label="Facility term (months)"
            value={fin.term_months}
            onChangeValue={(v) => updateFinance({ term_months: v })}
          />
          <PenceRow
            label="Interest reserve (£)"
            penceValue={fin.interest_reserve_pence}
            onChangePence={(v) => updateFinance({ interest_reserve_pence: v })}
            nullable
          />
          <NumRow
            label="Sales sweep (%)"
            value={fin.sales_sweep_pct}
            onChangeValue={(v) => updateFinance({ sales_sweep_pct: v })}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={rowLabel}>Equity draw rule</label>
            <select
              value={fin.equity_draw_rule}
              onChange={(e) => updateFinance({ equity_draw_rule: e.target.value as EquityDrawRule })}
              style={selectStyle}
            >
              <option value="equity_first">Equity first</option>
              <option value="pari_passu">Pari passu</option>
              <option value="fund_as_required">Fund as required</option>
            </select>
          </div>

          <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Fees</h4>
          <NumRow
            label="Arrangement fee (%)"
            value={fin.arrangement_fee_pct}
            onChangeValue={(v) => updateFinance({ arrangement_fee_pct: v })}
            step="0.1"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={rowLabel}>Arrangement fee basis</label>
            <select
              value={fin.arrangement_fee_basis}
              onChange={(e) => updateFinance({ arrangement_fee_basis: e.target.value as ArrangementFeeBasis })}
              style={selectStyle}
            >
              <option value="committed_net_facility">Committed net facility</option>
              <option value="committed_gross_facility">Committed gross facility</option>
            </select>
          </div>
          <NumRow
            label="Exit fee (%)"
            value={fin.exit_fee_pct}
            onChangeValue={(v) => updateFinance({ exit_fee_pct: v })}
            step="0.1"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={rowLabel}>Exit fee basis</label>
            <select
              value={fin.exit_fee_basis}
              onChange={(e) => updateFinance({ exit_fee_basis: e.target.value as ExitFeeBasis })}
              style={selectStyle}
            >
              <option value="committed_gross_facility">Committed gross facility</option>
              <option value="peak_debt">Peak debt</option>
              <option value="redemption_balance">Redemption balance</option>
            </select>
          </div>
          <PenceRow
            label="Broker fee (£)"
            penceValue={fin.broker_fee_pence}
            onChangePence={(v) => updateFinance({ broker_fee_pence: v ?? 0 })}
          />
          <PenceRow
            label="Lender legal fee (£)"
            penceValue={fin.lender_legal_fee_pence}
            onChangePence={(v) => updateFinance({ lender_legal_fee_pence: v ?? 0 })}
          />
          <PenceRow
            label="Valuation fee (£)"
            penceValue={fin.valuation_fee_pence}
            onChangePence={(v) => updateFinance({ valuation_fee_pence: v ?? 0 })}
          />
          <PenceRow
            label="Monitoring surveyor fee (£)"
            penceValue={fin.monitoring_surveyor_fee_pence}
            onChangePence={(v) => updateFinance({ monitoring_surveyor_fee_pence: v ?? 0 })}
          />
        </>
      )}

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Equity Sources</h4>
      {equity.map((e, i) => (
        <div key={e.id} style={{ padding: 14, marginBottom: 10, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>Source {i + 1}</span>
            <button
              onClick={() => removeEquitySource(e.id)}
              style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
            >
              Remove
            </button>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Classification</label>
              <select
                value={e.classification}
                onChange={(ev) => updateEquitySource(e.id, { classification: ev.target.value as EquityClassification })}
                style={selectStyle}
              >
                {EQUITY_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Amount (£)</label>
              <div style={{ position: 'relative', width: 140 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                <input
                  type="number"
                  value={e.amount_pence ? e.amount_pence / 100 : ''}
                  onChange={(ev) => updateEquitySource(e.id, { amount_pence: Math.round(Number(ev.target.value) * 100) })}
                  style={{ ...numInput, width: '100%', padding: '6px 10px 6px 24px' }}
                />
              </div>
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Timing (month)</label>
              <input
                type="number"
                min={0}
                value={e.timing_month}
                onChange={(ev) => updateEquitySource(e.id, { timing_month: Number(ev.target.value) })}
                style={{ ...numInput, width: 100 }}
              />
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Repayment priority</label>
              <input
                type="number"
                min={1}
                value={e.repayment_priority}
                onChange={(ev) => updateEquitySource(e.id, { repayment_priority: Number(ev.target.value) })}
                style={{ ...numInput, width: 100 }}
              />
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Evidence</label>
              <select
                value={e.evidence_status}
                onChange={(ev) => updateEquitySource(e.id, { evidence_status: ev.target.value as EvidenceStatus })}
                style={selectStyle}
              >
                {EVIDENCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Notes</label>
              <input
                type="text"
                value={e.notes}
                onChange={(ev) => updateEquitySource(e.id, { notes: ev.target.value })}
                style={{ ...numInput, width: '100%' }}
              />
            </div>
          </div>
        </div>
      ))}
      <button
        onClick={addEquitySource}
        style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 4, marginBottom: 24 }}
      >
        + Add Equity Source
      </button>

      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Peak debt</span>
          <span>{penceToPounds(run.metrics.peak_debt_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Equity contributed</span>
          <span>{penceToPounds(run.metrics.equity_contributed_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16, paddingTop: 8, borderTop: '1px solid #1e3a5f' }}>
          <span>Total Finance Cost</span>
          <span>{penceToPounds(run.metrics.finance_costs_pence)}</span>
        </div>
      </div>

      {run.model.flags.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {run.model.flags.map((f, i) => (
            <div
              key={i}
              style={{
                padding: '8px 14px', marginBottom: 6, borderRadius: 6, fontSize: 13,
                background: f.severity === 'red' ? '#450a0a' : f.severity === 'amber' ? '#451a03' : '#0f172a',
                border: `1px solid ${f.severity === 'red' ? '#ef4444' : f.severity === 'amber' ? '#f59e0b' : '#1e3a5f'}`,
                color: f.severity === 'red' ? '#fca5a5' : f.severity === 'amber' ? '#fbbf24' : '#94a3b8',
              }}
            >
              {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
