import type {
  CalculatorInputsV7, AppraisalRun, AreaBasis,
  CostPlanMode, CostPackage, CostPackageCode, ContingencyClassName, FeeBasis, FeeLine,
} from '../../lib/model';
import { COST_PACKAGE_CODES, CONTINGENCY_CLASS_NAMES } from '../../lib/model';
import { penceToPounds, penceToPoundsExact, humanise } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV7;
  onChange: (partial: Partial<CalculatorInputsV7>) => void;
  run: AppraisalRun;
}

const PACKAGE_CODE_LABEL: Record<CostPackageCode, string> = Object.fromEntries(
  COST_PACKAGE_CODES.map((code) => [code, humanise(code)]),
) as Record<CostPackageCode, string>;

const FEE_BASIS_LABEL: Record<FeeBasis, string> = {
  fixed: 'Fixed amount',
  pct_of_base_build: '% of base build',
  pct_of_construction_total: '% of construction total',
};

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

function newPackage(): CostPackage {
  return {
    id: crypto.randomUUID(),
    code: 'other',
    label: '',
    amount_pence: 0,
    contingency_class: 'general',
    lender_eligible: false,
    notes: '',
  };
}

export default function ConversionCostsPage({ inputs, onChange, run }: Props) {
  const costs = inputs.conversion_costs;
  const costPlan = inputs.cost_plan;
  const result = run.metrics.cost_plan;

  const updateCosts = (partial: Partial<typeof costs>) => {
    onChange({ conversion_costs: { ...costs, ...partial } });
  };

  // §3.2.1 / §6. Switching TO detailed mode on a document carrying compliance
  // allowances offers to move them into a single `fire_acoustic_thermal`
  // package rather than leaving them to trip the hard validation error
  // blind. This writes two ordinary fields (one new package, three zeroed
  // compliance fields) through the SAME onChange every other edit on this
  // page uses -- the engine sees nothing special, and the user may decline
  // and hit the validation error instead (§3.2.1's "one click, not silent").
  const handleModeChange = (mode: CostPlanMode) => {
    if (mode === 'detailed' && costPlan.mode !== 'detailed') {
      const complianceTotal =
        costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence;
      if (complianceTotal > 0) {
        const convert = window.confirm(
          `Switching to detailed mode. Convert the ${penceToPounds(complianceTotal)} of compliance ` +
          'allowances (fire safety, sound insulation, Part L) into a single "Fire, acoustic & thermal" ' +
          'package? Declining leaves the figures in place, which detailed mode cannot save.',
        );
        if (convert) {
          onChange({
            cost_plan: {
              ...costPlan,
              mode,
              packages: [
                ...costPlan.packages,
                {
                  ...newPackage(),
                  code: 'fire_acoustic_thermal',
                  label: 'Fire, acoustic & thermal (converted from compliance)',
                  amount_pence: complianceTotal,
                },
              ],
            },
            conversion_costs: {
              ...costs,
              fire_safety_pence: 0,
              sound_insulation_pence: 0,
              part_l_compliance_pence: 0,
            },
          });
          return;
        }
      }
    }
    onChange({ cost_plan: { ...costPlan, mode } });
  };

  const updatePackage = (id: string, partial: Partial<CostPackage>) => {
    onChange({
      cost_plan: {
        ...costPlan,
        packages: costPlan.packages.map((p) => (p.id === id ? { ...p, ...partial } : p)),
      },
    });
  };

  const removePackage = (id: string) => {
    onChange({ cost_plan: { ...costPlan, packages: costPlan.packages.filter((p) => p.id !== id) } });
  };

  const addPackage = () => {
    onChange({ cost_plan: { ...costPlan, packages: [...costPlan.packages, newPackage()] } });
  };

  const updateContingencyPct = (name: ContingencyClassName, pct: number) => {
    onChange({
      cost_plan: {
        ...costPlan,
        contingency: costPlan.contingency.map((c) => (c.name === name ? { ...c, pct } : c)),
      },
    });
  };

  const updateFeeLine = (id: string, partial: Partial<FeeLine>) => {
    onChange({
      cost_plan: {
        ...costPlan,
        fee_lines: costPlan.fee_lines.map((f) => (f.id === id ? { ...f, ...partial } : f)),
      },
    });
  };

  const changeFeeBasis = (id: string, basis: FeeBasis) => {
    // Hard-validated: amount_pence must be 0 on a pct_* basis, pct must be 0
    // on 'fixed' (cost-plan.ts's FeeLine doc comments). Zeroing the field the
    // new basis makes meaningless keeps the document valid across the switch
    // rather than leaving a stale figure the engine would then reject.
    updateFeeLine(id, basis === 'fixed' ? { basis, pct: 0 } : { basis, amount_pence: 0 });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>4. Conversion Costs</h3>

      {/* R10 §3.1/§6. Mode radio. Headline mode is visually unchanged from
          calc 2.8.0 below; detailed mode swaps the rate x area construction
          section for the package grid. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
        <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>Cost plan mode</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontSize: 14 }}>
          <input
            type="radio"
            name="cost_plan_mode"
            checked={costPlan.mode === 'headline'}
            onChange={() => handleModeChange('headline')}
          />
          Headline
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontSize: 14 }}>
          <input
            type="radio"
            name="cost_plan_mode"
            checked={costPlan.mode === 'detailed'}
            onChange={() => handleModeChange('detailed')}
          />
          Detailed
        </label>
      </div>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Fees</h4>
      {costPlan.fee_lines.map((fee) => {
        const feeResult = result.fees.find((f) => f.id === fee.id);
        return (
          <div key={fee.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>
              {fee.label} ({fee.category}{fee.per_dwelling ? ' / dwelling' : ''})
            </label>
            <select
              aria-label={`${fee.label} basis`}
              value={fee.basis}
              onChange={(e) => changeFeeBasis(fee.id, e.target.value as FeeBasis)}
              style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
            >
              {(['fixed', 'pct_of_base_build', 'pct_of_construction_total'] as FeeBasis[]).map((b) => (
                <option key={b} value={b}>{FEE_BASIS_LABEL[b]}</option>
              ))}
            </select>
            {fee.basis === 'fixed' ? (
              <div style={{ position: 'relative', width: 140 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                <input
                  type="number"
                  value={fee.amount_pence ? fee.amount_pence / 100 : ''}
                  onChange={(e) => updateFeeLine(fee.id, { amount_pence: Math.round(Number(e.target.value) * 100) })}
                  style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
              </div>
            ) : (
              <>
                <div style={{ position: 'relative', width: 90 }}>
                  <input
                    type="number"
                    value={fee.pct}
                    onChange={(e) => updateFeeLine(fee.id, { pct: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>%</span>
                </div>
                {feeResult && (
                  <span style={{ color: '#64748b', fontSize: 12 }}>
                    of {penceToPounds(feeResult.base_pence)} = {penceToPoundsExact(feeResult.amount_pence)}
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}

      {costPlan.mode === 'headline' ? (
        <>
          <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Construction</h4>
          <PenceCostRow label="Cost per m² (£)" penceValue={costs.construction_cost_per_sqm_pence} onChangePence={(v) => updateCosts({ construction_cost_per_sqm_pence: v })} />

          {/* R9 Task 10 (spec §15.3/§15.4). The construction cost area used to be
              this one bare, user-typed field. It is now basis-aware: under the
              bridge-derived basis the figure comes from `run.metrics.developed_area_sqm`
              (the single accessor `areas.ts` exposes, enforced by the eslint guard
              below) and this field becomes read-only; under the manual basis this
              component stays the legitimate editor of `total_construction_sqm`,
              exempted at the read below (R10 Task 9 took this file OFF the
              guard's file-wide allowlist, so the exemption is now line-scoped). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>Construction area basis</label>
            <select
              aria-label="Construction area basis"
              value={inputs.areas.basis}
              onChange={(e) => onChange({ areas: { ...inputs.areas, basis: e.target.value as AreaBasis } })}
              style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
            >
              <option value="bridge_derived">Derived from the area bridge</option>
              <option value="manual">Entered manually</option>
            </select>
          </div>
          {inputs.areas.basis === 'bridge_derived' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>Total construction m²</label>
              <span style={{ color: '#e2e8f0', fontSize: 14 }}>
                {run.metrics.developed_area_sqm.toLocaleString()} m²
              </span>
              <span style={{ color: '#64748b', fontSize: 12 }}>
                derived: proposed GIA {run.metrics.area_bridge.proposed_gia_sqm.toLocaleString()} m²
                less retained and untouched area
              </span>
            </div>
          ) : (
            <CostRow
              label="Total construction m²"
              // eslint-disable-next-line no-restricted-syntax -- legitimate manual-basis area editor (spec §15.3); see the comment above
              value={costs.total_construction_sqm}
              onChangeValue={(v) => updateCosts({ total_construction_sqm: v })}
            />
          )}

          <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Building Regs Compliance</h4>
          <PenceCostRow label="Fire safety (£)" penceValue={costs.fire_safety_pence} onChangePence={(v) => updateCosts({ fire_safety_pence: v })} />
          <PenceCostRow label="Sound insulation (£)" penceValue={costs.sound_insulation_pence} onChangePence={(v) => updateCosts({ sound_insulation_pence: v })} />
          <PenceCostRow label="Part L compliance (£)" penceValue={costs.part_l_compliance_pence} onChangePence={(v) => updateCosts({ part_l_compliance_pence: v })} />
        </>
      ) : (
        <>
          {/* R10 §3.2/§6. The compact package grid: code, label, amount,
              contingency class, lender-eligible, remove; plus add-row. */}
          <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Packages</h4>
          {/* §3.2.1: compliance is priced inside the packages in detailed mode
              (e.g. `fire_acoustic_thermal`) -- the three flat fields are not
              shown here, and must be zero (hard validation error otherwise). */}
          <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
            Compliance allowances (fire safety, sound insulation, Part L) are priced within a
            package here — typically &quot;Fire, acoustic &amp; thermal&quot; — not as separate figures.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {costPlan.packages.map((pkg) => (
              <div key={pkg.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* The audit's own package label, shown as text (not just an
                    input's value, which no report or screen reader treats as
                    content) -- this is the row's readable identity, and what
                    the memo's package schedule prints. Falls back to the
                    code's name only for a freshly added, still-unlabelled row. */}
                <span style={{ color: '#e2e8f0', fontSize: 14, minWidth: 140 }}>
                  {pkg.label || PACKAGE_CODE_LABEL[pkg.code]}
                </span>
                <select
                  aria-label="Package code"
                  value={pkg.code}
                  onChange={(e) => updatePackage(pkg.id, { code: e.target.value as CostPackageCode })}
                  style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                >
                  {COST_PACKAGE_CODES.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label="Package label"
                  placeholder="Label"
                  value={pkg.label}
                  onChange={(e) => updatePackage(pkg.id, { label: e.target.value })}
                  style={{ width: 200, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
                <div style={{ position: 'relative', width: 130 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                  <input
                    type="number"
                    value={pkg.amount_pence ? pkg.amount_pence / 100 : ''}
                    onChange={(e) => updatePackage(pkg.id, { amount_pence: Math.round(Number(e.target.value) * 100) })}
                    style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
                <select
                  aria-label="Package contingency class"
                  value={pkg.contingency_class}
                  onChange={(e) => updatePackage(pkg.id, { contingency_class: e.target.value as ContingencyClassName })}
                  style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                >
                  {CONTINGENCY_CLASS_NAMES.map((name) => (
                    <option key={name} value={name}>{humanise(name)}</option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={pkg.lender_eligible}
                    onChange={(e) => updatePackage(pkg.id, { lender_eligible: e.target.checked })}
                  />
                  Lender-eligible
                </label>
                <button
                  onClick={() => removePackage(pkg.id)}
                  style={{ padding: '4px 10px', background: '#1e293b', border: '1px solid #7f1d1d', borderRadius: 4, color: '#f87171', fontSize: 13, cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addPackage}
            style={{ padding: '6px 14px', background: '#1e3a5f', border: 'none', borderRadius: 4, color: '#e2e8f0', fontSize: 13, cursor: 'pointer', marginBottom: 12 }}
          >
            + Add package
          </button>
        </>
      )}

      {/* R10 §3.3/§6. Both modes show the same three contingency rows: pct
          (editable), and the RESOLVED base and computed amount, read from
          run.metrics.cost_plan.contingency -- never recomputed here. */}
      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Contingency</h4>
      {CONTINGENCY_CLASS_NAMES.map((name) => {
        const line = result.contingency.find((c) => c.name === name);
        const cls = costPlan.contingency.find((c) => c.name === name);
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>{humanise(name)}</label>
            <div style={{ position: 'relative', width: 90 }}>
              <input
                type="number"
                value={cls?.pct ?? 0}
                onChange={(e) => updateContingencyPct(name, Number(e.target.value))}
                style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>%</span>
            </div>
            {line && (
              <span style={{ color: '#64748b', fontSize: 12 }}>
                of {penceToPounds(line.base_pence)} = {penceToPoundsExact(line.amount_pence)}
              </span>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Construction cost (base build + contingency{costPlan.mode === 'headline' ? ' + compliance' : ''})</span>
          <span>{penceToPounds(result.construction_total_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Professional fees</span>
          <span>{penceToPounds(result.professional_total_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
          <span>Statutory costs</span>
          <span>{penceToPounds(result.statutory_total_pence)}</span>
        </div>
      </div>
    </div>
  );
}
