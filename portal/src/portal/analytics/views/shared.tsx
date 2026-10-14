import type { ReactNode } from 'react';
import { Chip } from '../../newui';
import type { CoachingAnalyticsResponse, SchoolsAnalyticsResponse } from '../../types/portal';
import type { AnalyticsWords } from '../copy';
import { count } from '../format';
import type { SchoolRow } from '../table';

/** bd-97x22y.2 — what every data tab is given: the schools read, the chosen region (as the server writes it), and how to choose. */
export interface TabProps {
  c: AnalyticsWords;
  data: SchoolsAnalyticsResponse;
  /** The chosen region, as written in `data.regions`; null = All regions. */
  region: string | null;
  onRegion: (region: string | null) => void;
  phone: boolean;
  /** "logged since 4 Oct", when the window starts before LP opens were recorded. */
  lpOpensNote: string | null;
}

export type CoachingStatus = 'loading' | 'ready' | 'error' | 'forbidden';
export interface CoachingState {
  status: CoachingStatus;
  data: CoachingAnalyticsResponse | null;
  retry: () => void;
}

/** A sector card's tap: choose it, or — when it is the chosen one — go back to all regions. */
export const toggleRegion = (p: Pick<TabProps, 'region' | 'onRegion'>, region: string) =>
  p.onRegion(p.region === region ? null : region);

/** The chosen region's schools (the server already sends only those; this keeps old rows out while the next arrive). */
export function schoolsIn<T extends SchoolRow>(schools: readonly T[], region: string): T[] {
  const r = region.toLowerCase();
  return schools.filter((s) => s.region.toLowerCase() === r);
}

/** A tile's chip. */
export const chip = (text: ReactNode) => <Chip>{text}</Chip>;

/** "of 442 teachers" under a count of teachers. */
export const ofTeachers = (c: AnalyticsWords, n: number) => chip(c.ofTeachers(count(n, c)));

/** "188 scored" under a score; nothing when none was. */
export const scoredChip = (c: AnalyticsWords, n: number) => (n > 0 ? chip(c.scored(count(n, c))) : null);

/** The LP-opens note as a chip, for the tiles that count LP opens. */
export const lpNoteChip = (note: string | null) => (note ? <span data-testid="lp-opens-note"><Chip>{note}</Chip></span> : null);
