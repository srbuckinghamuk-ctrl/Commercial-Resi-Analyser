import type { AppraisalRun, CalculatorInputsV8 } from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import { formatProgrammeMonth, programmeAnchor } from '../../lib/programme-months';
import ReconciliationStrip from './ReconciliationStrip';
import CostToCompleteCard from './CostToCompleteCard';

interface Props {
  inputs: CalculatorInputsV8;
  onChange: (partial: Partial<CalculatorInputsV8>) => void;
  run: AppraisalRun;
}

function pctOrNa(v: number | null): string {
  return v == null ? 'n/a' : `${v.toFixed(2)}%`;
}

function MetricCard({ label, value, tooltip, highlight, negative }: {
  label: string; value: string; tooltip: string; highlight?: boolean; negative?: boolean;
}) {
  const color = negative ? '#ef4444' : highlight ? '#60a5fa' : '#e2e8f0';
  return (
    <div
      title={tooltip}
      style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: `1px solid ${highlight ? '#2563eb' : '#1e3a5f'}` }}
    >
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: 18 }}>{value}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h4 style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

/** §3.2: developer GDV vs lender-underwritten GDV, the variance between them, and the
 * provenance (reason — author, date) that produced the lender figure. Renders the existing
 * "not available" treatment — never a substituted number — whenever `lender_gdv_pence` is
 * null, whether because no lender valuation was recorded or because a recorded one could not
 * be computed (metrics.ts collapses both cases to null; the entry card on the Finance page
 * surfaces the distinction via its own validation messages). */
