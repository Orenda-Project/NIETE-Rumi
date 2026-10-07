/**
 * bd-k23p38 — her recent lesson plans, for the Lesson Plans page (the old look and the new).
 *
 * "The page should show her last 10 lesson plans opened. it can be 1-12, any." … "on whatsapp
 * too." (operator, 7 Oct 2026). It replaced "My lesson plans", which listed only the grades 6-12
 * lessons she had asked for here, as if they were a different product.
 *
 * TWO SOURCES, ONE LIST
 *   GET /lesson-plans/recent  the plans she USED, both grade bands: opened in the portal or sent on
 *                             WhatsApp (dashboard lp-activity.service, bd-5rz1v.15).
 *   GET /lp612/mine           the grades 6-12 plans she ASKED FOR here. Writing one takes ~3
 *                             minutes and she will leave. A plan still being written, or written
 *                             while she was away and never opened, is in neither recent ledger (an
 *                             open is recorded when the PDF goes out), so without this source the
 *                             plan we paid to write is lost to her. Here it is just a row:
 *                             Preparing (first), or Ready.
 * The two meet here and not on the server so that the recent ledger keeps meaning "used": Home's
 * count and Coaching's pick list read the same endpoint, and a plan she only asked for is neither.
 *
 * Opening one is the same for every grade (useRecentLessonPlans().open): a grades 1-5 plan opens;
 * a grades 6-12 plan is asked for in its language (POST /lp612/request) and opens when it is
 * written — at once if it already is, otherwise the row says Preparing and it opens by itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useLessonPlanOpener, type OpenOptions } from './lessonPlanOpen';

export const RECENT_LIMIT = 10;

/** A write still "authoring" after this long is not coming (p90 is ~5 minutes): it is left out
 *  rather than shown as Preparing for ever. */
export const PREPARING_AT_MOST_MS = 30 * 60_000;

/** How she last had it. */
export type RecentTag = 'opened' | 'whatsapp' | 'ready' | 'preparing';

export type RecentOpen =
  | { lane: 'k5'; lessonId: string }
  | { lane: 'g612'; segmentId: string; lang: string; renderId: string | null };

export type RecentLessonPlan = {
  /** `k5:<lesson_id>` or `g612:<segment_id>:<lang>` — the same lesson in Urdu is another plan. */
  key: string;
  title: string | null;
  grade: number | null;
  subject: string | null;
  chapterTitle: string | null;
  dayLabel: string | null;
  tag: RecentTag;
  /** When that happened (ISO), or null. */
  at: string | null;
  /** The catalogue still has it; a plan it has withdrawn is listed but cannot be opened. */
  found: boolean;
  open: RecentOpen;
};

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const newestFirst = (a: RecentLessonPlan, b: RecentLessonPlan) => (time(b.at) ?? 0) - (time(a.at) ?? 0);

const keyOf = (o: RecentOpen) => (o.lane === 'k5' ? `k5:${o.lessonId}` : `g612:${o.segmentId}:${o.lang}`);

/** A plan she used (GET /lesson-plans/recent), tagged by whichever way she had it last. */
function usedPlan(r: Row): RecentLessonPlan | null {
  const o = (r.open && typeof r.open === 'object' ? r.open : {}) as Row;
  let open: RecentOpen;
  if (r.kind === 'k5') {
    const lessonId = str(r.lessonId) ?? str(o.lessonId);
    if (!lessonId) return null;
    open = { lane: 'k5', lessonId };
  } else if (r.kind === 'g612') {
    const segmentId = str(r.segmentId) ?? str(o.segmentId);
    if (!segmentId) return null;
    open = { lane: 'g612', segmentId, lang: str(r.lang) ?? str(o.lang) ?? 'en', renderId: null };
  } else {
    return null;
  }
  const opened = time(r.lastOpenedAt);
  const received = time(r.lastReceivedAt);
  const whatsapp = received !== null && (opened === null || received > opened);
  return {
    key: keyOf(open),
    title: str(r.title),
    grade: num(r.grade),
    subject: str(r.subject),
    chapterTitle: str(r.chapterTitle),
    dayLabel: str(r.dayLabel),
    tag: whatsapp ? 'whatsapp' : 'opened',
    at: whatsapp ? str(r.lastReceivedAt) : (str(r.lastOpenedAt) ?? str(r.lastUsedAt)),
    found: r.found !== false,
    open,
  };
}

