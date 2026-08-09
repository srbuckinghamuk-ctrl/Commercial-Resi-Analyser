import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

function CostRow({ label, value, onChangeValue, suffix }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
      />
      {suffix && <span style={{ color: '#64748b', fontSize: 13 }}>{suffix}</span>}
    </div>
  );
}

export default function ConversionCostsPage({ inputs, onChange, metrics }: Props) {
  const costs = inputs.conversion_costs;

  const updateCosts = (partial: Partial<typeof costs>) => {
    onChange({ conversion_costs: { ...costs, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>3. Conversion Costs</h3>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Statutory Fees</h4>
      <CostRow label="Prior approval fee / dwelling (p)" value={costs.prior_approval_fee_per_dwelling_pence} onChangeValue={(v) => updateCosts({ prior_approval_fee_per_dwelling_pence: v })} suffix={penceToPounds(costs.prior_approval_fee_per_dwelling_pence)} />
      <CostRow label="CIL / S106 (pence)" value={costs.cil_s106_pence} onChangeValue={(v) => updateCosts({ cil_s106_pence: v })} suffix={penceToPounds(costs.cil_s106_pence)} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Professional Fees</h4>
      <CostRow label="Architect (pence)" value={costs.architect_pence} onChangeValue={(v) => updateCosts({ architect_pence: v })} suffix={penceToPounds(costs.architect_pence)} />
      <CostRow label="Structural engineer (pence)" value={costs.structural_engineer_pence} onChangeValue={(v) => updateCosts({ structural_engineer_pence: v })} suffix={penceToPounds(costs.structural_engineer_pence)} />
      <CostRow label="M&E (pence)" value={costs.mande_pence} onChangeValue={(v) => updateCosts({ mande_pence: v })} suffix={penceToPounds(costs.mande_pence)} />
      <CostRow label="Planning consultant (pence)" value={costs.planning_consultant_pence} onChangeValue={(v) => updateCosts({ planning_consultant_pence: v })} suffix={penceToPounds(costs.planning_consultant_pence)} />
      <CostRow label="Building control (pence)" value={costs.building_control_pence} onChangeValue={(v) => updateCosts({ building_control_pence: v })} suffix={penceToPounds(costs.building_control_pence)} />
      <CostRow label="Other professional fees (pence)" value={costs.other_professional_fees_pence} onChangeValue={(v) => updateCosts({ other_professional_fees_pence: v })} suffix={penceToPounds(costs.other_professional_fees_pence)} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Construction</h4>
      <CostRow label="Cost per sq ft (pence)" value={costs.construction_cost_per_sqft_pence} onChangeValue={(v) => updateCosts({ construction_cost_per_sqft_pence: v })} suffix={penceToPounds(costs.construction_cost_per_sqft_pence) + '/sqft'} />
      <CostRow label="Total construction sq ft" value={costs.total_construction_sqft} onChangeValue={(v) => updateCosts({ total_construction_sqft: v })} />
      <CostRow label="Contingency (%)" value={costs.contingency_pct} onChangeValue={(v) => updateCosts({ contingency_pct: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Building Regs Compliance</h4>
      <CostRow label="Fire safety (pence)" value={costs.fire_safety_pence} onChangeValue={(v) => updateCosts({ fire_safety_pence: v })} suffix={penceToPounds(costs.fire_safety_pence)} />
      <CostRow label="Sound insulation (pence)" value={costs.sound_insulation_pence} onChangeValue={(v) => updateCosts({ sound_insulation_pence: v })} suffix={penceToPounds(costs.sound_insulation_pence)} />
      <CostRow label="Part L compliance (pence)" value={costs.part_l_compliance_pence} onChangeValue={(v) => updateCosts({ part_l_compliance_pence: v })} suffix={penceToPounds(costs.part_l_compliance_pence)} />

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Construction cost</span>
          <span>{penceToPounds(metrics.total_construction_cost_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Professional fees</span>
          <span>{penceToPounds(metrics.total_professional_fees_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16, paddingTop: 8, borderTop: '1px solid #1e3a5f' }}>
          <span>Total Conversion Costs</span>
          <span>{penceToPounds(metrics.total_construction_cost_pence + metrics.total_professional_fees_pence)}</span>
        </div>
      </div>
    </div>
  );
}
