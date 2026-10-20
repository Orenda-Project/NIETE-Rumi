import type { SaList, SaOutcome } from '../../types/childTestSa';

/**
 * What this phone remembers about one Learning assessment visit, under
 * `assess:<schoolId>:<PKT date>`: when the first child was marked present, the
 * last list the server gave (shown when offline), the children finished here
 * and the outcomes marked here. A convenience only — the server is the record,
 * and storage that throws or is empty changes nothing but the convenience.
 */

export const VISIT_LIMIT_MS = 45 * 60 * 1000;

export type VisitMemory = {
  startedAt: number | null;
  list: SaList | null;
  /** drawId → sessionId, for children the coach finished on this phone. */
  finished: Record<string, string>;
  /** drawId → what was marked, with the name the coach saw (for the summary). */
  outcomes: Record<string, { outcome: SaOutcome; name: string }>;
};

const EMPTY: VisitMemory = { startedAt: null, list: null, finished: {}, outcomes: {} };

/** Today's date in Pakistan, YYYY-MM-DD. */
export function pktDate(now = new Date()): string {
  try { return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }); } catch { return now.toISOString().slice(0, 10); }
}

export function visitKey(schoolId: string, now = new Date()): string {
  return `assess:${schoolId}:${pktDate(now)}`;
}

export function readVisit(key: string): VisitMemory {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...EMPTY };
    const v = JSON.parse(raw) as Partial<VisitMemory>;
    return {
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : null,
      list: v.list ?? null,
      finished: v.finished && typeof v.finished === 'object' ? v.finished : {},
      outcomes: v.outcomes && typeof v.outcomes === 'object' ? v.outcomes : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeVisit(key: string, v: VisitMemory): void {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* per-device convenience only */ }
}

/** 0 → "00:00"; over an hour stays in minutes ("72:05"). */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
