import type { SaLevel, SaResults } from '../../types/childTestSa';

/**
 * Round 20 (server switch sa_r20_level): the level ladders in order, and a group's typical level for the dashboard.
 * The words (copy.ts) and the server's cut-offs (bot sa/level.js) are the ones sent for review.
 */
export const SUBJECTS = ['ur', 'en', 'ma'] as const;
export type Subject = (typeof SUBJECTS)[number];

const READING: SaLevel[] = ['beginner', 'letters', 'words', 'story', 'comprehension'];
const MATHS: SaLevel[] = ['beginner', 'numbers', 'comparing', 'add', 'sub_mul'];
export const ladderOf = (subject: Subject): SaLevel[] => (subject === 'ma' ? MATHS : READING);

/** Whether any of these results carries the level lines (the server's switch is ON). */
export function hasLevels(results: SaResults[]): boolean {
  return results.some((r) => Array.isArray(r.levels) && r.levels.length > 0);
}

/** The subjects any of these results has a line for, in the order Urdu, English, Maths. */
export function subjectsIn(results: SaResults[]): Subject[] {
  const seen = new Set<string>();
  for (const r of results) for (const l of r.levels || []) seen.add(l.subject);
  return SUBJECTS.filter((s) => seen.has(s));
}

/** The middle level of the children with one in this subject (the lower middle on an even count); null when none. */
export function typicalLevel(results: SaResults[], subject: Subject): SaLevel | null {
  const order = ladderOf(subject);
  const ranks = results
    .map((r) => (r.levels || []).find((l) => l.subject === subject))
    .map((l) => (l && l.level ? order.indexOf(l.level) : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  return ranks.length ? order[ranks[Math.floor((ranks.length - 1) / 2)]] : null;
}
