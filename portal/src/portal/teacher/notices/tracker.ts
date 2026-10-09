import { portal } from '../../services/api';
import type { AssessmentSpec } from '../../services/api';
import { lessonPlans, type LpLesson } from '../../newui/lessons/lessonPlansApi';
import {
  FAST_POLL_MS, SLOW_AFTER_MS, SLOW_POLL_MS, itemId, mergeServer, oldestFirst,
  type NewNotice, type NoticeItem, type NoticeKind, type ServerItem,
} from './model';
import { fetchNotices as fetchFromServer, reportNotice } from './serverNotices';

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
 * THE SERVER knows her items too (GET /me/notices), which is what lets a second phone — or a browser that was
 * cleared — show the same strip, and Home keep "Ready for you". `sync` folds its list in (model.mergeServer) when a
 * screen attaches (at most every 30 s) and after a banner finishes; what she does is told to it on the side
 * (`seen`: the banner finished on a ready item; `opened`: she opened it, tapped a failed one, or its own page
 * showed it). A failed sync or report is silent: the device keeps what it has.
 *
 * Nothing here knows about screens or words: the host (NoticeHost) draws, this only follows.
 */

const STORE_PREFIX = 'teacher-notices:v1';
export const noticesStorageKey = (userKey: string) => `${STORE_PREFIX}:${userKey}`;
/** The items whose ready banner has run on this device (so a refresh does not announce them again). */
export const bannerStorageKey = (userKey: string) => `teacher-notices-banner:v1:${userKey}`;
const BANNERED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
/** A screen that detaches and another that attaches in the same moment (a page change) must not stop the polling. */
const DETACH_GRACE_MS = 1_000;

export type RetryResult = { ok: true } | { ok: false; error: string };

/** What sends again a thing the tracker cannot re-ask the server for (the coach's observation: the sender holds its files). */
export type RetryHandler = (id: string) => Promise<RetryResult>;

/** An observation is sent from this phone: the server has no row for it, so nothing is asked of or told to it. */
const isLocalOnly = (id: string) => id.startsWith('observation:');

export interface TrackerDeps {
  /** Her items from the server. Defaults to GET /me/notices. */
  fetchNotices?: () => Promise<ServerItem[]>;
  /** Tell the server what she did. Defaults to POST /me/notices/:id/seen|opened. */
  report?: (id: string, what: 'seen' | 'opened') => Promise<boolean>;
}

export interface Tracker {
  getItems(): readonly NoticeItem[];
  /** Ready, unopened items still inside their 24 weekday hours, as the server last listed them (Home's card). */
  getHome(): readonly ServerItem[];
  /** Fold the server's list in. At most every 30 s unless `force`; a failed read changes nothing. */
  sync(force?: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
  /**
   * A screen is showing the shell for `userKey`. Returns its detach. `server: false` (a coach: her only item is an upload
   * sent from this phone, and the server's list is the teacher's) never asks GET /me/notices.
   */
  attach(userKey: string, opts?: { server?: boolean }): () => void;
  track(job: NewNotice): void;
  /**
   * bd-4404s7.4 — change a followed item: the coach's upload pushes its progress, then ends it ready or failed. Only
   * what the caller names changes; an unknown id is ignored.
   */
  update(id: string, change: Partial<NoticeItem>): void;
  /** Who sends `kind` again when she taps Try again (the observation's sender registers itself). */
  registerRetry(kind: NoticeKind, handler: RetryHandler): void;
  settle(id: string): void;
  /**
   * The banner for these finished. `closed` (she tapped ✕ or went to Home) means SEEN and is told to the server;
   * `expired` (it ran its 10 seconds untouched) is not: the WhatsApp fallback still treats it as unseen.
   */
  announced(ids: readonly string[], how?: 'closed' | 'expired'): void;
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
    // An observation being sent lives in this tab only (its files are not storable): never written, never read back.
    localStorage.setItem(noticesStorageKey(userKey), JSON.stringify(items.filter((i) => i.kind !== 'observation')));
  } catch {
    /* storage is a convenience: what is in memory is what the screen shows */
  }
}

type Bannered = Record<string, number>;

