import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function PenceCostRow({ label, penceValue, onChangePence }: {
  label: string;
  penceValue: number;
  onChangePence: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>{label}</label>
      <div style={{ position: 'relative', width: 140 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
        <input
          type="number"
          value={penceValue ? penceValue / 100 : ''}
          onChange={(e) => onChangePence(Math.round(Number(e.target.value) * 100))}
          style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
        />
      </div>
    </div>
  );
}

function CostRow({ label, value, onChangeValue }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
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
      <PenceCostRow label="Prior approval fee / dwelling (£)" penceValue={costs.prior_approval_fee_per_dwelling_pence} onChangePence={(v) => updateCosts({ prior_approval_fee_per_dwelling_pence: v })} />
      <PenceCostRow label="CIL / S106 (£)" penceValue={costs.cil_s106_pence} onChangePence={(v) => updateCosts({ cil_s106_pence: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Professional Fees</h4>
      <PenceCostRow label="Architect (£)" penceValue={costs.architect_pence} onChangePence={(v) => updateCosts({ architect_pence: v })} />
      <PenceCostRow label="Structural engineer (£)" penceValue={costs.structural_engineer_pence} onChangePence={(v) => updateCosts({ structural_engineer_pence: v })} />
      <PenceCostRow label="M&E (£)" penceValue={costs.mande_pence} onChangePence={(v) => updateCosts({ mande_pence: v })} />
      <PenceCostRow label="Planning consultant (£)" penceValue={costs.planning_consultant_pence} onChangePence={(v) => updateCosts({ planning_consultant_pence: v })} />
      <PenceCostRow label="Building control (£)" penceValue={costs.building_control_pence} onChangePence={(v) => updateCosts({ building_control_pence: v })} />
      <PenceCostRow label="Other professional fees (£)" penceValue={costs.other_professional_fees_pence} onChangePence={(v) => updateCosts({ other_professional_fees_pence: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Construction</h4>
      <PenceCostRow label="Cost per m² (£)" penceValue={costs.construction_cost_per_sqm_pence} onChangePence={(v) => updateCosts({ construction_cost_per_sqm_pence: v })} />
      <CostRow label="Total construction m²" value={costs.total_construction_sqm} onChangeValue={(v) => updateCosts({ total_construction_sqm: v })} />
      <CostRow label="Contingency (%)" value={costs.contingency_pct} onChangeValue={(v) => updateCosts({ contingency_pct: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Building Regs Compliance</h4>
      <PenceCostRow label="Fire safety (£)" penceValue={costs.fire_safety_pence} onChangePence={(v) => updateCosts({ fire_safety_pence: v })} />
      <PenceCostRow label="Sound insulation (£)" penceValue={costs.sound_insulation_pence} onChangePence={(v) => updateCosts({ sound_insulation_pence: v })} />
      <PenceCostRow label="Part L compliance (£)" penceValue={costs.part_l_compliance_pence} onChangePence={(v) => updateCosts({ part_l_compliance_pence: v })} />

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