/** A grades 6-12 plan she asked for here (GET /lp612/mine): being written, or written. */
function askedPlan(r: Row, now: number): RecentLessonPlan | null {
  const segmentId = str(r.segmentId);
  const renderId = str(r.renderId);
  if (!segmentId || !renderId) return null;
  let tag: RecentTag;
  let at: string | null;
  if (r.state === 'authoring') {
    const started = time(r.startedAt);
    if (started === null || now - started > PREPARING_AT_MOST_MS) return null;
    tag = 'preparing';
    at = str(r.startedAt);
  } else if (r.state === 'ready') {
    tag = 'ready';
    at = str(r.completedAt) ?? str(r.startedAt);
  } else {
    return null; // failed: she can ask again from the picker
  }
  const open: RecentOpen = { lane: 'g612', segmentId, lang: str(r.lang) ?? 'en', renderId };
  return {
    key: keyOf(open),
    title: str(r.title),
    grade: num(r.grade),
    subject: str(r.subject),
    chapterTitle: null,
    dayLabel: null,
    tag,
    at,
    found: true,
    open,
  };
}

/**
 * The list: what she used, plus what she asked for that is not among it (the newest render of a
 * lesson asked for twice); one being written first, then newest first; at most RECENT_LIMIT.
 */
export function mergeRecent(used: Row[], asked: Row[], now: number = Date.now()): RecentLessonPlan[] {
  const list = used.map(usedPlan).filter((p): p is RecentLessonPlan => p !== null);
  const seen = new Set(list.map((p) => p.key));
  const askedPlans = asked
    .map((r) => askedPlan(r, now))
    .filter((p): p is RecentLessonPlan => p !== null)
    .sort(newestFirst);
  for (const p of askedPlans) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    list.push(p);
  }
  const preparing = list.filter((p) => p.tag === 'preparing').sort(newestFirst);
  const rest = list.filter((p) => p.tag !== 'preparing').sort(newestFirst);
  return [...preparing, ...rest].slice(0, RECENT_LIMIT);
}

/** Both sources. The recent list failing is a failure; /lp612/mine failing only loses its rows. */
export async function loadRecentLessonPlans(now?: number): Promise<RecentLessonPlan[]> {
  const [used, asked] = await Promise.allSettled([
    api.get('/lesson-plans/recent', { params: { limit: RECENT_LIMIT } }),
    api.get('/lp612/mine'),
  ]);
  if (used.status === 'rejected') throw used.reason;
  const plans = (used.value?.data?.plans || []) as Row[];
  const mine = asked.status === 'fulfilled' ? ((asked.value?.data?.lessons || []) as Row[]) : [];
  return mergeRecent(plans, mine, now ?? Date.now());
}

/* ── "2h ago" ─────────────────────────────────────────────────────────────── */

export type WhenWords = {
  justNow: string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  yesterday: string;
  /** Sunday first. */
  weekdays: readonly string[];
  months: readonly string[];
};

