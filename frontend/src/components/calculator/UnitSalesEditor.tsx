import type {
  UnitSalesInputs, UnitSalesResult, UnitSale, DepositRelease, Phase,
} from '../../lib/model';
import { DEPOSIT_RELEASE_VALUES } from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import ExitAnchorControl from './ExitAnchorControl';
import { PenceInput } from './form-rows';

/**
 * R13b Task 11 (spec §22.6). The per-unit sales ledger editor. NO calculation
 * here -- every figure (gross, net, resolved months, totals, pre-sold %) is
 * read off `result` (the engine's own `Schedule.unit_sales`/
 * `AppraisalResultV2.unit_sales`, republished), never recomputed from the
 * inputs. Every `onChange` call emits the WHOLE `UnitSalesInputs` block --
 * this component has no partial-update contract, exactly as
 * `OperatingScheduleEditor` (the pattern this file follows) has none either.
 */
interface Props {
  unitSales: UnitSalesInputs;
  result: UnitSalesResult | null;
  phases: Phase[];
  term: number;
  units: Array<{ id: string; type: string }>;
  schemeAgentPct: number;
  schemeLegalPence: number;
  onChange: (next: UnitSalesInputs) => void;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';

const UNIT_TYPE_LABEL: Record<string, string> = {
  studio: 'Studio', '1bed': '1-Bed', '2bed': '2-Bed', '3bed': '3-Bed', '4bed': '4-Bed',
};

const DEPOSIT_RELEASE_LABEL: Record<DepositRelease, string> = {
  held_to_completion: 'Held to completion',
  released_on_exchange: 'Released on exchange',
};

const cellStyle: React.CSSProperties = { padding: '4px 6px', fontSize: 13, verticalAlign: 'top' };
const thStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 12, color: MUTED, textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
};
const numberInputStyle: React.CSSProperties = {
  width: 80, padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const mutedNote: React.CSSProperties = { color: MUTED, fontSize: 11, marginTop: 2 };

/** §22.6's seeding rule: a fresh row for a newly-sold unit -- no exchange yet
 *  (simultaneous), completion at the final month, no deposit, no overrides.
 *  Bit-identical to `migrateV11toV12`'s own null-deposit-percent discipline:
 *  a row this component seeds and a row born elsewhere behave the same.
 *  Task 11's brief requires this pure helper live in the same file as the
 *  component it seeds for (ExitStrategyPage.tsx imports both from here) --
 *  the fast-refresh rule flags a non-component export sharing a module with
 *  a component export, which is exactly this co-location, so it is disabled
 *  for these two named exports only. */
// eslint-disable-next-line react-refresh/only-export-components
export function seedUnitSales(soldIds: string[], term: number): UnitSalesInputs {
  return {
    deposit_release: 'held_to_completion',
    units: soldIds.map((id) => ({
      unit_id: id,
      exchange: null,
      completion: { month_offset: term - 1, anchor: null },
      deposit_pct: 0,
      agent_fee_pct: null,
      legal_fee_pence: null,
    })),
  };
}

/** Reconciles `unitSales.units` to exactly one row per id in `soldIds`:
 *  drops rows for units no longer sold, appends a freshly-seeded row for
 *  every id that has none yet, and leaves every surviving row untouched
 *  (same object, not a new one) in its original relative order. */
// eslint-disable-next-line react-refresh/only-export-components
export function reconcileUnitSalesRows(
  unitSales: UnitSalesInputs, soldIds: string[], term: number,
): UnitSalesInputs {
  const soldSet = new Set(soldIds);
  const survivors = unitSales.units.filter((u) => soldSet.has(u.unit_id));
  const survivorIds = new Set(survivors.map((u) => u.unit_id));
  const missing = soldIds.filter((id) => !survivorIds.has(id));
  const seeded = seedUnitSales(missing, term).units;
  return { ...unitSales, units: [...survivors, ...seeded] };
}

export default function UnitSalesEditor({
  unitSales, result, phases, term, units, schemeAgentPct, schemeLegalPence, onChange,
}: Props) {
  const typeById = new Map(units.map((u) => [u.id, u.type]));
  const resultById = new Map((result?.units ?? []).map((r) => [r.unit_id, r]));

  const update = (id: string, partial: Partial<UnitSale>) => {
    onChange({
      ...unitSales,
      units: unitSales.units.map((u) => (u.unit_id === id ? { ...u, ...partial } : u)),
    });
  };

  const setExchangeMode = (row: UnitSale, mode: 'fixed' | 'simultaneous') => {
    if (mode === 'simultaneous') {
      // Rule 6 (§22.1): a simultaneous exchange requires deposit_pct 0 -- this
      // component writes it in the SAME emit so the transition can never
      // produce a momentarily-invalid document.
      update(row.unit_id, { exchange: null, deposit_pct: 0 });
    } else {
      update(row.unit_id, {
        exchange: row.exchange ?? { month_offset: row.completion.month_offset, anchor: null },
      });
    }
  };

  const totals = result?.totals ?? null;
  const preSold = result?.pre_sold ?? null;

  return (
    <div style={{ overflowX: 'auto', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ color: MUTED, fontSize: 13 }}>Deposit release</label>
          <select
            aria-label="Deposit release"
            value={unitSales.deposit_release}
            onChange={(e) => onChange({ ...unitSales, deposit_release: e.target.value as DepositRelease })}
            style={{ padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
          >
            {DEPOSIT_RELEASE_VALUES.map((v) => <option key={v} value={v}>{DEPOSIT_RELEASE_LABEL[v]}</option>)}
          </select>
        </div>
        <span style={{ color: MUTED, fontSize: 13 }}>
          {/* R13b Task 11: read off result.pre_sold -- never computed here. */}
          Pre-sold {preSold?.pct != null ? preSold.pct : 'n/a'}% at month {preSold?.reference_month ?? '—'} (
          {preSold?.basis === 'practical_completion' ? 'practical completion' : 'first completion'})
        </span>
      </div>

      <table aria-label="Unit sales" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Unit', 'Gross', 'Exchange', 'Completion', 'Deposit %', 'Agent %', 'Legal £', 'Net'].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {unitSales.units.map((row) => {
            const id = row.unit_id;
            const type = typeById.get(id) ?? id;
            const resultRow = resultById.get(id);
            const label = `${UNIT_TYPE_LABEL[type] ?? type} ${id}`;
            return (
              <tr key={id} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <td style={{ ...cellStyle, color: TEXT }}>{label}</td>
                <td style={{ ...cellStyle, color: TEXT }}>
                  {resultRow ? penceToPounds(resultRow.gross_pence) : '—'}
                </td>
                <td style={cellStyle}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name={`${id}-exchange-mode`}
                        aria-label={`${id} exchange fixed`}
                        checked={row.exchange != null}
                        onChange={() => setExchangeMode(row, 'fixed')}
                      />
                      <span style={{ color: MUTED, fontSize: 12 }}>Fixed</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="radio"
                        name={`${id}-exchange-mode`}
                        aria-label={`${id} exchange simultaneous`}
                        checked={row.exchange == null}
                        onChange={() => setExchangeMode(row, 'simultaneous')}
                      />
                      <span style={{ color: MUTED, fontSize: 12 }}>Simultaneous</span>
                    </span>
                  </div>
                  {row.exchange != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="number"
                        min={0}
                        max={term - 1}
                        aria-label={`${id} exchange month`}
                        value={row.exchange.month_offset}
                        onChange={(e) => update(id, {
                          exchange: { ...row.exchange!, month_offset: Number(e.target.value) },
                        })}
                        style={numberInputStyle}
                      />
                      <ExitAnchorControl
                        value={row.exchange.anchor}
                        phases={phases}
                        monthOffset={row.exchange.month_offset}
                        onChange={(anchor) => update(id, { exchange: { ...row.exchange!, anchor } })}
                      />
                    </div>
                  )}
                  <div style={mutedNote}>
                    {resultRow?.exchange_month != null ? `resolves to month ${resultRow.exchange_month}` : '—'}
                  </div>
                </td>
                <td style={cellStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      max={term - 1}
                      aria-label={`${id} completion month`}
                      value={row.completion.month_offset}
                      onChange={(e) => update(id, {
                        completion: { ...row.completion, month_offset: Number(e.target.value) },
                      })}
                      style={numberInputStyle}
                    />
                    <ExitAnchorControl
                      value={row.completion.anchor}
                      phases={phases}
                      monthOffset={row.completion.month_offset}
                      onChange={(anchor) => update(id, { completion: { ...row.completion, anchor } })}
                    />
                  </div>
                  <div style={mutedNote}>
                    resolves to month {resultRow?.completion_month ?? '—'}
                  </div>
                </td>
                <td style={cellStyle}>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    aria-label={`${id} deposit %`}
                    value={row.deposit_pct}
                    onChange={(e) => update(id, { deposit_pct: Number(e.target.value) })}
                    style={numberInputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <input
                    type="number"
                    step="0.1"
                    aria-label={`${id} agent %`}
                    value={row.agent_fee_pct ?? ''}
                    placeholder={String(schemeAgentPct)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      update(id, { agent_fee_pct: raw === '' ? null : Number(raw) });
                    }}
                    style={numberInputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <PenceInput
                    nullable
                    ariaLabel={`${id} legal £`}
                    placeholder={String(schemeLegalPence)}
                    penceValue={row.legal_fee_pence}
                    onChangePence={(v) => update(id, { legal_fee_pence: v })}
                    style={{ width: 140 }}
                  />
                </td>
                <td style={{ ...cellStyle, color: TEXT }}>
                  {resultRow ? penceToPounds(resultRow.net_pence) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...cellStyle, color: TEXT, fontWeight: 600 }}>Totals</td>
            <td style={{ ...cellStyle, color: TEXT, fontWeight: 600 }}>
              {totals ? penceToPounds(totals.gross_pence) : '—'}
            </td>
            <td style={{ ...cellStyle, color: TEXT }}>
              {totals ? `Deposits released ${penceToPounds(totals.deposits_released_pence)}` : '—'}
            </td>
            <td style={cellStyle}>—</td>
            <td style={cellStyle}>—</td>
            <td style={{ ...cellStyle, color: TEXT }}>
              {totals ? penceToPounds(totals.agent_fees_pence) : '—'}
            </td>
            <td style={{ ...cellStyle, color: TEXT }}>
              {totals ? penceToPounds(totals.legal_fees_pence) : '—'}
            </td>
            <td style={{ ...cellStyle, color: TEXT, fontWeight: 600 }}>
              {totals ? penceToPounds(totals.net_pence) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
