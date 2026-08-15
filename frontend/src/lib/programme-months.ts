import type { AnyCalculatorInputs } from './model';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar anchor of an explicit programme, or null for auto windows and
 * pre-v4 documents. Centralises the version guard so every surface that labels a
 * ledger month resolves the anchor the same way. */
export function programmeAnchor(inputs: AnyCalculatorInputs): string | null {
  return 'programme' in inputs ? (inputs.programme?.anchor_month ?? null) : null;
}

/** Display-only calendar labels (spec §2.1: anchor_month never enters calculation). */
export function formatProgrammeMonth(
  anchorMonth: string | null | undefined, monthIndex: number,
): string {
  if (!anchorMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(anchorMonth)) return `Month ${monthIndex}`;
  const [y, mo] = anchorMonth.split('-').map(Number);
  const total = (mo - 1) + monthIndex;
  return `${MONTH_NAMES[total % 12]} ${y + Math.floor(total / 12)}`;
}
