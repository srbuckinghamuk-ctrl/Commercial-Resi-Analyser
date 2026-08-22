import { useCallback, useMemo } from 'react';
import type {
  AppraisalRun, CalculatorInputsV8, CalculatorInputsV9, ProgrammeInputs, ProgrammeNetwork, Phase,
} from '../../lib/model';
import { isProgrammeNetwork, isLegacyProgramme, PACKAGE_TO_PHASE } from '../../lib/model';
import { derivePhases } from '../../lib/model/programme';
import { penceToPounds } from '../../lib/format';
import { formatProgrammeMonth } from '../../lib/programme-months';
import CalculatorFailurePanel from '../CalculatorFailurePanel';
import PhaseEditor from './PhaseEditor';
import ProgrammeGantt from './ProgrammeGantt';

/**
 * R12 spec §18.1/§18.10. `programme` is a two-state field across the version
 * union (`null` = auto windows, or a shape) but THREE states reach this page:
 * `null`, the legacy `{ packages: {...} }` shape a v4-v8 document still
 * carries, and a v9 `{ phases: [...] }` network. `isProgrammeNetwork` /
 * `isLegacyProgramme` (programme.ts) are the sole sanctioned discriminators.
 *
 * The real app (ConversionCalculator.tsx) is v8-only for this release, so T
 * resolves to CalculatorInputsV8 there and this component behaves exactly as
 * before for every existing call site. A future caller wiring the app to v9
 * end-to-end passes CalculatorInputsV9 instead -- both compile against the
 * SAME component because Props is generic over the two shapes `programme` can
 * legally live on, and `onChange` stays typed to whichever one the caller has.
 */
type ProgrammeCarrier = CalculatorInputsV8 | CalculatorInputsV9;

interface Props<T extends ProgrammeCarrier> {
  inputs: T;
  onChange: (partial: Partial<T>) => void;
  run: AppraisalRun;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const ACCENT = '#2563eb';
const DISABLED_BG = '#1e293b';
const DISABLED_TEXT = '#475569';

const numberInputStyle: React.CSSProperties = {
  width: 90, padding: '6px 10px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 14,
};

const cellStyle: React.CSSProperties = { padding: '4px 10px', fontSize: 13, textAlign: 'right', color: TEXT };

/** The auto-window arithmetic (spec §6, unchanged by R12): construction spans
 *  months 1..term-2, professional/statutory span the first half of that. Used
 *  ONLY to seed the starting values of a template network the user then edits
 *  -- this is input scaffolding, not the schedule's own calculation, which
 *  lives in schedule.ts's auto arm untouched by this file. */
function templateWindows(term: number): { construction: number; professional: number; statutory: number } {
  const cw = Math.max(1, term - 2);
  const pw = Math.max(1, Math.ceil(cw / 2));
  return { construction: cw, professional: pw, statutory: pw };
}

/** Predecessor-free phases named/coded exactly as migrateV8toV9 would produce
 *  (PACKAGE_TO_PHASE, migrate.ts) -- so a template built here and a v8
 *  document actually migrated land on the same phase ids and codes. */
function phasesFromWindows(
  windows: Record<'construction' | 'professional' | 'statutory', number>,
  startOffset: (name: 'construction' | 'professional' | 'statutory') => number,
  curveOf: (name: 'construction' | 'professional' | 'statutory') => Phase['curve'],
): Phase[] {
  return (Object.keys(PACKAGE_TO_PHASE) as Array<keyof typeof PACKAGE_TO_PHASE>).map((name) => ({
    id: name,
    code: PACKAGE_TO_PHASE[name].code,
    label: PACKAGE_TO_PHASE[name].label,
    duration_months: windows[name],
    slip_months: 0,
    start_offset: startOffset(name),
    curve: curveOf(name),
    predecessors: [],
  }));
}

function categoryPhaseIdsFrom(phases: Phase[]): ProgrammeNetwork['category_phase_ids'] {
  return Object.fromEntries(phases.map((p) => [p.id, p.id])) as ProgrammeNetwork['category_phase_ids'];
}

function defaultTemplateNetwork(term: number): ProgrammeNetwork {
  const windows = templateWindows(term);
  const phases = phasesFromWindows(windows, () => 1, () => ({ kind: 'straight_line' }));
  return { anchor_month: null, phases, category_phase_ids: categoryPhaseIdsFrom(phases) };
}

/** Mirrors migrateV8toV9's own phase-building transform (migrate.ts) exactly
 *  -- same ids, same codes, same values carried across -- so converting here
 *  produces the identical network the real migration would have written. */
function networkFromLegacy(programme: ProgrammeInputs): ProgrammeNetwork {
  const windows = {
    construction: programme.packages.construction.duration_months,
    professional: programme.packages.professional.duration_months,
    statutory: programme.packages.statutory.duration_months,
  };
  const phases = phasesFromWindows(
    windows,
    (name) => programme.packages[name].start_offset,
    (name) => programme.packages[name].curve,
  );
  return { anchor_month: programme.anchor_month, phases, category_phase_ids: categoryPhaseIdsFrom(phases) };
}

export default function ProgrammePage<T extends ProgrammeCarrier>({ inputs, onChange, run }: Props<T>) {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const canBuildTemplate = term >= 3;
  const rawProgramme = inputs.programme;

  const network = rawProgramme != null && isProgrammeNetwork(rawProgramme) ? rawProgramme : null;
  const legacyProgramme = rawProgramme != null && isLegacyProgramme(rawProgramme) ? rawProgramme : null;
  const anchor = rawProgramme?.anchor_month ?? null;

  // §18.2/§18.4: the ONE call to derivePhases on this page. PhaseEditor and
  // ProgrammeGantt below receive only its result -- neither derives anything.
  const derivation = useMemo(() => (network != null ? derivePhases(network) : null), [network]);
  const isCycle = derivation !== null && 'cycle' in derivation;
  const derivedById = derivation !== null && !('cycle' in derivation) ? derivation.byId : null;

  const buildTemplate = useCallback(() => {
    if (!window.confirm(
      'Building a phase network replaces the auto windows with an editable dependency network you can '
      + 'add phases, dependencies and slip to. This cannot be undone automatically. Continue?',
    )) return;
    onChange({ programme: defaultTemplateNetwork(term) } as Partial<T>);
  }, [term, onChange]);

  const convertLegacy = useCallback(() => {
    if (!legacyProgramme) return;
    if (!window.confirm(
      'Converting migrates the three legacy packages (construction, professional, statutory) into phases '
      + 'you can edit here, add dependencies to and reorder. Continue?',
    )) return;
    onChange({ programme: networkFromLegacy(legacyProgramme) } as Partial<T>);
  }, [legacyProgramme, onChange]);

  const updateAnchor = useCallback(
    (value: string) => {
      if (!network) return;
      onChange({ programme: { ...network, anchor_month: value || null } } as Partial<T>);
    },
    [network, onChange],
  );

  const updatePhases = useCallback(
    (phases: Phase[]) => {
      if (!network) return;
      onChange({ programme: { ...network, phases } } as Partial<T>);
    },
    [network, onChange],
  );

  return (
    <div>
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 20 }}>7. Programme</h3>

