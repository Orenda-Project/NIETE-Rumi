import { portal } from '../../services/api';
import type { AssessmentSpec } from '../../services/api';
import { lessonPlans, type LpLesson } from '../../newui/lessons/lessonPlansApi';
import {
  FAST_POLL_MS, SLOW_AFTER_MS, SLOW_POLL_MS, itemId, oldestFirst,
  type NewNotice, type NoticeItem,
} from './model';

/**
 * bd-fmf24g.15 — the shell-level job tracker (COMPONENTS.md §12, "One poll for the tray, app-wide").
 *
 * WHY IT IS HERE AND NOT IN A PAGE
 * --------------------------------
 * A paper was followed only on the Assessment pages (usePaperJobs) and a grades 6–12 plan only on its Preparing
 * page, so a teacher who left either heard nothing. This follows every such job on whatever screen she is on.
 * It is a module, not a hook: every teacher page draws its own frame, so the screen that hosts the strip is
 * rebuilt on each tap, and the polling must not start over each time.
 *
 * WHAT IT DOES
 *   track     a job she has just asked for becomes a "making" item;
 *   poll      the same two routes the pages poll (GET /assessment/status/:id, GET /lp612/status/:id) — every 4 s,
 *             every 15 s after 3 minutes, never while the tab is hidden, at once when it is shown again.
 *             A dropped poll is not a failed job (the work runs on a worker whether or not this phone can reach
 *             us), so it keeps asking;
 *   settle    she has seen it (the banner's Open or ✕, or its own page showing it): the item is removed;
 *   announced the banner has finished: a ready item is removed, a failed one stays in the strip until she taps it;
 *   retry     Try again sends the SAME request again, and follows the new one.
 *
 * KEPT for her, in this browser (localStorage, her phone number in the key), so a refresh or a closed app does
 * not lose what she is waiting for. Every read and write is in try/catch: a blocked or full store never breaks it.
 *
 * Nothing here knows about screens or words: the host (NoticeHost) draws, this only follows.
 */

const STORE_PREFIX = 'teacher-notices:v1';
export const noticesStorageKey = (userKey: string) => `${STORE_PREFIX}:${userKey}`;
/** A screen that detaches and another that attaches in the same moment (a page change) must not stop the polling. */
const DETACH_GRACE_MS = 1_000;

export type RetryResult = { ok: true } | { ok: false; error: string };

export interface Tracker {
  getItems(): readonly NoticeItem[];
  subscribe(listener: () => void): () => void;
  /** A screen is showing the shell for `userKey`. Returns its detach. */
  attach(userKey: string): () => void;
  track(job: NewNotice): void;
  settle(id: string): void;
  announced(ids: readonly string[]): void;
  retry(id: string): Promise<RetryResult>;
  /** Tests: forget everything, stop everything. */
  reset(): void;
}

