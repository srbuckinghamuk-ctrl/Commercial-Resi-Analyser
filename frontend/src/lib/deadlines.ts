import type { Project } from '../types';

export interface Deadline {
  /** What the deadline is. */
  label: string;
  /** ISO date the window ends. */
  due: string;
  /** Whole days from `today` until due (negative = overdue). */
  daysRemaining: number;
  status: 'ok' | 'warning' | 'overdue';
  /** Short chip text, e.g. "PA day 31 of 56" or "12 days overdue". */
  chip: string;
}

const MS_PER_DAY = 86_400_000;

function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
}

function addYears(iso: string, years: number): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * The statutory deadline currently driving this project, if any.
 *
 * - Stage "prior_approval_submitted" with a submission date: the LPA's
 *   56-day determination window.
 * - Stage "approved" / "in_conversion" with a decision date: the 3-year
 *   completion window attached to the prior approval.
 *
 * `today` is injectable for tests; defaults to the current date.
 */
export function activeDeadline(project: Project, today: Date = new Date()): Deadline | null {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (project.stage === 'prior_approval_submitted' && project.pa_submitted_date) {
    const due = addDays(project.pa_submitted_date, 56);
    const daysRemaining = wholeDaysBetween(startOfToday, due);
    const dayNumber = 56 - daysRemaining;
    const status = daysRemaining < 0 ? 'overdue' : daysRemaining <= 14 ? 'warning' : 'ok';
    return {
      label: '56-day determination window',
      due: isoDate(due),
      daysRemaining,
      status,
      chip:
        daysRemaining < 0
          ? `PA determination ${-daysRemaining} day${daysRemaining === -1 ? '' : 's'} overdue`
          : `PA day ${Math.min(Math.max(dayNumber, 1), 56)} of 56`,
    };
  }

  if ((project.stage === 'approved' || project.stage === 'in_conversion') && project.pa_decision_date) {
    const due = addYears(project.pa_decision_date, 3);
    const daysRemaining = wholeDaysBetween(startOfToday, due);
    const status = daysRemaining < 0 ? 'overdue' : daysRemaining <= 180 ? 'warning' : 'ok';
    return {
      label: '3-year completion window',
      due: isoDate(due),
      daysRemaining,
      status,
      chip:
        daysRemaining < 0
          ? 'Completion window expired'
          : daysRemaining > 365
            ? `Complete by ${isoDate(due)}`
            : `${daysRemaining} days to complete`,
    };
  }

  return null;
}

/** Today's date as an ISO date string (local time). */
export function todayIso(): string {
  return isoDate(new Date());
}