      {rawProgramme == null && (
        <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 24 }}>
          <p style={{ color: MUTED, fontSize: 14, marginBottom: 12 }}>
            Auto windows: straight-line construction over months 1–{Math.max(1, term - 2)}, professional/statutory
            over the first half — spec §6.
          </p>
          <button
            onClick={buildTemplate}
            disabled={!canBuildTemplate}
            style={{
              padding: '8px 20px',
              background: canBuildTemplate ? ACCENT : DISABLED_BG,
              color: canBuildTemplate ? '#fff' : DISABLED_TEXT,
              border: 'none',
              borderRadius: 6,
              cursor: canBuildTemplate ? 'pointer' : 'default',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Build phase network
          </button>
          {!canBuildTemplate && (
            <p style={{ color: '#f59e0b', fontSize: 13, marginTop: 8 }}>
              A phase network requires a term of at least 3 months — the final two months are the
              sale-tail (spec §6).
            </p>
          )}
        </div>
      )}

      {legacyProgramme && (
        <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 24 }}>
          <p style={{ color: MUTED, fontSize: 14, marginBottom: 12 }}>
            This appraisal still carries a legacy three-package programme. Convert it to a phase network to
            edit dependencies, slip and the critical path here.
          </p>
          <button
            onClick={convertLegacy}
            style={{ padding: '8px 20px', background: ACCENT, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            Convert to phase network
          </button>
        </div>
      )}

      {network && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label htmlFor="programme-anchor-month" style={{ color: MUTED, fontSize: 14 }}>Anchor month</label>
            <input
              id="programme-anchor-month"
              type="month"
              value={anchor ?? ''}
              onChange={(e) => updateAnchor(e.target.value)}
              style={numberInputStyle}
            />
          </div>

          <PhaseEditor phases={network.phases} derivedById={derivedById} onChange={updatePhases} />

          {/* §18.2's "Cycles" note: a cycle has no topological order and no
              defensible default start for a phase inside it -- no dates exist,
              so no bars are drawn. Not a half-drawn chart, not zeroes. */}
          {isCycle && derivation && 'cycle' in derivation && (
            <CalculatorFailurePanel title="This programme has a dependency cycle">
              {`Phase dependency cycle: ${derivation.cycle.join(' → ')}.`}
            </CalculatorFailurePanel>
          )}
          {!isCycle && derivation && !('cycle' in derivation) && (
            <ProgrammeGantt derivation={derivation} />
          )}
        </div>
      )}

      <div>
        <h4 style={{ color: MUTED, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Spend Preview
        </h4>
        {/* Engine output only (run.schedule.uses) -- component-local spend arithmetic
            is prohibited, see ExitStrategyPage.tsx for the same precedent. */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Month', 'Construction', 'Professional', 'Statutory', 'Total'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === 'Month' ? 'left' : 'right', color: MUTED, fontSize: 12,
                      padding: '6px 10px', borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.schedule.uses.map((u, m) => {
                const total = u.construction_pence + u.professional_pence + u.statutory_pence;
                return (
                  <tr key={m}>
                    <td style={{ padding: '4px 10px', fontSize: 13, color: TEXT }}>
                      {formatProgrammeMonth(anchor, m)}
                    </td>
                    <td style={cellStyle}>{penceToPounds(u.construction_pence)}</td>
                    <td style={cellStyle}>{penceToPounds(u.professional_pence)}</td>
                    <td style={cellStyle}>{penceToPounds(u.statutory_pence)}</td>
                    <td style={{ ...cellStyle, fontWeight: 600 }}>{penceToPounds(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
