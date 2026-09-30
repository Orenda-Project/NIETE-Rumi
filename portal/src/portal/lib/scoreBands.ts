/**
 * Observation scores show as a BAND, never a number or a percentage
 * (operator, 2026-09-29).
 *
 * This is the portal's copy of the bot's rule in
 * bot/shared/config/score-bands.js — separate builds, so it has to exist
 * twice. scoreBands.test.ts loads the bot's copy and fails if they ever
 * disagree, on thresholds or on the words. Change both, or neither.
 *
 * The band is read off the RAW percentage: 79.6 is Good, not Excellent.
 */

export type BandKey = 'excellent' | 'good' | 'average' | 'below_average' | 'needs_support';

export const BAND_THRESHOLDS: ReadonlyArray<{ key: BandKey; min: number; label: string }> = [
  { key: 'excellent', min: 80, label: 'Excellent' },
  { key: 'good', min: 60, label: 'Good' },
  { key: 'average', min: 40, label: 'Average' },
  { key: 'below_average', min: 20, label: 'Below average' },
  { key: 'needs_support', min: 0, label: 'Needs support' },
];

function toPct(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** null when there is no score — never a fabricated "Needs support". */
export function scoreBandFor(pct: unknown): BandKey | null {
  const n = toPct(pct);
  if (n === null) return null;
  return (BAND_THRESHOLDS.find((b) => n >= b.min) ?? BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1]).key;
}

export function bandLabel(key: BandKey | null | undefined): string | null {
  return key ? BAND_THRESHOLDS.find((b) => b.key === key)?.label ?? null : null;
}

export function scoreBandLabel(pct: unknown): string | null {
  return bandLabel(scoreBandFor(pct));
}

/** A raw score on a known scale, e.g. an indicator's 1 of 2. */
export function scoreBandForScore(score: unknown, max: unknown): BandKey | null {
  const s = toPct(score);
  const m = toPct(max);
  if (s === null || m === null || m <= 0) return null;
  return scoreBandFor((s / m) * 100);
}

/** Tailwind tone per band, shared so a band looks the same everywhere. */
export const BAND_TONE: Record<BandKey, string> = {
  excellent: 'bg-success/10 text-success border-success/20',
  good: 'bg-success/10 text-success border-success/20',
  average: 'bg-warning/10 text-warning border-warning/20',
  below_average: 'bg-error/10 text-error border-error/20',
  needs_support: 'bg-error/10 text-error border-error/20',
};

/** Bar/marker colour per band, for charts and progress bars. */
export const BAND_COLOR: Record<BandKey, string> = {
  excellent: '#059669',
  good: '#10b981',
  average: '#f59e0b',
  below_average: '#f97316',
  needs_support: '#e11d48',
};

// ── Chart helpers ────────────────────────────────────────────────────────────
// A 0-100 axis with gridlines every 20 is exactly the band boundaries, so each
// gridline is labelled with the band that STARTS there and the top line (100)
// is left blank rather than repeating "Excellent".

export function bandAxisLabel(value: number): string {
  if (value >= 100) return '';
  return scoreBandLabel(value) ?? '';
}

export function bandTooltip(value: number): string {
  return scoreBandLabel(value) ?? '';
}

/** ApexCharts y-axis in bands: five zones, no numbers. */
export const BAND_Y_AXIS = {
  min: 0,
  max: 100,
  tickAmount: 5,
  labels: { formatter: (v: number) => bandAxisLabel(v) },
} as const;
