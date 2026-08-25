import { useMemo, useCallback } from 'react';
import type { ExitRoute } from '../../lib/conversion-types';
import type {
  CalculatorInputsV9, CalculatorInputsV10, CalculatorInputsV11, CalculatorInputsV12,
  CalculatorInputsV13, CalculatorInputsV14, AppraisalRun, SalesPhasingInputsV9, InvestmentCaseInputs,
} from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import ExitAnchorControl from './ExitAnchorControl';
import OperatingScheduleEditor from './OperatingScheduleEditor';
import InvestmentCaseCard from './InvestmentCaseCard';
import UnitSalesEditor, { seedUnitSales, reconcileUnitSalesRows } from './UnitSalesEditor';

/**
 * R13 Task 15 (spec §19.1/§19.6), widened by R14 Task 14, R13b Task 15, R15
 * Task 13 and now R15b Task 6 to admit v14. `investment_case` exists on v10
 * through v14 alike (v11 only adds `monitoring` beside it, v12 adds
 * `unit_sales`, v13 adds `due_diligence` and two inert cost_plan additions,
 * v14 adds `cost_plan.qs.inflation` -- none of which this page touches) --
 * `ExitStrategyPage` is generic over the version carrier exactly as
 * `ProgrammePage` is over `CalculatorInputsV8 | CalculatorInputsV9 |
 * CalculatorInputsV10` for the same reason: the real call site
 * (`ConversionCalculator.tsx`) is now on v14, but this page must keep
 * compiling against a v9 document that has no `investment_case` key at all
 * (ExitStrategyPage.test.tsx's own regression coverage), while also
 * accepting v10 through v14 documents that do. `hasInvestmentCase` is the
 * sole discriminator; the investment-case section below simply does not
 * render for a v9 caller -- there is nothing to author yet, exactly as the
 * release note says.
 */
export type ExitCarrier =
  CalculatorInputsV9 | CalculatorInputsV10 | CalculatorInputsV11 | CalculatorInputsV12
  | CalculatorInputsV13 | CalculatorInputsV14;

function hasInvestmentCase<T extends ExitCarrier>(
  x: T,
): x is T & (CalculatorInputsV10 | CalculatorInputsV11) {
  return 'investment_case' in x;
}

/**
 * R13b Task 11 (spec §22.6). `unit_sales` exists on v12 only -- the same
 * discriminator pattern `hasInvestmentCase` already uses for v10/v11's
 * `investment_case`. A v9/v10/v11 caller simply never renders the ledger.
 */
function hasUnitSales<T extends ExitCarrier>(x: T): x is T & CalculatorInputsV12 {
  return 'unit_sales' in x;
}

/** A blank starting policy for a case that has never been authored. Every
 *  figure here is a placeholder the user is expected to review -- none of
 *  it is derived from the scheme. */
const DEFAULT_INVESTMENT_CASE: InvestmentCaseInputs = {
  stabilisation: { anchor: null, month_offset: 0, ramp_months: 0, stabilised_occupancy_pct: 95 },
  operating_lines: [],
  valuation: { cap_yield_pct: 6, purchasers_costs_pct: 5.8 },
  takeout: {
    ltv_cap_pct: 65, dscr_floor: 1.25, icr_floor: 1.25, annual_rate_pct: 6,
    amortisation_years: 25, term_years: 5,
  },
};

/** A non-zero placeholder rent for a unit §19.7 rule 2 requires a row for but
 *  that has never had one -- a real figure the user must review, not a
 *  silent zero that would fail rule 4's rent-roll-greater-than-zero check on
 *  a document with only ever-zero rows. */
const DEFAULT_RETAINED_RENT_PENCE = 100_000;

interface Props<T extends ExitCarrier> {
  inputs: T;
  onChange: (partial: Partial<T>) => void;
  run: AppraisalRun;
}

