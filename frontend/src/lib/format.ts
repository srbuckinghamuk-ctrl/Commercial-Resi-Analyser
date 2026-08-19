import { USE_CLASS_OPTIONS } from '../types';
import type { UseClass } from '../types';

export function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

/** R10 Task 12. Same as `penceToPounds` but keeps the pence, for cost-plan
 *  contingency/fee amounts that are the product of a percentage and a base
 *  and so are not generally whole pounds (e.g. a 5% class on 1,000,010 pence
 *  is 50,000.5 pence). Rounding to whole pounds here would silently hide the
 *  half-penny rounding boundary the engine itself resolves half-up. */
export function penceToPoundsExact(pence: number): string {
  return (pence / 100).toLocaleString(
    'en-GB',
    { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
}

/** Format a percentage that may be null/non-finite (e.g. IRR on a loss-making deal). */
export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

/** Turn a snake_case enum value into readable text ("restaurant_cafe" -> "Restaurant Cafe"). */
export function humanise(value: string): string {
  return value
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Display label for a use class ("office" -> "Office (E(a))"). */
export function formatUseClass(useClass: UseClass): string {
  return USE_CLASS_OPTIONS.find((o) => o.value === useClass)?.label ?? humanise(useClass);
}

/**
 * Section labels that listing pages put in a heading inside the description
 * container. Longest first, so "Property Description" is matched before
 * "Description".
 */
const GLUED_LEADING_LABELS = [
  'Full Property Description',
  'Property Description',
  'Full Description',
  'Key Features',
  'Accommodation',
  'Description',
  'Overview',
  'Summary',
];

/**
 * Repair a scraped description whose section heading was glued to its first
 * sentence — the "DescriptionThe property comprises..." the second
 * lender-readiness audit found in the exported memorandum.
 *
 * The cause was in the scraper (`get_text(strip=True)` joins block children with
 * no separator) and is fixed there, so anything scraped from now on arrives
 * clean. This exists for the records already stored — including the live York
 * appraisal, whose `description` still begins with that exact string.
 *
 * It is deliberately narrow. It fires only when a known section label sits at
 * the very start of the text *and* is followed immediately by a capital letter
 * with no space, which is the signature of the defect and does not occur in
 * ordinary prose. It does not attempt the general "insert a space at every
 * lowercase-uppercase boundary" repair, which would mangle "iPhone", "PhD",
 * "GDVs" and any legitimately capitalised compound.
 *
 * The label is removed rather than spaced: it is a scrape artifact, not part of
 * the property description, and "Description The property comprises..." reads no
 * better than the defect it replaces.
 */
export function repairGluedDescription(text: string): string {
  for (const label of GLUED_LEADING_LABELS) {
    if (text.length <= label.length) continue;
    if (!text.startsWith(label)) continue;
    const next = text[label.length];
    // A capital immediately after the label, with no separator of any kind.
    if (next >= 'A' && next <= 'Z') return text.slice(label.length);
  }
  return text;
}
