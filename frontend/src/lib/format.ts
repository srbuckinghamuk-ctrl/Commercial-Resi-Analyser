import { USE_CLASS_OPTIONS } from '../types';
import type { UseClass } from '../types';

export function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
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