function readBannered(userKey: string): Bannered {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(bannerStorageKey(userKey)) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Bannered = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Date.now() - at < BANNERED_KEEP_MS) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function writeBannered(userKey: string | null, b: Bannered): void {
  if (!userKey) return;
  try {
    localStorage.setItem(bannerStorageKey(userKey), JSON.stringify(b));
  } catch {
    /* a convenience: without it a refresh may announce the same item twice */
  }
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** How often a screen attaching may ask the server (it attaches on every page change). */
const SYNC_EVERY_MS = 30_000;

export function createTracker(deps: TrackerDeps = {}): Tracker {
  const fetchNotices = deps.fetchNotices ?? fetchFromServer;
  const report = deps.report ?? reportNotice;
  let items: readonly NoticeItem[] = [];
  let home: readonly ServerItem[] = [];
  let bannered: Bannered = {};
  let lastSync = 0;
  let serverOn = true;
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

  const retryHandlers = new Map<NoticeKind, RetryHandler>();
  // What is asked of the server: an upload is pushed by its sender, never polled.
  const making = () => items.filter((i) => i.state === 'making' && i.kind !== 'observation');

  /** Tell the server on the side; never throws, never waits. */
  const tell = (id: string, what: 'seen' | 'opened'): Promise<unknown> => {
    if (isLocalOnly(id)) return Promise.resolve(false);
    try {
      return Promise.resolve(report(id, what)).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  };

  async function sync(force = false): Promise<void> {
    const key = userKey;
    if (!key || !serverOn) return;
    if (!force && Date.now() - lastSync < SYNC_EVERY_MS) return;
    lastSync = Date.now();
    let server: ServerItem[];
    try {
      server = await fetchNotices();
    } catch {
      return;
    }
    if (userKey !== key) return;
    const merged = mergeServer(items, server, Date.now(), new Set(Object.keys(bannered)));
    home = merged.home;
    // Write only what changed: a list that tells us nothing new must not touch the store.
    const same = merged.items.length === items.length && merged.items.every((m, i) => m === items[i]);
    if (same) listeners.forEach((l) => l());
    else commit(merged.items);
    schedule();
  }

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
        : job.kind === 'observation'
          ? { visitId: job.visitId ?? job.ref, visitDay: job.visitDay ?? null, durationMs: job.durationMs ?? null, progress: 0, observationId: null }
          : { renderId: job.ref, lessonId: job.lessonId, lang: job.lang, at: job.at }),
    };
    commit([...items, item].sort(oldestFirst));
    schedule();
  }

  function update(id: string, change: Partial<NoticeItem>): void {
    patch(id, change);
    schedule();
  }

  function settle(id: string): void {
    const followed = items.some((i) => i.id === id);
    const onHome = home.some((h) => h.id === id);
    if (!followed && !onHome) return;
    if (onHome) home = home.filter((h) => h.id !== id);
    if (followed) commit(items.filter((i) => i.id !== id));
    else listeners.forEach((l) => l());
    void tell(id, 'opened');
  }

  function announced(ids: readonly string[], how: 'closed' | 'expired' = 'expired'): void {
    const set = new Set(ids);
    if (!items.some((i) => set.has(i.id))) return;
    const ready = items.filter((i) => set.has(i.id) && i.state === 'ready');
    // This device remembers a banner that ran, so a refresh does not announce the same item again.
    if (ready.length) {
      const now = Date.now();
      bannered = { ...bannered };
      ready.forEach((i) => { bannered[i.id] = now; });
      writeBannered(userKey, bannered);
    }
    // Closing it with the X is SEEN (told to the server; no WhatsApp follows). A failed item is not told: she has
    // not tapped it. Running out untouched is not told either, and Home keeps it either way.
    const told = how === 'closed' ? ready.map((i) => tell(i.id, 'seen')) : [];
    // Home keeps it: ask the server for the list once it knows.
    if (ready.length) void Promise.all(told).then(() => sync(true));
    commit(items
      .filter((i) => !(set.has(i.id) && i.state === 'ready'))
      .map((i) => (set.has(i.id) ? { ...i, announced: true } : i)));
  }

  async function retry(id: string): Promise<RetryResult> {
    const old = items.find((i) => i.id === id);
    if (!old) return { ok: false, error: '' };
    const handler = retryHandlers.get(old.kind);
    if (handler) return handler(id);
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

  function attach(key: string, opts: { server?: boolean } = {}): () => void {
    serverOn = opts.server !== false;
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (userKey !== key) {
      // Jobs tracked before we knew whose they are (a page's effect runs before the shell's) are hers: keep them,
      // beside what she was already following. A different teacher on this browser starts from her own.
      const carried = userKey === null ? items : [];
      userKey = key;
      bannered = readBannered(key);
      const stored = readStored(key).filter((s) => !carried.some((c) => c.id === s.id));
      if (carried.length) {
        commit([...stored, ...carried].sort(oldestFirst));
      } else {
        // Nothing new to keep: read what she had, and write nothing.
        items = stored;
        listeners.forEach((l) => l());
      }
    }
    screens += 1;
    start();
    void sync();
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
    getHome: () => home,
    sync,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attach,
    track,
    update,
    registerRetry(kind, handler) { retryHandlers.set(kind, handler); },
    settle,
    announced,
    retry,
    reset() {
      stop();
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      screens = 0;
      userKey = null;
      items = [];
      home = [];
      bannered = {};
      lastSync = 0;
      serverOn = true;
      listeners.clear();
    },
  };
}

/** The one the app uses. */
export const noticeTracker: Tracker = createTracker();