const messageOf = (err: unknown) => (err as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

function readStored(userKey: string): NoticeItem[] {
  try {
    const raw = localStorage.getItem(noticesStorageKey(userKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((i): i is NoticeItem => !!i && typeof i === 'object'
      && typeof (i as NoticeItem).id === 'string'
      && ((i as NoticeItem).kind === 'paper' || (i as NoticeItem).kind === 'lesson')
      && ['making', 'ready', 'failed'].includes((i as NoticeItem).state)
      && typeof (i as NoticeItem).startedAt === 'number'
      && typeof (i as NoticeItem).waitHref === 'string');
  } catch {
    return [];
  }
}

function writeStored(userKey: string | null, items: readonly NoticeItem[]): void {
  if (!userKey) return;
  try {
    localStorage.setItem(noticesStorageKey(userKey), JSON.stringify(items));
  } catch {
    /* storage is a convenience: what is in memory is what the screen shows */
  }
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function createTracker(): Tracker {
  let items: readonly NoticeItem[] = [];
  let userKey: string | null = null;
  let screens = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const listeners = new Set<() => void>();

  const commit = (next: readonly NoticeItem[]) => {
    items = next;
    writeStored(userKey, items);
    listeners.forEach((l) => l());
  };

  const patch = (id: string, change: Partial<NoticeItem>) => {
    if (!items.some((i) => i.id === id)) return;
    commit(items.map((i) => (i.id === id ? { ...i, ...change } : i)));
  };

  const making = () => items.filter((i) => i.state === 'making');

  async function pollOne(item: NoticeItem): Promise<void> {
    try {
      if (item.kind === 'paper' && item.requestId) {
        const res = await portal.getAssessmentStatus(item.requestId);
        if (res.status === 'ready' && res.paperId) patch(item.id, { state: 'ready', paperId: res.paperId, readyAt: Date.now() });
        else if (res.status === 'failed' || res.status === 'not_found') {
          patch(item.id, { state: 'failed', errorCode: res.status === 'failed' ? (res.errorCode ?? null) : null });
        }
        return;
      }
      if (item.kind === 'lesson' && item.renderId) {
        // lessonPlans.status: a 404 (no such request, or not hers) is "failed"; anything else throws.
        const res = await lessonPlans.status(item.renderId);
        if (res.state === 'ready') patch(item.id, { state: 'ready', readyAt: Date.now() });
        else if (res.state === 'failed') patch(item.id, { state: 'failed' });
      }
    } catch {
      /* a dropped poll: ask again next time */
    }
  }

  const delay = () => {
    const youngest = Math.max(...making().map((i) => i.startedAt));
    return Date.now() - youngest >= SLOW_AFTER_MS ? SLOW_POLL_MS : FAST_POLL_MS;
  };

  const schedule = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!running || making().length === 0) return;
    timer = setTimeout(() => { timer = null; void tick(); }, delay());
  };

  async function tick(): Promise<void> {
    if (!running) return;
    if (!hidden()) await Promise.all(making().map(pollOne));
    schedule();
  }

  const onVisible = () => { if (running && !hidden() && making().length) void tick(); };

  const start = () => {
    if (running) return;
    running = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    schedule();
  };

  const stop = () => {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };

  function track(job: NewNotice): void {
    const id = itemId(job.kind, job.ref);
    const known = items.find((i) => i.id === id);
    if (known) {
      // Tracked twice (the page that asked, then the page it lands on): the later word on the title wins, as a
      // plan's title may only be known once the catalogue answers.
      if (job.title && known.title !== job.title) patch(id, { title: job.title });
      return;
    }
    const item: NoticeItem = {
      id,
      kind: job.kind,
      state: 'making',
      title: job.title,
      grade: job.grade,
      subject: job.subject,
      questions: job.questions,
      startedAt: Date.now(),
      readyAt: null,
      waitHref: job.waitHref,
      announced: false,
      ...(job.kind === 'paper'
        ? { requestId: job.ref, spec: job.spec, paperId: null }
        : { renderId: job.ref, lessonId: job.lessonId, lang: job.lang, at: job.at }),
    };
    commit([...items, item].sort(oldestFirst));
    schedule();
  }

  function settle(id: string): void {
    if (items.some((i) => i.id === id)) commit(items.filter((i) => i.id !== id));
  }

  function announced(ids: readonly string[]): void {
    const set = new Set(ids);
    if (!items.some((i) => set.has(i.id))) return;
    commit(items
      .filter((i) => !(set.has(i.id) && i.state === 'ready'))
      .map((i) => (set.has(i.id) ? { ...i, announced: true } : i)));
  }

  async function retry(id: string): Promise<RetryResult> {
    const old = items.find((i) => i.id === id);
    if (!old) return { ok: false, error: '' };
    try {
      if (old.kind === 'paper') {
        const res = await portal.generateAssessment(old.spec as AssessmentSpec);
        if (!res?.success || !res.requestId) return { ok: false, error: res?.error ?? '' };
        settle(id);
        track({
          kind: 'paper', ref: res.requestId, title: old.title, grade: old.grade, subject: old.subject, questions: old.questions,
          waitHref: old.waitHref.replace(old.requestId as string, res.requestId), spec: old.spec,
        });
        return { ok: true };
      }
      const r = await lessonPlans.open({ id: old.lessonId as string, lane: 'g612' } as LpLesson, old.lang);
      if (r.state === 'unavailable') return { ok: false, error: '' };
      const renderId = r.state === 'ready' ? r.source.lane === 'g612' ? r.source.renderId : '' : r.renderId;
      if (!renderId) return { ok: false, error: '' };
      settle(id);
      const wait = old.waitHref.includes('render=')
        ? old.waitHref.replace(/([?&]render=)[^&]*/, `$1${encodeURIComponent(renderId)}`)
        : old.waitHref;
      track({
        kind: 'lesson', ref: renderId, title: old.title, grade: old.grade, subject: old.subject, questions: null,
        waitHref: wait, lessonId: old.lessonId, lang: old.lang, at: old.at ? { ...old.at, render: renderId } : undefined,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: messageOf(err) ?? '' };
    }
  }

  function attach(key: string): () => void {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (userKey !== key) {
      // Jobs tracked before we knew whose they are (a page's effect runs before the shell's) are hers: keep them,
      // beside what she was already following. A different teacher on this browser starts from her own.
      const carried = userKey === null ? items : [];
      userKey = key;
      const stored = readStored(key).filter((s) => !carried.some((c) => c.id === s.id));
      commit([...stored, ...carried].sort(oldestFirst));
    }
    screens += 1;
    start();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      screens -= 1;
      if (screens > 0) return;
      graceTimer = setTimeout(() => { graceTimer = null; if (screens === 0) stop(); }, DETACH_GRACE_MS);
    };
  }

  return {
    getItems: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attach,
    track,
    settle,
    announced,
    retry,
    reset() {
      stop();
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      screens = 0;
      userKey = null;
      items = [];
      listeners.clear();
    },
  };
}

/** The one the app uses. */
export const noticeTracker: Tracker = createTracker();
