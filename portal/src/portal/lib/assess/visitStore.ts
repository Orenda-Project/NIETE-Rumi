import type { SaList, SaOutcome } from '../../types/childTestSa';
import { isBlock, type Block } from './blocks';

/**
 * What this phone remembers about one Learning assessment visit, under
 * `assess:<schoolId>:<PKT date>`: when the first child was marked present, the
 * last list the server gave (shown when offline), the children finished here,
 * the outcomes marked here, each child's phone-minted session id and block, and
 * the outcomes still waiting to reach the server, the pre-flight check and the
 * children sent to another phone. A convenience only — the server is the record,
 * and storage that throws or is empty changes nothing but the convenience.
 */

export const VISIT_LIMIT_MS = 45 * 60 * 1000;

export type VisitMemory = {
  startedAt: number | null;
  list: SaList | null;
  /** drawId → sessionId, for children the coach finished on this phone. */
  finished: Record<string, string>;
  /** drawId → sessionId, for children the coach ended early (not done; their rows still go). */
  stopped?: Record<string, string>;
  /** drawId → what was marked, with the name the coach saw (for the summary). */
  outcomes: Record<string, { outcome: SaOutcome; name: string }>;
  /**
   * drawId → the session id minted on this phone, the child's block, whether Present was sent or queued, the server's
   * id once known, and noMic when the coach chose to go on without a microphone (sa_mic_required).
   */
  sessions: Record<string, { id: string; block: Block; sent: boolean; serverId?: string; noMic?: boolean; restart?: boolean }>;
  /** Outcomes not yet accepted by the server, oldest first. */
  queue: QueuedOutcome[];
  /** Queued outcomes the server turned down (kept for the record). */
  refused: Array<{ qid: string; drawId: string; outcome: SaOutcome; status: number; at: number }>;
  /** When the coach finished the pre-flight card, and the microphone check if one was run. */
  preflight: { at: number; mic: MicCheck | null } | null;
  /** drawId → the server session id, for children whose test was opened on another phone. */
  elsewhere: Record<string, string>;
};

export type MicCheck = { mic_ok: boolean; mic_rms: number; at: number };

/** The engine reads the last microphone check from here. */
export const MIC_KEY = 'sa:mic_ok';

export function saveMic(m: MicCheck): void {
  try { window.localStorage.setItem(MIC_KEY, JSON.stringify(m)); } catch { /* per-device convenience only */ }
}

/** A check from an earlier visit must not ride into this one's batches. */
export function clearMic(): void {
  try { window.localStorage.removeItem(MIC_KEY); } catch { /* per-device convenience only */ }
}

export type QueuedOutcome = {
  qid: string;
  schoolId: string;
  visitId: string | null;
  drawId: string;
  outcome: SaOutcome;
  clientSessionId?: string;
  block?: Block;
  /** sa_all_grades: the grade of the list the outcome belongs to */
  grade?: number;
  at: number;
};

const EMPTY: VisitMemory = { startedAt: null, list: null, finished: {}, stopped: {}, outcomes: {}, sessions: {}, queue: [], refused: [], preflight: null, elsewhere: {} };
const PREFIX = 'assess:';

/** Today's date in Pakistan, YYYY-MM-DD. */
export function pktDate(now = new Date()): string {
  try { return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }); } catch { return now.toISOString().slice(0, 10); }
}

export function visitKey(schoolId: string, now = new Date(), grade?: number): string {
  return `${PREFIX}${schoolId}:${pktDate(now)}${grade ? `:g${grade}` : ''}`;
}

export function readVisit(key: string): VisitMemory {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...EMPTY, sessions: {}, queue: [], refused: [], elsewhere: {} };
    const v = JSON.parse(raw) as Partial<VisitMemory>;
    return {
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : null,
      list: v.list ?? null,
      finished: v.finished && typeof v.finished === 'object' ? v.finished : {},
      stopped: v.stopped && typeof v.stopped === 'object' ? v.stopped : {},
      outcomes: v.outcomes && typeof v.outcomes === 'object' ? v.outcomes : {},
      sessions: v.sessions && typeof v.sessions === 'object'
        ? Object.fromEntries(Object.entries(v.sessions).filter(([, x]) => x && typeof x.id === 'string' && isBlock(x.block)))
        : {},
      queue: Array.isArray(v.queue) ? v.queue.filter((q) => q && typeof q.qid === 'string') : [],
      refused: Array.isArray(v.refused) ? v.refused : [],
      preflight: v.preflight && typeof v.preflight.at === 'number' ? { at: v.preflight.at, mic: v.preflight.mic ?? null } : null,
      elsewhere: v.elsewhere && typeof v.elsewhere === 'object' ? v.elsewhere : {},
    };
  } catch {
    return { ...EMPTY, sessions: {}, queue: [], refused: [], elsewhere: {} };
  }
}

export function writeVisit(key: string, v: VisitMemory): void {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* per-device convenience only */ }
}

/** Every visit this phone has kept (for sending what is still queued). */
export function allVisitKeys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

/** A v4 uuid, minted on the phone. */
export function mintId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall back */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 0 → "00:00"; over an hour stays in minutes ("72:05"). */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
