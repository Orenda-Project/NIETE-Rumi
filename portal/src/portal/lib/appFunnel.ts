import { normaliseRoute, shouldTrack } from '@/lib/funnel-route.cjs';
import { browserEnv, getApiBaseUrl } from '@/lib/runtime';
import type { BrowserEnv } from '@/lib/runtime';

/**
 * bd-4r3rei — where she is in the app, reported to the portal so a drop-off has a last page.
 *
 * WHAT IT SENDS, and nothing else: the page's shape ('/portal/teacher/lessons', never an id or a query), that she
 * arrived / left / came back, how long she was looking (time hidden does not count), and whether this is the native
 * app. Which browser it is (WhatsApp's, another app's, Chrome) is the SERVER's call from the user agent. Who she is, and which WhatsApp message sent her, are the SERVER's
 * to say — from her session (dashboard/routes/app-funnel.routes.js) — so this file carries no user, no journey, no
 * token, and nothing a screen shows.
 *
 * INVISIBLE AND SAFE. Fire-and-forget: nothing awaits it, nothing it does can throw into a page, a failed or refused
 * send is dropped, a 401 (signed out) or 429 pauses it. Batched (5 s, or 10 events); flushed with `sendBeacon` the
 * moment the page is hidden or closed — WhatsApp's browser gives a page no other chance. The beacon body is
 * `text/plain`, which is not CORS-preflighted, so it also works from the Android app's `https://localhost` origin.
 */
export { normaliseRoute, shouldTrack };

type Kind = 'view' | 'leave' | 'resume';
type Queued = { k: Kind; r: string; pr?: string | null; d?: number; why?: string; at: number };

export interface FunnelDeps {
  endpoint: string;
  browser: BrowserEnv;
  now: () => number;
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetchFn: (url: string, init: RequestInit) => Promise<Pick<Response, 'status'>>;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
}

const FLUSH_AFTER_MS = 5000;
const FLUSH_AT = 10;
const QUEUE_CAP = 100;
const PAUSE_SIGNED_OUT_MS = 5 * 60 * 1000;
const PAUSE_THROTTLED_MS = 60 * 1000;
const TEXT_PLAIN = 'text/plain;charset=UTF-8';

export function createAppFunnel(deps: FunnelDeps) {
  let queue: Queued[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pausedUntil = 0;
  let lastRoute: string | null = null;
  let current: { route: string; shownAt: number; hidden: boolean } | null = null;

  const safe = <T,>(fn: () => T): T | undefined => { try { return fn(); } catch { return undefined; } };

  function enqueue(ev: Omit<Queued, 'at'>) {
    const now = deps.now();
    if (now < pausedUntil) return; // signed out / throttled: nobody is listening
    queue.push({ ...ev, at: now });
    if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP);
    if (queue.length >= FLUSH_AT) flush(false);
    else if (!timer) timer = deps.setTimer(() => { timer = null; flush(false); }, FLUSH_AFTER_MS);
  }

  function pause(ms: number) { pausedUntil = deps.now() + ms; queue = []; }

  function flush(final: boolean) {
    safe(() => {
      if (timer) { deps.clearTimer(timer); timer = null; }
      if (queue.length === 0) return;
      const now = deps.now();
      if (now < pausedUntil) { queue = []; return; }
      const batch = queue; queue = [];
      const body = JSON.stringify({
        v: 1,
        b: deps.browser,
        ev: batch.map(({ at, ...e }) => ({ ...e, age: now - at })),
      });
      if (final && deps.sendBeacon) {
        const ok = safe(() => deps.sendBeacon!(deps.endpoint, new Blob([body], { type: TEXT_PLAIN })));
        if (ok) return;
      }
      const p = safe(() => deps.fetchFn(deps.endpoint, {
        method: 'POST', body, headers: { 'Content-Type': TEXT_PLAIN }, credentials: 'include', keepalive: true,
      }));
      if (p && typeof p.then === 'function') {
        p.then((res) => {
          if (res && (res.status === 401 || res.status === 403)) pause(PAUSE_SIGNED_OUT_MS);
          else if (res && res.status === 429) pause(PAUSE_THROTTLED_MS);
        }).catch(() => { /* offline or refused: dropped */ });
      }
    });
  }

  /** The visit to `current` ends (she moved on, or it was hidden): one leave, with the time she was looking. */
  function close(why: 'nav' | 'hidden' | 'pagehide') {
    if (!current) return;
    if (!current.hidden) enqueue({ k: 'leave', r: current.route, d: deps.now() - current.shownAt, why });
    lastRoute = current.route;
  }

  return {
    /** The router moved (or the app opened on) `path`. */
    view(path: string) {
      safe(() => {
        const route: string | null = shouldTrack(path) ? normaliseRoute(path) : null;
        if (current && route === current.route) return; // the same page with a different query
        if (current) { close('nav'); current = null; }
        if (!route) return;
        enqueue({ k: 'view', r: route, pr: lastRoute });
        current = { route, shownAt: deps.now(), hidden: false };
      });
    },
    /** The page went to the background or is closing. Flushes at once: this may be the last chance. */
    hidden(why: 'hidden' | 'pagehide') {
      safe(() => {
        if (current && !current.hidden) {
          enqueue({ k: 'leave', r: current.route, d: deps.now() - current.shownAt, why });
          current.hidden = true;
        }
        flush(true);
      });
    },
    /** She is back on the page (visible again, or restored from the back-forward cache). */
    visible() {
      safe(() => {
        if (!current || !current.hidden) return;
        current.hidden = false;
        current.shownAt = deps.now();
        enqueue({ k: 'resume', r: current.route });
      });
    },
    flush() { flush(false); },
    _queueLength() { return queue.length; },
  };
}

export type AppFunnel = ReturnType<typeof createAppFunnel>;

let singleton: AppFunnel | null = null;

/** The one funnel for this page load. A no-op when the API address cannot be worked out (never a throw). */
export function getAppFunnel(): AppFunnel {
  if (singleton) return singleton;
  let endpoint: string | null = null;
  try { endpoint = `${getApiBaseUrl()}/funnel/events`; } catch { endpoint = null; }
  if (!endpoint || typeof window === 'undefined') {
    singleton = createAppFunnel({
      endpoint: '', browser: 'browser', now: Date.now, fetchFn: async () => ({ status: 204 }),
      setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => {},
    });
    // Nothing to send to: every call is a no-op because the queue is never flushed to a real endpoint.
    return singleton;
  }
  singleton = createAppFunnel({
    endpoint,
    browser: browserEnv(),
    now: () => Date.now(),
    sendBeacon: typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : undefined,
    fetchFn: (url, init) => fetch(url, init),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
  });
  return singleton;
}