function LenderVarianceBridge({ inputs, run }: { inputs: CalculatorInputsV8; run: AppraisalRun }) {
  const { metrics } = run;
  const lv = inputs.lender_valuation;

  if (metrics.lender_gdv_pence == null || lv == null) {
    return (
      <div style={{ marginBottom: 28, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px dashed #1e3a5f' }}>
        <h4 style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
          Lender GDV variance bridge
        </h4>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          n/a — no lender valuation recorded. Add one on the Finance page to see the variance
          against developer GDV.
        </div>
      </div>
    );
  }

  const variancePence = metrics.lender_gdv_variance_pence;
  const variancePct = metrics.lender_gdv_variance_pct;
  const varianceNegative = variancePence != null && variancePence < 0;

  return (
    <div style={{ marginBottom: 28, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
      <h4 style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>
        Lender GDV variance bridge
      </h4>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Developer GDV</div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 17 }}>{penceToPounds(metrics.gdv_pence)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Lender GDV</div>
          <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 17 }}>{penceToPounds(metrics.lender_gdv_pence)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Variance</div>
          <div style={{ color: varianceNegative ? '#ef4444' : '#22c55e', fontWeight: 700, fontSize: 17 }}>
            {variancePence != null ? penceToPounds(variancePence) : 'n/a'} ({pctOrNa(variancePct)})
          </div>
        </div>
      </div>
      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        {lv.reason || '(no reason recorded)'} — {lv.author || '(no author recorded)'}, {lv.date || '(no date recorded)'}
      </div>
    </div>
  );
}

export default function AppraisalSummaryPage({ inputs, run }: Props) {
  const { metrics } = run;
  const target = inputs.deal_spider.target_profit_on_cost_pct;
  const reserveRemaining = metrics.interest_reserve_remaining_pence;
  // R8 Task 11: the acquisition tax line is not SDLT on a Scottish or Welsh
  // document. Name the regime the engine actually charged.
  const regime = metrics.acquisition_tax.regime;

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 16 }}>8. Appraisal Summary</h3>

      <ReconciliationStrip run={run} />

      {metrics.profit_is_unrealised && (
        <div style={{ marginBottom: 24, padding: '10px 16px', background: '#451a03', border: '1px solid #f59e0b', borderRadius: 8, color: '#fbbf24', fontSize: 13 }}>
          Profit includes {penceToPounds(metrics.unrealised_value_pence)} of unrealised value from retained units — not yet cash.
        </div>
      )}

      <Group title="Value">
        <MetricCard
          label="Developer GDV"
          value={penceToPounds(metrics.gdv_pence)}
          tooltip="§3.1: Σ unit.estimated_value_pence over all proposed units (developer values), gross of selling costs."
          highlight
        />
        <MetricCard
          label="Lender GDV"
          value={metrics.lender_gdv_pence == null ? 'n/a — no lender valuation recorded' : penceToPounds(metrics.lender_gdv_pence)}
          tooltip="§3.2: lender-underwritten GDV — Σ lender unit values under the recorded adjustment basis. Defaults to null (unknown), never silently to developer GDV."
        />
      </Group>

      <LenderVarianceBridge inputs={inputs} run={run} />

      <Group title="Cost">
        <MetricCard
          label="Acquisition"
          value={penceToPounds(metrics.acquisition_cost_pence)}
          tooltip={`§3.3: purchase price + ${regime} + legal fees + survey cost + broker fee + other acquisition costs.`}
        />
        <MetricCard
          label="Construction"
          value={penceToPounds(metrics.construction_cost_pence)}
          tooltip="§3.4: (construction cost per sqm × total construction sqm) + contingency + compliance (fire safety, sound insulation, Part L)."
        />
        <MetricCard
          label="Professional fees"
          value={penceToPounds(metrics.professional_fees_pence)}
          tooltip="§3.5: architect + structural engineer + M&E + planning consultant + other professional fees."
        />
        <MetricCard
          label="Statutory costs"
          value={penceToPounds(metrics.statutory_costs_pence)}
          tooltip="§3.6: prior-approval fee per dwelling × max(1, unit count) + CIL/S106 + building control."
        />
        <MetricCard
          label="Selling costs"
          value={penceToPounds(metrics.selling_costs_pence)}
          tooltip="§3.7: agent fee (% of gross receipt) + selling legal fee, allocated pro-rata across selling months."
        />
        <MetricCard
          label="Cost before finance"
          value={penceToPounds(metrics.cost_before_finance_pence)}
          tooltip="§3.8: acquisition + construction + professional + statutory + selling and exit costs."
        />
        <MetricCard
          label="Finance costs"
          value={penceToPounds(metrics.finance_costs_pence)}
          tooltip="§3.9: Σ interest accrued + arrangement fee + exit fee + other lender fees. Exactly zero under cash funding."
        />
        <MetricCard
          label="Total development cost"
          value={penceToPounds(metrics.total_development_cost_pence)}
          tooltip="§3.10: cost before finance + finance costs. Equals the sum of every 'uses' line in the monthly ledger."
          highlight
        />
      </Group>

      <Group title="Returns">
        <MetricCard
          label={metrics.profit_is_unrealised ? 'Profit (unrealised)' : 'Profit'}
          value={penceToPounds(metrics.profit_pence)}
          tooltip="§3.12: Σ gross receipts + retained-unit valuation (labelled unrealised) − TDC. Negative profit is reported as-is, never clamped."
          highlight
          negative={metrics.profit_pence < 0}
        />
        <MetricCard
          label="Profit on cost"
          value={pctOrNa(metrics.profit_on_cost_pct)}
          tooltip="§3.13: numerator = profit after finance. Denominator = TDC. Zero TDC → n/a."
        />
        <MetricCard
          label="Profit on GDV"
          value={pctOrNa(metrics.profit_on_gdv_pct)}
          tooltip="§3.14: numerator = profit after finance. Denominator = developer GDV. Zero GDV → n/a."
        />
        <MetricCard
          label="Equity multiple"
          value={metrics.equity_multiple == null ? 'n/a' : `${metrics.equity_multiple.toFixed(2)}x`}
          tooltip="§3.16: numerator = Σ distributions. Denominator = Σ contributions (absolute). Zero contributions → n/a."
        />
        <MetricCard
          label="IRR (annual)"
          value={metrics.irr_annual_pct == null ? 'n/a — no sign change in equity flows' : `${metrics.irr_annual_pct.toFixed(2)}%`}
          tooltip="§3.17: (1 + monthly IRR)^12 − 1, solved from the developer equity cash-flow vector (§3.15). Never a synthetic flow."
        />
        <MetricCard
          label="Return on equity"
          value={pctOrNa(metrics.return_on_equity_pct)}
          tooltip="Numerator = profit after finance (§3.12). Denominator = total equity contributed — committed equity + additional uncommitted equity (§3.15). Zero equity → n/a."
        />
        <MetricCard
          label="Residual land value"
          value={`${penceToPounds(metrics.rlv_pence)} (target ${target.toFixed(1)}% PoC)`}
          tooltip={`§3.18: RLV = GDV / (1 + target profit-on-cost / 100) − (TDC − purchase price − ${regime}). Target is the configurable deal-spider target (currently ${target.toFixed(1)}%), not a hard-coded 20%.`}
        />
      </Group>

      <Group title="Debt">
        <MetricCard
          label="Day-one advance & LTV"
          value={`${penceToPounds(metrics.day_one_advance_pence)} · ${pctOrNa(metrics.day_one_ltv_on_price_pct)}`}
          tooltip="§5.1: day-one advance = the actual month-0 senior draw (not the committed facility). LTV = day-one advance ÷ purchase price."
        />
        <MetricCard
          label="Net LTC"
          value={pctOrNa(metrics.net_ltc_pct)}
          tooltip="§5.4: numerator = cumulative net senior advances (principal draws + capitalised non-interest fees, excludes rolled-up interest). Denominator = development cost before disposal and finance."
        />
        <MetricCard
          label="Gross LTC"
          value={pctOrNa(metrics.gross_ltc_pct)}
          tooltip="§5.5: numerator = peak gross senior debt. Denominator = TDC (§3.10)."
        />
        <MetricCard
          label="LTGDV"
          value={`Developer: ${pctOrNa(metrics.ltgdv_developer_pct)} · Lender: ${pctOrNa(metrics.ltgdv_lender_pct)}`}
          tooltip="§5.6: numerator (both bases) = peak gross senior debt. Denominator = developer GDV [R1] or lender-underwritten GDV [R2, null until a lender valuation is recorded]."
        />
        <MetricCard
          label="Peak debt"
          value={`${penceToPounds(metrics.peak_debt_pence)}${metrics.peak_debt_month != null ? ` (${formatProgrammeMonth(programmeAnchor(inputs), metrics.peak_debt_month)})` : ''}`}
          tooltip="§5.7: max over months of the intra-month maximum balance before that month's repayment, with its month index."
        />
        <MetricCard
          label="Facility headroom"
          value={metrics.facility_headroom_pence == null ? 'n/a' : penceToPounds(metrics.facility_headroom_pence)}
          tooltip="§5.9: committed gross facility − peak gross debt. Negative headroom is flagged red; the model never silently expands the facility."
        />
        <MetricCard
          label="Interest reserve remaining"
          value={reserveRemaining == null ? 'n/a' : penceToPounds(Math.max(0, reserveRemaining))}
          tooltip="§5.8/§4: interest reserve − cumulative capitalised interest, floored at 0 for display. Exhaustion is never hidden — see the reconciliation panel and flags above for the exhaustion month."
        />
        <MetricCard
          label="Senior break-even (price)"
          value={metrics.senior_breakeven_pence == null ? 'n/a' : penceToPounds(metrics.senior_breakeven_pence)}
          tooltip="§5.11: minimum gross sale price that fully redeems the senior facility — covers the redemption balance, exit fee, disposal costs at that price, and the disclosed enforcement-cost assumption. Null for cash deals (no facility) or when unsolvable."
        />
        <MetricCard
          label="Senior break-even (% of lender GDV)"
          value={pctOrNa(metrics.senior_breakeven_pct_of_lender_gdv)}
          tooltip="§5.11: senior break-even price ÷ lender GDV. Null until both the break-even price and a lender valuation are available."
        />
        <MetricCard
          label="Senior break-even (fall from lender GDV)"
          value={pctOrNa(metrics.senior_breakeven_fall_from_lender_gdv_pct)}
          tooltip="§5.11: (lender GDV − senior break-even price) ÷ lender GDV — the headroom for values to fall before the senior facility is at risk. Null until both figures are available."
        />
        <MetricCard
          label="Developer break-even"
          value={metrics.developer_breakeven_pence == null ? 'n/a' : penceToPounds(metrics.developer_breakeven_pence)}
          tooltip="§5.12: minimum gross sale price covering total development cost (excluding selling costs, which are re-solved at that price) — lender- and debt-independent. Null when there is no disposal to solve for."
        />
        <CostToCompleteCard summary={metrics.cost_to_complete} />
      </Group>
    </div>
  );
}
