import { useCallback } from 'react';
import type {
  CalculatorInputsV2, AppraisalRun, FacilityTerms, EquitySource,
  FundingSource, InterestType, ArrangementFeeBasis, ExitFeeBasis, EquityDrawRule,
  EquityClassification, EvidenceStatus,
} from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import ReconciliationStrip from './ReconciliationStrip';

interface Props {
  inputs: CalculatorInputsV2;
  onChange: (partial: Partial<CalculatorInputsV2>) => void;
  run: AppraisalRun;
}

const rowLabel: React.CSSProperties = { color: '#94a3b8', width: 240, fontSize: 13 };
const numInput: React.CSSProperties = {
  width: 160, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 13,
};

/** Blank ⇔ null, explicit 0 ⇔ 0 — never conflate "unknown" with "known to be zero" (spec §1.5). */
function PenceRow({ label, penceValue, onChangePence, nullable, placeholder }: {
  label: string;
  penceValue: number | null;
  onChangePence: (v: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={rowLabel}>{label}</label>
      <div style={{ position: 'relative', width: 200 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>£</span>
        <input
          type="number"
          value={penceValue === 0 ? 0 : penceValue != null ? penceValue / 100 : ''}
          placeholder={placeholder ?? (nullable ? 'unset' : undefined)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') { onChangePence(nullable ? null : 0); return; }
            onChangePence(Math.round(Number(raw) * 100));
          }}
          style={{ ...numInput, width: '100%', padding: '6px 10px 6px 24px' }}
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
      {suffix && <span style={{ color: '#64748b', fontSize: 12 }}>{suffix}</span>}
    </div>
  );
}

function MetricCard({ label, value, tooltip, highlight }: {
  label: string; value: string; tooltip: string; highlight?: boolean;
}) {
  return (
    <div
      title={tooltip}
      style={{
        padding: 14, background: '#0f172a', borderRadius: 8,
        border: `1px solid ${highlight ? '#2563eb' : '#1e3a5f'}`, marginBottom: 12,
      }}
    >
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color: highlight ? '#60a5fa' : '#e2e8f0', fontWeight: 700, fontSize: 17 }}>{value}</div>
    </div>
  );
}

