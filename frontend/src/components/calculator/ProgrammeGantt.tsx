import type { ProgrammeDerivation } from '../../lib/model';

/**
 * R12 spec §18.10. A CSS-grid bar chart, one row per phase. Every position comes
 * straight off `derivation` -- offset and width are `start_month`/`duration_months`,
 * float is `total_float_months`, criticality is `is_critical`. No calculation here:
 * ProgrammePage is the only caller of `derivePhases` (spec §18.2/§18.4) and this
 * component only reads its result.
 *
 * The caller (ProgrammePage) never mounts this component for a cyclic network --
 * a cycle has no dates (spec §18.2's "Cycles" note) and there is nothing here to
 * plot. That branch renders the validation error instead.
 */
interface Props {
  derivation: ProgrammeDerivation;
}

const TEXT = '#e2e8f0';
const BORDER = '#1e3a5f';
const BAR = '#2563eb';
const BAR_CRITICAL = '#dc2626';
const FLOAT_COLOR = 'rgba(148, 163, 184, 0.35)';
const MILESTONE = '#f59e0b';
const MILESTONE_CRITICAL = '#dc2626';

const LABEL_COLUMN_PX = 160;

export default function ProgrammeGantt({ derivation }: Props) {
  // At least one column so an empty or all-milestone-at-month-0 network still
  // renders a grid rather than dividing by zero in the percentage math below.
  const totalMonths = Math.max(derivation.finish_month, 1);

  return (
    <div
      role="table"
      aria-label="Programme Gantt"
      style={{
        display: 'grid',
        gridTemplateColumns: `${LABEL_COLUMN_PX}px 1fr`,
        rowGap: 10,
        alignItems: 'center',
        padding: '12px 0',
      }}
    >
      {derivation.phases.map((dp, rowIndex) => {
        // §18.3: duration_months === 0 is a milestone. It occupies no month, so
        // it MUST render as a marker -- a zero-width bar is invisible, and
        // practical completion is the single most important date on the chart.
        const isMilestone = dp.duration_months === 0;
        const criticalSuffix = dp.is_critical ? ', critical' : '';
        const startPct = (dp.start_month / totalMonths) * 100;
        const durationPct = (dp.duration_months / totalMonths) * 100;
        const floatPct = (dp.total_float_months / totalMonths) * 100;

        return (
          <div role="row" aria-label={`${dp.label} row`} key={dp.id} style={{ display: 'contents' }}>
            <div
              role="cell"
              style={{
                gridColumn: '1 / 2',
                gridRow: rowIndex + 1,
                color: TEXT,
                fontSize: 13,
                paddingRight: 8,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {dp.label}
            </div>
            <div
              role="cell"
              style={{
                gridColumn: '2 / 3',
                gridRow: rowIndex + 1,
                position: 'relative',
                height: 18,
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              {isMilestone ? (
                <div
                  role="img"
                  aria-label={`${dp.label} milestone at month ${dp.start_month}${criticalSuffix}`}
                  style={{
                    position: 'absolute',
                    left: `${startPct}%`,
                    top: 3,
                    width: 12,
                    height: 12,
                    marginLeft: -6,
                    background: dp.is_critical ? MILESTONE_CRITICAL : MILESTONE,
                    transform: 'rotate(45deg)',
                  }}
                />
              ) : (
                <div
                  role="img"
                  aria-label={`${dp.label} bar: months ${dp.start_month} to ${dp.finish_month}${criticalSuffix}`}
                  style={{
                    position: 'absolute',
                    left: `${startPct}%`,
                    width: `${durationPct}%`,
                    top: 2,
                    height: 14,
                    background: dp.is_critical ? BAR_CRITICAL : BAR,
                    borderRadius: 3,
                  }}
                />
              )}
              {/* Float is a lighter trailing segment, shown only when there is
                  any -- a zero-width segment for a critical (zero-float) phase
                  is the same "invisible bar" problem the milestone marker
                  above solves, so it is omitted rather than rendered at width 0. */}
              {dp.total_float_months > 0 && (
                <div
                  role="img"
                  aria-label={`${dp.label} float: ${dp.total_float_months} months`}
                  style={{
                    position: 'absolute',
                    left: `${(dp.finish_month / totalMonths) * 100}%`,
                    width: `${floatPct}%`,
                    top: 2,
                    height: 14,
                    background: FLOAT_COLOR,
                    borderRadius: 3,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
