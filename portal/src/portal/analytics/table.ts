import type { SchoolsAnalyticsSchool } from '../types/portal';
import type { SortKey } from './copy';

/**
 * bd-s6qbts.3 — the school table's order and search, kept out of the components so the desktop table and the phone
 * cards can never disagree.
 */

export type SortDir = 'asc' | 'desc';
export interface SortState { key: SortKey; dir: SortDir }

export const SORT_KEYS: readonly SortKey[] = [
  'name', 'region', 'teachers', 'lpsOpened', 'dcObservations', 'humanObservations', 'avgFico', 'avgHitl',
];

export const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };

const TEXT_KEYS: readonly SortKey[] = ['name', 'region'];

/** Names A→Z first; a number biggest first — the question is usually "who is doing the most". */
export const firstDir = (key: SortKey): SortDir => (TEXT_KEYS.includes(key) ? 'asc' : 'desc');

/** Tap the column already sorted on to flip it; tap another to sort on it from its first direction. */
export function nextSort(current: SortState, key: SortKey): SortState {
  return current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(key) };
}

const byName = (a: SchoolsAnalyticsSchool, b: SchoolsAnalyticsSchool) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * A copy in order. A school with no score (null average) is always last, whichever way: "—" is not the lowest score,
 * it is no score. Ties fall back to the name.
 */
export function sortSchools(schools: readonly SchoolsAnalyticsSchool[], { key, dir }: SortState): SchoolsAnalyticsSchool[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...schools].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b);
    if (key === 'region') return sign * a.region.localeCompare(b.region, 'en', { sensitivity: 'base' }) || byName(a, b);
    const x = a[key] as number | null;
    const y = b[key] as number | null;
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return sign * (x - y) || byName(a, b);
  });
}

/** By name or EMIS code, any case, any part of either. */
export function searchSchools(schools: readonly SchoolsAnalyticsSchool[], query: string): SchoolsAnalyticsSchool[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...schools];
  return schools.filter((s) => s.name.toLowerCase().includes(q) || (s.emis ?? '').toLowerCase().includes(q));
}