export default function ExitStrategyPage<T extends ExitCarrier>({ inputs, onChange, run }: Props<T>) {
  const exit = inputs.exit_strategy;
  const units = inputs.unit_mix.units;
  const term = Math.max(1, Math.floor(inputs.finance.term_months));

  const updateExit = useCallback(
    (partial: Partial<typeof exit>) => {
      onChange({ exit_strategy: { ...exit, ...partial } } as Partial<T>);
    },
    [exit, onChange],
  );

  // R13b Task 11 (spec §22.6). `usCarrier`/`unitSales` mirror `icCarrier`/`ic`
  // below -- the sole v12 discriminator. `soldIds` is the set of units the
  // ledger must carry exactly one row for: none under retain_all, every unit
  // under sell_all, and every unit NOT in `retained_units` under blended.
  const usCarrier = hasUnitSales(inputs);
  const unitSales = usCarrier ? inputs.unit_sales : null;
  const soldIds = exit.route === 'retain_all'
    ? []
    : units.filter((u) => exit.route === 'sell_all' || !exit.retained_units.some((r) => r.unit_id === u.id))
      .map((u) => u.id);

  const updateRetained = useCallback(
    (unitId: string, rent: number) => {
      const existing = exit.retained_units.filter((r) => r.unit_id !== unitId);
      if (rent > 0) {
        existing.push({ unit_id: unitId, monthly_rent_pence: rent });
      }
      const partial: Record<string, unknown> = { exit_strategy: { ...exit, retained_units: existing } };
      // R13b Task 11: a retained/un-retained unit changes the sold set, so a
      // ledger already in play must be reconciled to it in the SAME payload
      // -- never left carrying a row for a unit no longer sold.
      if (usCarrier && unitSales != null) {
        const newRetainedIds = new Set(existing.map((r) => r.unit_id));
        const newSoldIds = exit.route === 'retain_all'
          ? []
          : units.filter((u) => exit.route === 'sell_all' || !newRetainedIds.has(u.id)).map((u) => u.id);
        partial.unit_sales = reconcileUnitSalesRows(unitSales, newSoldIds, term);
      }
      onChange(partial as Partial<T>);
    },
    [exit, onChange, usCarrier, unitSales, units, term],
  );

  const totalAnnualRent = useMemo(
    () => exit.retained_units.reduce((s, r) => s + r.monthly_rent_pence * 12, 0),
    [exit.retained_units],
  );

  // R9 fix wave: read, never recompute. This figure seeds
  // `refinance.investment_value_pence`, so it is not display-only — a scheme
  // with retained parking or balconies refinanced against an understated
  // investment value.
  //
  // The component used to sum bare `estimated_value_pence` over
  // `exit.retained_units`, which excluded the ancillary value that spec §15.5
  // makes part of a unit's worth and that the engine's
  // `schedule.totals.retained_value_pence` (surfaced as
  // `metrics.unrealised_value_pence`) has always included. Rather than adding
  // ancillary to a second, component-local derivation, the whole figure now
  // comes off the run.
  //
  // Note the scope this deliberately adopts: `unrealised_value_pence` is
  // GDV minus the units the engine actually sells, so under `retain_all` it
  // covers EVERY unit, not merely the ones the user has typed a rent against.
  // That is the right basis for both consumers here — the refinance is secured
  // on the whole retained portfolio, and a portfolio gross yield is measured
  // against the whole portfolio's value. Under `blended` the engine's retained
  // set is exactly `exit.retained_units`, so the two definitions coincide.
  const retainedCapitalValue = run.metrics.unrealised_value_pence;

  const grossYield = retainedCapitalValue > 0 ? (totalAnnualRent / retainedCapitalValue) * 100 : 0;

  // Selling costs come from the shared engine (run.schedule / run.metrics) —
  // component-local disposal formulas are prohibited.
  const sellingCosts = run.metrics.selling_costs_pence;

  const phasing = inputs.sales_phasing;
  const refinance = inputs.refinance;
  const pctSum = phasing?.tranches.reduce((a, b) => a + b.pct_of_gross_receipts, 0) ?? 0;

  // R12 Task 18b / R13 Task 14. A tranche this page creates is SEEDED
  // `anchor: null` -- BIT-IDENTICAL to what `migrateV8toV9` writes on every
  // stored tranche (spec §18.6: null means "use `month_offset`"). A tranche
  // born here and a tranche migrated here therefore behave the same, which
  // is the same discipline `defaultCalculatorInputsV9` keeps against the
  // migration. `ExitAnchorControl` below is what lets the user move a
  // tranche or the refinance OFF that default onto a phase anchor -- it
  // reads the programme's phases and emits `PhaseAnchor | null`; it performs
  // no month arithmetic itself.
  const phasesForAnchor = inputs.programme?.phases ?? [];
  // R13b Task 11 (spec §22.1 rule -- mutual exclusion with unit_sales).
  // Enabling phasing on a v12 carrier must null `unit_sales` in the SAME
  // payload, or the editor would briefly hold an invalid document (both
  // blocks non-null). Disabling phasing does not touch unit_sales: by the
  // same invariant it is already null whenever phasing is non-null, so there
  // is nothing to clear.
  const togglePhasing = () => onChange({
    sales_phasing: phasing ? null
      : { tranches: [{ month_offset: term - 1, pct_of_gross_receipts: 100, anchor: null }] },
    ...(usCarrier && !phasing ? { unit_sales: null } : {}),
  } as Partial<T>);
  // R13b Task 11. The ledger's own toggle -- exact mirror of `togglePhasing`
  // for the other side of the exclusive pair. Enabling seeds one row per
  // currently-sold unit and nulls `sales_phasing` in the same payload;
  // disabling just nulls the block (phasing, if the user wants it, is a
  // separate click on its own toggle).
  const toggleUnitSales = () => onChange((unitSales
    ? { unit_sales: null }
    : { unit_sales: seedUnitSales(soldIds, term), sales_phasing: null }) as unknown as Partial<T>);
  const updateTranche = (i: number, partial: Partial<SalesPhasingInputsV9['tranches'][number]>) => {
    if (!phasing) return;
    const tranches = phasing.tranches.map((t, j) => (j === i ? { ...t, ...partial } : t));
    onChange({ sales_phasing: { tranches } } as Partial<T>);
  };
  const addTranche = () => phasing && onChange({ sales_phasing: {
    tranches: [...phasing.tranches, { month_offset: term - 1, pct_of_gross_receipts: 0, anchor: null }],
  } } as Partial<T>);
  const removeTranche = (i: number) => phasing && onChange({ sales_phasing: {
    tranches: phasing.tranches.filter((_, j) => j !== i),
  } } as Partial<T>);

  // R13 Task 15 (spec §19.7). Present only on a v10 document -- see
  // `hasInvestmentCase`'s own note. `ic` is `null` both when the document
  // cannot carry one (v9) and when it can but does not yet have one.
  const icCarrier = hasInvestmentCase(inputs);
  const ic: InvestmentCaseInputs | null = icCarrier ? inputs.investment_case : null;
  const icResult = run.metrics.investment_case;

  // IMPORTANT 3: switching route must clear whichever block the new route makes
  // invalid, in the SAME payload — otherwise the editor hides an orphaned
  // sales_phasing/refinance block (its own validation rule rejects it) while it
  // still moves money on screen via schedule/monthly-engine. A route that keeps
  // a block valid (e.g. blended for both, or retain_all for refinance) leaves
  // it untouched. R13 Task 15 extends the same rule to `investment_case`
  // (spec §19.7 rule 1): a sell-all exit retains nothing, so a non-null case
  // is invalid the moment the route changes, not merely unreachable in the UI.
  const selectRoute = (route: ExitRoute) => {
    const partial: Record<string, unknown> = { exit_strategy: { ...exit, route } };
    if (route === 'retain_all') {
      partial.sales_phasing = null;
      // R13b Task 11 (spec §22.7 rule 2, mirroring rule 1's sales_phasing
      // clear above): retain_all sells nothing, so a non-null ledger is
      // invalid the moment the route changes.
      if (usCarrier) partial.unit_sales = null;
    }
    if (route === 'sell_all') {
      partial.refinance = null;
      if (icCarrier) partial.investment_case = null;
    }
    onChange(partial as Partial<T>);
  };

  const toggleRefinance = () => {
    if (refinance) {
      onChange({ refinance: null } as Partial<T>);
      return;
    }
    const base = {
      month_offset: term - 1, investment_value_pence: retainedCapitalValue,
      ltv_pct: 65, arrangement_fee_pence: 0, legal_costs_pence: 0, anchor: null,
    };
    // R13 spec §19.1 gives a v10 refinance block an explicit arrangement-fee
    // basis; spec §19.7 rule 5 then forbids setting investment_value_pence/
    // ltv_pct at all once an investment case exists (they are DERIVED) --
    // setting them here would be the exact silent override §2 forbids.
    const seeded: Record<string, unknown> = icCarrier
      ? {
        ...base,
        investment_value_pence: ic != null ? null : base.investment_value_pence,
        ltv_pct: ic != null ? null : base.ltv_pct,
        arrangement_fee_basis: 'pct_of_quantum',
        arrangement_fee_pct: 0,
      }
      : base;
    onChange({ refinance: seeded } as unknown as Partial<T>);
  };
  const updateRefinance = (partial: Record<string, unknown>) => {
    if (!refinance) return;
    onChange({ refinance: { ...refinance, ...partial } } as Partial<T>);
  };

  // Display-only mirror of spec §4.5's net-proceeds formula
  // (investment_value_pence * ltv_pct / 100, rounded, minus fees). The engine's
  // Schedule.refinance.net_proceeds_pence is not reachable from a prop-driven
  // preview before the block is saved and re-run, so this recomputes the same
  // arithmetic locally for preview purposes only. `null` (not 0) once an
  // investment case supplies the pair instead of an explicit value -- there is
  // no preview arithmetic to show until the case is booked and the engine
  // sizes the take-out.
  const refinanceNetProceeds = refinance && refinance.investment_value_pence != null
    && refinance.ltv_pct != null
    ? Math.round(refinance.investment_value_pence * (refinance.ltv_pct / 100))
      - refinance.arrangement_fee_pence - refinance.legal_costs_pence
    : null;

  // R13 Task 15 fix round 1 (spec §19.7 rule 2). Which units, under
  // `retain_all`, lack a `retained_units` row -- the set the completeness
  // rule requires be empty. `[]` under `blended` (rule 2 does not apply
  // there: the retained set IS whichever units the user picked) and `[]`
  // when there is no case to be complete about.
  const missingRentUnitIds = exit.route === 'retain_all'
    ? units.filter((u) => !exit.retained_units.some((r) => r.unit_id === u.id)).map((u) => u.id)
    : [];

  // R13 Task 15 fix round 1 (spec §19.7 rule 2). Two genuinely different
  // actions share this handler -- CREATE a case from the default (only when
  // `ic` is null) and REPAIR a rent roll that has fallen behind the unit mix
  // (only when a row is actually missing) -- but each is wired to its own,
  // honestly-labelled button below (`ic == null` shows "Add an investment
  // case"; `missingRentUnitIds.length > 0` shows "Complete rent roll").
  // Fix round 1 finding: the two used to be one always-visible "Add" button
  // that stayed present even once a case existed and every row was already
  // complete -- true of nothing in that state, read by a user as "nothing
  // has been added yet". The short-circuit below means this handler is now
  // a genuine no-op exactly when neither button would be showing, not only
  // when the user cannot reach it: only the fields that actually change are
  // in the emitted partial, so a repair on an already-complete document
  // (unreachable via the UI, but a defensive guard against a future caller)
  // emits nothing rather than an unchanged `retained_units` array. "Remove
  // investment case", below, is the only control that nulls it back out.
  const addInvestmentCase = () => {
    if (!icCarrier) return;
    const creating = ic == null;
    const repairing = missingRentUnitIds.length > 0;
    if (!creating && !repairing) return;
    const partial: Record<string, unknown> = {};
    if (creating) partial.investment_case = DEFAULT_INVESTMENT_CASE;
    if (repairing) {
      const existingRents = new Map(exit.retained_units.map((r) => [r.unit_id, r]));
      partial.exit_strategy = {
        ...exit,
        retained_units: units.map((u) => existingRents.get(u.id)
          ?? { unit_id: u.id, monthly_rent_pence: DEFAULT_RETAINED_RENT_PENCE }),
      };
    }
    onChange(partial as Partial<T>);
  };
  const removeInvestmentCase = () => icCarrier
    && onChange({ investment_case: null } as unknown as Partial<T>);
  const updateInvestmentCase = (next: InvestmentCaseInputs) => {
    if (!icCarrier) return;
    onChange({ investment_case: next } as unknown as Partial<T>);
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>12. Exit Strategy</h3>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {(['sell_all', 'retain_all', 'blended'] as ExitRoute[]).map((route) => (
          <button
            key={route}
            onClick={() => selectRoute(route)}
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
                {/* R13b Task 11: the ledger's reconciliation needs an explicit
                    retain/sell toggle, not merely "rent > 0" -- a unit can be
                    retained at a genuinely-zero rent. Checking it retains at
                    the existing rent (or a placeholder default if none was
                    ever entered); unchecking removes the retained_units row,
                    exactly as entering 0 already did. */}
                <input
                  type="checkbox"
                  aria-label={`Retain ${unit.id}`}
                  checked={retained != null}
                  onChange={(e) => updateRetained(
                    unit.id,
                    e.target.checked ? (retained?.monthly_rent_pence || DEFAULT_RETAINED_RENT_PENCE) : 0,
                  )}
                />
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
            {/* R13b Task 11 (spec §22.6): the per-unit ledger, mutually
                exclusive with phasing above -- both toggles' click handlers
                write the exclusive null in the same payload (togglePhasing/
                toggleUnitSales above), belt and braces against the two ever
                being non-null together. */}
            {usCarrier && (
              <button
                onClick={toggleUnitSales}
                style={{
                  padding: '6px 16px', background: unitSales ? '#1e3a5f' : '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}
              >
                {unitSales ? 'Disable per-unit ledger' : 'Use per-unit ledger'}
              </button>
            )}
          </div>

          {usCarrier && unitSales != null && (
            <UnitSalesEditor
              unitSales={unitSales}
              result={run.schedule.unit_sales}
              phases={phasesForAnchor}
              term={term}
              units={units.map((u) => ({ id: u.id, type: u.type }))}
              schemeAgentPct={exit.selling_agent_fee_pct}
              schemeLegalPence={exit.selling_legal_fee_pence}
              onChange={(next) => onChange({ unit_sales: next } as unknown as Partial<T>)}
            />
          )}

          {phasing && (
            <div>
              {phasing.tranches.map((t, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 62 }}>
                    <ExitAnchorControl
                      value={t.anchor}
                      phases={phasesForAnchor}
                      monthOffset={t.month_offset}
                      onChange={(anchor) => updateTranche(i, { anchor })}
                    />
                    {/* R13 Task 14: the resolved month the ledger will actually use --
                        read from schedule.resolved_exit_months (Task 8), never
                        recomputed here. Same index as sales_phasing.tranches. */}
                    <span style={{ color: '#64748b', fontSize: 12 }}>
                      resolves to month {run.schedule.resolved_exit_months.tranches[i]}
                    </span>
                  </div>
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
                      disabled={ic != null}
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
                    disabled={ic != null}
                    value={refinance.ltv_pct ?? ''}
                    onChange={(e) => updateRefinance({ ltv_pct: Number(e.target.value) })}
                    style={{ width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
                {ic != null && (
                  <span style={{ color: '#64748b', fontSize: 12, alignSelf: 'center' }}>
                    derived from the investment case
                  </span>
                )}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <ExitAnchorControl
                  value={refinance.anchor}
                  phases={phasesForAnchor}
                  monthOffset={refinance.month_offset}
                  onChange={(anchor) => updateRefinance({ anchor })}
                />
                {/* R13 Task 14: resolved month the ledger uses, read from
                    schedule.resolved_exit_months (Task 8), never recomputed here. */}
                <span style={{ color: '#64748b', fontSize: 12 }}>
                  resolves to month {run.schedule.resolved_exit_months.refinance}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 14 }}>
                <span>Net refinance proceeds (preview)</span>
                <span>{refinanceNetProceeds == null ? 'derived once the investment case is booked' : penceToPounds(refinanceNetProceeds)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {icCarrier && exit.route !== 'sell_all' && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h4 style={{ color: '#94a3b8', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>Investment Case</h4>
            {/* R13 Task 15 fix rounds 1-2. Each affordance below is shown
                exactly when what it SAYS is true of the current state --
                that is the invariant, not a count of how many render
                together. "Add" only when there is no case yet. "Complete
                rent roll (N missing)" only when a case exists AND a
                retain_all row is genuinely missing. "Remove" whenever a
                case exists, REGARDLESS of whether rows are missing --
                repair and Remove can and do render side by side, because
                both are true then, and Remove must stay reachable so a
                user is never trapped with an incomplete case they cannot
                delete. The original defect this fixed was a button whose
                label was false of the state it was shown in ("Add" on a
                document that already had a case), not the number of
                buttons on screen at once. */}
            {ic == null && (
              <button
                onClick={addInvestmentCase}
                style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Add an investment case
              </button>
            )}
            {ic != null && missingRentUnitIds.length > 0 && (
              <button
                onClick={addInvestmentCase}
                style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                {`Complete rent roll (${missingRentUnitIds.length} unit${missingRentUnitIds.length === 1 ? '' : 's'} missing)`}
              </button>
            )}
            {ic != null && (
              <button
                onClick={removeInvestmentCase}
                style={{ padding: '6px 16px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Remove investment case
              </button>
            )}
          </div>

          {ic != null && icResult != null && (
            <>
              <OperatingScheduleEditor
                lines={ic.operating_lines}
                result={icResult}
                onChange={(lines) => updateInvestmentCase({ ...ic, operating_lines: lines })}
              />
              <InvestmentCaseCard
                inputs={ic}
                result={icResult}
                phases={phasesForAnchor}
                onChange={updateInvestmentCase}
              />
            </>
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
