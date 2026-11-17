/**
 * Round 28 (SPEC F): the guessing floor beside a tapped score. A child who taps at random picks the right card with
 * p = 1 / options; the share of such children who still reach a rung (k of n) is the binomial P(X ≥ k). Text only:
 * no score, band or level reads it.
 */

/** P(X ≥ k) for X ~ Binomial(n, p). */
export function guessFloor(p: number, n: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  let c = 1; // C(n, 0)
  for (let x = 0; x <= n; x += 1) {
    if (x > 0) c = (c * (n - x + 1)) / x;
    if (x >= k) sum += c * p ** x * (1 - p) ** (n - x);
  }
  return sum;
}

/** A floor as a percent: one decimal from 0.1% up ("3.8%", "0.6%"), one significant figure below ("0.008%"). */
export function fmtFloor(x: number): string {
  const pct = x * 100;
  if (pct >= 0.1) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Number(pct.toPrecision(1))}%`;
}

/** The rungs each tapped task is read at (the level ladder's), with its item count and default options. */
const TAP_RUNGS: { re: RegExp; n: number; options: number; rungs: number[] }[] = [
  { re: /^(ur|en)\.story_mcq_w3$/, n: 6, options: 4, rungs: [4] },
  { re: /^(ur|en)\.letter_pick10$/, n: 10, options: 5, rungs: [8, 6] },
];

export type Floor = { k: number; n: number; share: number };

/** The guessing floors of a tapped task, highest rung first; null for every other task. `optionsN` from the result. */
export function tapFloors(taskId: string, optionsN: number | null | undefined): Floor[] | null {
  const t = TAP_RUNGS.find((x) => x.re.test(taskId));
  if (!t) return null;
  const options = typeof optionsN === 'number' && optionsN >= 2 ? optionsN : t.options;
  return t.rungs.map((k) => ({ k, n: t.n, share: guessFloor(1 / options, t.n, k) }));
}

/** The picker's tap-before-sound rate above which the card says "read with care". */
export const TAP_CARE_ABOVE = 0.1;