export const WHEN_WORDS: WhenWords = {
  justNow: 'Just now',
  minutesAgo: (n) => `${n}m ago`,
  hoursAgo: (n) => `${n}h ago`,
  yesterday: 'Yesterday',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Pakistan is UTC+5 all year. */
const PK = 5 * HOUR;
const pkDay = (ms: number) => Math.floor((ms + PK) / DAY);

/** When, as a teacher says it, in Pakistan time: Just now · 5m ago · 3h ago · Yesterday · Mon · 27 Sep. */
export function whenLabel(iso: string | null | undefined, now: number = Date.now(), words: WhenWords = WHEN_WORDS): string | null {
  const t = time(iso);
  if (t === null) return null;
  const ago = Math.max(0, now - t);
  if (ago < MINUTE) return words.justNow;
  if (ago < HOUR) return words.minutesAgo(Math.floor(ago / MINUTE));
  const days = pkDay(now) - pkDay(t);
  if (days <= 0) return words.hoursAgo(Math.floor(ago / HOUR));
  if (days === 1) return words.yesterday;
  const d = new Date(t + PK);
  if (days < 7) return words.weekdays[d.getUTCDay()];
  return `${d.getUTCDate()} ${words.months[d.getUTCMonth()]}`;
}

/* ── the hook both pages use ──────────────────────────────────────────────── */

/** What went wrong opening one, for the page to say in its own words. */
export type RecentProblem = 'not_ready' | 'failed' | 'error';

type ListState = { status: 'loading' | 'ok' | 'error'; plans: RecentLessonPlan[] };

/** While a plan she did not tap is being written, look again this often to see it land. */
const RELOAD_WHILE_PREPARING_MS = 30_000;

/**
 * Her recent plans, and one way to open any of them. `refreshKey`: bump it when the list could
 * have changed (she just asked for a plan from the picker).
 */
export function useRecentLessonPlans({ refreshKey = 0, fallbackTitle = 'Lesson plan', onProblem }: {
  refreshKey?: number;
  fallbackTitle?: string;
  onProblem?: (problem: RecentProblem) => void;
} = {}) {
  const openPlan = useLessonPlanOpener();
  const [state, setState] = useState<ListState>({ status: 'loading', plans: [] });
  const [reload, setReload] = useState(0);
  // Plans she tapped that are being written now (key → render): Preparing until they open.
  const [waiting, setWaiting] = useState<Record<string, string>>({});
  const live = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const problem = useRef(onProblem);
  problem.current = onProblem;

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
  }, []);

  useEffect(() => {
    live.current = true;
    const pending = timers.current;
    return () => {
      live.current = false;
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRecentLessonPlans().then(
      (plans) => { if (!cancelled) setState({ status: 'ok', plans }); },
      // A list that loaded once stays up through a failed reload; one that never loaded is no list.
      () => { if (!cancelled) setState((s) => (s.status === 'ok' ? s : { status: 'error', plans: [] })); },
    );
    return () => { cancelled = true; };
  }, [refreshKey, reload]);

  // A plan being written that she did not tap: look again until it lands as Ready.
  const quietlyPreparing = state.plans.some((p) => p.tag === 'preparing' && !waiting[p.key]);
  useEffect(() => {
    if (!quietlyPreparing) return undefined;
    const id = setTimeout(() => setReload((n) => n + 1), RELOAD_WHILE_PREPARING_MS);
    return () => clearTimeout(id);
  }, [quietlyPreparing, state.plans]);

  const stopWaiting = useCallback((key: string) => {
    setWaiting((w) => {
      const next = { ...w };
      delete next[key];
      return next;
    });
  }, []);

  /** Poll one write to the end with the Curriculum page's back-off; open it when it is ready. */
  const waitFor = useCallback((key: string, renderId: string, title: string, opts?: OpenOptions) => {
    setWaiting((w) => ({ ...w, [key]: renderId }));
    const started = Date.now();
    const tick = async () => {
      if (!live.current) return;
      try {
        const { data } = await api.get(`/lp612/status/${encodeURIComponent(renderId)}`);
        if (!live.current) return;
        if (data?.state === 'ready') {
          stopWaiting(key);
          const how = await openPlan({ lane: 'g612', renderId }, title, opts);
          if (how === 'not_ready') problem.current?.('not_ready');
          return;
        }
        if (data?.state === 'failed') {
          stopWaiting(key);
          problem.current?.('failed');
          return;
        }
      } catch {
        // A dropped poll is not a failed write: the job runs on a worker either way. Keep asking.
      }
      const waited = Date.now() - started;
      later(() => { void tick(); }, waited < 30_000 ? 3_000 : waited < 120_000 ? 6_000 : 12_000);
    };
    later(() => { void tick(); }, 3_000);
  }, [later, openPlan, stopWaiting]);

  const open = useCallback(async (plan: RecentLessonPlan, opts?: OpenOptions) => {
    const title = plan.title || fallbackTitle;
    try {
      if (plan.open.lane === 'k5') {
        const how = await openPlan({ lane: 'k5', lessonId: plan.open.lessonId, assetKind: 'lesson' }, title, opts);
        if (how === 'not_ready') problem.current?.('not_ready');
        return;
      }
      const { segmentId, lang, renderId } = plan.open;
      if (waiting[plan.key]) return; // already on its way; it opens by itself
      if (renderId && plan.tag === 'preparing') { waitFor(plan.key, renderId, title, opts); return; }
      if (renderId && plan.tag === 'ready') {
        const how = await openPlan({ lane: 'g612', renderId }, title, opts);
        if (how === 'not_ready') problem.current?.('not_ready');
        return;
      }
      const { data } = await api.post('/lp612/request', { segment_id: segmentId, lang });
      if (data?.state === 'ready' && data.renderId) {
        const how = await openPlan({ lane: 'g612', renderId: data.renderId }, title, opts);
        if (how === 'not_ready') problem.current?.('not_ready');
        return;
      }
      if (data?.renderId) { waitFor(plan.key, data.renderId, title, opts); return; }
      problem.current?.('error');
    } catch {
      problem.current?.('error');
    }
  }, [fallbackTitle, openPlan, waitFor, waiting]);

  const plans = state.plans.map((p) => (waiting[p.key] && p.tag !== 'preparing' ? { ...p, tag: 'preparing' as const } : p));
  return { status: state.status, plans, open };
}
