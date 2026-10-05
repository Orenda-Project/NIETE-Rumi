import type { ActiveCoachingSession } from '../../services/api';
import type { CoachingSession } from '../../types/portal';
import { bandLabel, scoreBandFor, type BandKey } from '../../lib/scoreBands';
import type { ChipTone } from '../Chip';
import { COACHING_COPY, MONTHS } from '../copy';
import { pkToday } from '../range';

/**
 * bd-5rz1v.26 — her lessons as rows on Coaching's main page: the finished ones and the ones still
 * on their way, newest first, under a month label (Pakistan time). Same sources and the same
 * rules as today's CoachingHome; only the words are labels now.
 *
 * Colour is meaning (DESIGN.md): a band of Good or better is green, below that amber (as on
 * Home's coaching list); a lesson on its way is amber; no band is grey.
 */

export type LessonChip = { text: string; tone: ChipTone; kind: 'subject' | 'who' | 'band' | 'state' };

export type LessonRow = {
  id: string;
  /** When, in ms — the sort key. */
  at: number;
  title: string;
  subject: string | null;
  chips: LessonChip[];
  /** The day of the month, Pakistan time ("2"). */
  day: string;
  /** "2026-10" and "Oct 2026". */
  monthKey: string;
  monthLabel: string;
};

/** Good and above green; below Good amber (HomeList's BAND_TONE). */
export const BAND_TONE: Record<BandKey, ChipTone> = {
  excellent: 'done',
  good: 'done',
  average: 'waiting',
  below_average: 'waiting',
  needs_support: 'waiting',
};

function when(iso: string): Pick<LessonRow, 'at' | 'day' | 'monthKey' | 'monthLabel'> | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [y, m, day] = pkToday(d).split('-').map(Number);
  return { at: d.getTime(), day: String(day), monthKey: `${y}-${String(m).padStart(2, '0')}`, monthLabel: `${MONTHS[m - 1]} ${y}` };
}

const subjectChip = (subject: string | null | undefined): LessonChip[] =>
  (subject ? [{ text: subject, tone: 'info', kind: 'subject' }] : []);

export function fromDone(s: CoachingSession): LessonRow | null {
  const w = when(s.date);
  if (!w) return null;
  const band = scoreBandFor(s.percentage);
  return {
    id: s.id,
    ...w,
    title: s.topic || (s.observation ? COACHING_COPY.observation : COACHING_COPY.yourLesson),
    subject: s.subject || null,
    chips: [
      ...subjectChip(s.subject),
      ...(s.observation ? [{ text: COACHING_COPY.coachVisit, tone: 'info', kind: 'who' } as LessonChip] : []),
      band
        ? { text: COACHING_COPY.bands[band] ?? bandLabel(band) ?? '', tone: BAND_TONE[band], kind: 'band' }
        : { text: COACHING_COPY.states.notRated, tone: 'info', kind: 'band' },
    ],
  };
}

export function fromActive(a: ActiveCoachingSession): LessonRow | null {
  const w = when(a.createdAt);
  if (!w) return null;
  const state = a.needsAnswer
    ? COACHING_COPY.states.yourAnswer
    : a.stage === 'reflection' && a.source === 'whatsapp'
      ? COACHING_COPY.states.onWhatsApp
      : COACHING_COPY.states.analysing;
  return {
    id: a.id,
    ...w,
    title: a.topic || COACHING_COPY.newRecording,
    subject: a.subject || null,
    chips: [...subjectChip(a.subject), { text: state, tone: 'waiting', kind: 'state' }],
  };
}

/** Finished and on-the-way, newest first. A lesson in both lists as it finishes: the finished one wins. */
export function lessonRows(done: CoachingSession[], active: ActiveCoachingSession[]): LessonRow[] {
  const doneIds = new Set(done.map((s) => s.id));
  return [
    ...done.map(fromDone),
    ...active.filter((a) => !doneIds.has(a.id)).map(fromActive),
  ]
    .filter((r): r is LessonRow => r !== null)
    .sort((x, y) => y.at - x.at);
}

/** Lessons still being analysed (not waiting for her, not writing the report). */
export function analysingCount(active: ActiveCoachingSession[]): number {
  return active.filter((a) => !a.needsAnswer && a.stage !== 'reflection' && a.stage !== 'report').length;
}

/** Lessons whose question waits for her answer here, OLDEST first. */
export function waitingForHer(active: ActiveCoachingSession[]): ActiveCoachingSession[] {
  return active.filter((a) => a.needsAnswer).sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
}

/** Rows grouped under their month, in order. */
export function byMonth(rows: LessonRow[]): Array<{ key: string; label: string; rows: LessonRow[] }> {
  const groups: Array<{ key: string; label: string; rows: LessonRow[] }> = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.key === r.monthKey) last.rows.push(r);
    else groups.push({ key: r.monthKey, label: r.monthLabel, rows: [r] });
  }
  return groups;
}