function pctOrNa(v: number | null): string {
  return v == null ? 'n/a' : `${v.toFixed(2)}%`;
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
  const { metrics } = run;

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

  const setFundingSource = (source: FundingSource) => {
    if (source === 'cash') {
      updateFinance({
        funding_source: source,
        committed_net_facility_pence: 0,
        committed_gross_facility_pence: 0,
        day_one_advance_pence: null,
      });
    } else {
      updateFinance({ funding_source: source });
    }
  };

  const committedCashEquity = equity
    .filter((e) => e.classification === 'cash' && e.evidence_status !== 'rejected')
    .reduce((s, e) => s + e.amount_pence, 0);

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 16 }}>4. Finance Structure</h3>

      <ReconciliationStrip run={run} />

      {fin.legacy_leverage_pct != null ? (
        <div style={{ background: '#451a03', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 16px', marginBottom: 20, color: '#fbbf24', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Migrated from legacy &lsquo;LTV {fin.legacy_leverage_pct}%&rsquo; — the proposed facility below requires confirmation.</span>
          <button
            onClick={() => updateFinance({ requires_confirmation: false })}
            style={{ padding: '6px 14px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}
          >
            Confirm terms
          </button>
        </div>
      ) : fin.requires_confirmation && (
        <div style={{ background: '#451a03', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 16px', marginBottom: 20, color: '#fbbf24', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Facility terms require confirmation before lender use.</span>
          <button
            onClick={() => updateFinance({ requires_confirmation: false })}
            style={{ padding: '6px 14px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}
          >
            Confirm terms
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 560px', minWidth: 480 }}>
          <h4 style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Funding source</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <label style={rowLabel}>Funding source</label>
            <select
              value={fin.funding_source}
              onChange={(e) => setFundingSource(e.target.value as FundingSource)}
              style={selectStyle}
            >
              <option value="cash">Cash</option>
              <option value="bridging">Bridging Loan</option>
              <option value="development_finance">Development Finance</option>
            </select>
          </div>

          {!isCash && (
            <>
              <h4 style={{ color: '#94a3b8', fontSize: 13, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Facility terms</h4>
              <PenceRow
                label="Committed net facility (£)"
                penceValue={fin.committed_net_facility_pence}
                onChangePence={(v) => updateFinance({ committed_net_facility_pence: v })}
                nullable
              />
              <PenceRow
                label="Committed gross facility (£)"
                penceValue={fin.committed_gross_facility_pence}
                onChangePence={(v) => updateFinance({ committed_gross_facility_pence: v })}
                nullable
                placeholder="net + interest reserve"
              />
              <PenceRow
                label="Day-one advance (£)"
                penceValue={fin.day_one_advance_pence}
                onChangePence={(v) => updateFinance({ day_one_advance_pence: v })}
                nullable
                placeholder="not agreed — no day-one tranche"
              />
              <PenceRow
                label="Day-one market value (£)"
                penceValue={fin.day_one_market_value_pence}
                onChangePence={(v) => updateFinance({ day_one_market_value_pence: v })}
                nullable
              />
              <PenceRow
                label="Interest reserve (£)"
                penceValue={fin.interest_reserve_pence}
                onChangePence={(v) => updateFinance({ interest_reserve_pence: v })}
                nullable
              />
              <NumRow
                label="Interest rate (% p.a.)"
                value={fin.annual_interest_rate_pct}
                onChangeValue={(v) => updateFinance({ annual_interest_rate_pct: v })}
                step="0.1"
              />
              <NumRow
                label="Development cost advance (%)"
                value={fin.development_cost_advance_pct}
                onChangeValue={(v) => updateFinance({ development_cost_advance_pct: v })}
              />
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
              <NumRow
                label="Sales sweep (%)"
                value={fin.sales_sweep_pct}
                onChangeValue={(v) => updateFinance({ sales_sweep_pct: v })}
              />
              <NumRow
                label="Facility term (months)"
                value={fin.term_months}
                onChangeValue={(v) => updateFinance({ term_months: v })}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={rowLabel}>Equity draw rule</label>
                <select
                  value={fin.equity_draw_rule}
                  onChange={(e) => updateFinance({ equity_draw_rule: e.target.value as EquityDrawRule })}
                  style={selectStyle}
                >
                  <option value="equity_first">Equity first</option>
                  <option value="pari_passu" disabled title="not yet supported">Pari passu (not yet supported)</option>
                  <option value="fund_as_required">Fund as required</option>
                </select>
              </div>

              <h4 style={{ color: '#94a3b8', fontSize: 13, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Ancillary lender fees</h4>
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

          <h4 style={{ color: '#94a3b8', fontSize: 13, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Equity sources</h4>
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
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>£</span>
                    <input
                      type="number"
                      value={e.amount_pence != null ? e.amount_pence / 100 : ''}
                      onChange={(ev) => {
                        const raw = ev.target.value;
                        updateEquitySource(e.id, { amount_pence: raw === '' ? 0 : Math.round(Number(raw) * 100) });
                      }}
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
            style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginTop: 4, marginBottom: 16 }}
          >
            + Add Equity Source
          </button>

          <div style={{ padding: '10px 16px', background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontSize: 13 }}>
            <span>Committed cash equity</span>
            <span style={{ fontWeight: 600 }}>{penceToPounds(committedCashEquity)}</span>
          </div>
        </div>

        <div style={{ flex: '0 0 260px', position: 'sticky', top: 0 }}>
          <MetricCard
            label="Day-one advance"
            value={penceToPounds(metrics.day_one_advance_pence)}
            tooltip="§5.1: the actual month-0 senior draw (not the committed facility)."
          />
          <MetricCard
            label="Day-one LTV (price)"
            value={pctOrNa(metrics.day_one_ltv_on_price_pct)}
            tooltip="§5.1: day-one advance ÷ purchase price."
          />
          <MetricCard
            label="Net LTC"
            value={pctOrNa(metrics.net_ltc_pct)}
            tooltip="§5.4: numerator = cumulative net senior advances (principal draws + capitalised non-interest fees, excludes rolled-up interest). Denominator = development cost before disposal and finance."
          />
          <MetricCard
            label="Gross LTC"
            value={pctOrNa(metrics.gross_ltc_pct)}
            tooltip="§5.5: numerator = peak gross senior debt. Denominator = total development cost (TDC)."
          />
          <MetricCard
            label="LTGDV (developer)"
            value={pctOrNa(metrics.ltgdv_developer_pct)}
            tooltip="§5.6: numerator = peak gross senior debt. Denominator = developer GDV."
          />
          <MetricCard
            label="Peak debt"
            value={`${penceToPounds(metrics.peak_debt_pence)}${metrics.peak_debt_month != null ? ` (Month ${metrics.peak_debt_month})` : ''}`}
            tooltip="§5.7: max over months of the intra-month maximum balance (opening + draw + capitalised fees + interest accrued if rolled up) before that month's repayment."
          />
          <MetricCard
            label="Facility headroom"
            value={metrics.facility_headroom_pence == null ? 'n/a' : penceToPounds(metrics.facility_headroom_pence)}
            tooltip="§5.9: committed gross facility − peak gross debt. Negative headroom is flagged red — the model never silently expands the facility."
          />
          <MetricCard
            label="Finance costs"
            value={penceToPounds(metrics.finance_costs_pence)}
            tooltip="§3.9: Σ interest accrued + arrangement fee + exit fee + other lender fees. Exactly zero under cash funding."
            highlight
          />
        </div>
      </div>
    </div>
  );
}
