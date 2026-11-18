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

/**
 * A rung as a count on `of` items: the least k with k / of ≥ share, i.e. ceil(share × of). The MCQ's 0.67 is the
 * ladder's shorthand for two thirds (4 of 6) and is read as 2/3 exactly, as the level ladder compares it.
 */
export function rungK(share: number, of: number): number {
  const s = share === 0.67 ? 2 / 3 : share;
  return Math.ceil(s * of - 1e-9);
}

/** The rungs each tapped task is read at (the level ladder's shares), with its full item count and default options. */
const TAP_RUNGS: { re: RegExp; n: number; options: number; shares: number[] }[] = [
  { re: /^(ur|en)\.story_mcq_w3$/, n: 6, options: 4, shares: [0.67] },
  { re: /^(ur|en)\.letter_pick10$/, n: 10, options: 5, shares: [0.8, 0.6] },
];

export type Floor = { k: number; n: number; share: number };

/**
 * The guessing floors of a tapped task, highest rung first; null for every other task. `optionsN` from the result.
 * `of` is the items the rung is read on (the picker's presented, the MCQ's 6 − lost: cohortStats.tapOf, the same
 * denominator the share divides by); absent or not positive, the task's full count.
 */
export function tapFloors(taskId: string, optionsN: number | null | undefined, of?: number | null): Floor[] | null {
  const t = TAP_RUNGS.find((x) => x.re.test(taskId));
  if (!t) return null;
  const options = typeof optionsN === 'number' && optionsN >= 2 ? optionsN : t.options;
  const n = typeof of === 'number' && of > 0 ? of : t.n;
  return t.shares.map((sh) => {
    const k = rungK(sh, n);
    return { k, n, share: guessFloor(1 / options, n, k) };
  });
}

/** The picker's tap-before-sound rate above which the card says "read with care". */
export const TAP_CARE_ABOVE = 0.1;
