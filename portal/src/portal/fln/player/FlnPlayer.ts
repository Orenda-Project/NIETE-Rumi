import type {
  Clip,
  FlnPlayer,
  FlnPlayerDeps,
  FlnPlayerTiming,
  PlayerEvent,
  PlayerState,
  StateListener,
} from './types';

/**
 * The FLN sound player (contracts/player.md v2; AUDIO_BAR A1–A6, A12). One per plan page.
 *
 * - One sound at a time (A4): a tap stops whatever plays, then starts its clip from 0 (A5).
 * - The tap handler calls `play()` before it returns (the in-app browser only plays on a gesture) and tells the
 *   control `loading` in the same tick (A3).
 * - Warm path: `warm()` fetches clips into blob URLs, so the HTTP status is visible: a 429/5xx/network error on the
 *   mirror re-fetches `orig` at once, before any tap. The original bucket sends no CORS headers, so when that second
 *   fetch fails too the clip is marked to stream straight from `orig` on the tap.
 * - Cold tap: stream `src`; no first byte within 1.5 s → switch the SAME element to `orig` (never race two streams on
 *   a 400 kbps line). After `orig` fails, or 6 s with no `playing`, the control shows the retry state (A6).
 * - Every tap ends in one event: `audio_play` (`ok-mirror` | `ok-orig`) or `audio_error` (`error-<code>`), A12.
 */

const DEFAULT_TIMING: FlnPlayerTiming = { firstByteMs: 1500, giveUpMs: 6000, warmNow: 3, budgetBytes: 1_500_000, warmConcurrency: 2 };

type Source = 'mirror' | 'orig';
type WarmState = 'none' | 'queued' | 'loading' | 'done' | 'failed';

interface Entry {
  clip: Clip;
  el?: HTMLAudioElement;
  blobUrl?: string;
  blobSource?: Source;
  warm: WarmState;
  abort?: AbortController;
  /** The mirror already failed for this clip (warm saw a 429/5xx/404/network error): a tap goes straight to `orig`. */
  preferOrig?: boolean;
  /** A cold tap on another clip paused this fetch: it goes back to the front of the queue. */
  yielded?: boolean;
}

interface Session {
  id: string;
  owner?: string;
  el: HTMLAudioElement;
  source: Source;
  t0: number;
  gotByte: boolean;
  triedOrig: boolean;
  timers: unknown[];
  off: () => void;
}

export function createFlnPlayer(deps: FlnPlayerDeps = {}): FlnPlayer {
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const createAudio = deps.createAudio ?? (() => new Audio());
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const requestIdle = deps.requestIdle ?? defaultRequestIdle;
  const toUrl = deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
  const preconnect = deps.preconnect ?? defaultPreconnect;

  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<StateListener>>();
  const states = new Map<string, { state: PlayerState; progress: number; owner?: string }>();
  const eventListeners = new Set<(e: PlayerEvent) => void>();

  let active: Session | null = null;
  let spent = 0;
  let inflight = 0;
  const warming = new Set<Entry>();
  const origins = new Set<string>();
  let nowQueue: string[] = [];
  let idleQueue: string[] = [];
  let idleArmed = false;
  let idleOpen = false;

  function setState(id: string, state: PlayerState, progress = 0, owner?: string) {
    states.set(id, { state, progress, owner });
    listeners.get(id)?.forEach((cb) => cb(state, progress, owner));
  }

  function emit(e: PlayerEvent) {
    eventListeners.forEach((cb) => cb(e));
  }

  // ---------- warm ----------

  function canSpend(e: Entry) {
    return spent + (e.clip.bytes ?? 0) <= timing.budgetBytes;
  }

  async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob | { status: number }> {
    const res = await doFetch(url, { signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) return { status: res.status };
    return res.blob();
  }

  async function warmOne(e: Entry) {
    e.warm = 'loading';
    inflight += 1;
    warming.add(e);
    const ac = new AbortController();
    e.abort = ac;
    spent += e.clip.bytes ?? 0;
    try {
      let got: Blob | { status: number } | null = null;
      let source: Source = 'mirror';
      try {
        got = await fetchBlob(e.clip.src, ac.signal);
      } catch (err) {
        if (ac.signal.aborted) throw err;
        got = { status: 0 };
      }
      if (!(got instanceof Blob) && e.clip.orig !== e.clip.src) {
        e.preferOrig = true;
        source = 'orig';
        try {
          got = await fetchBlob(e.clip.orig, ac.signal);
        } catch (err) {
          if (ac.signal.aborted) throw err;
          got = { status: 0 };
        }
      }
      if (got instanceof Blob) {
        spent += Math.max(0, got.size - (e.clip.bytes ?? 0));
        e.blobUrl = toUrl(got);
        e.blobSource = source;
        e.warm = 'done';
      } else {
        e.warm = 'failed';
      }
    } catch {
      // Aborted: a tap took this clip over (it streams instead), a cold tap on another clip took the line, or the
      // page went away.
      spent -= e.clip.bytes ?? 0;
      if (e.yielded && e.warm === 'loading') {
        e.warm = 'queued';
        nowQueue.unshift(e.clip.id);
      } else if (e.warm === 'loading') e.warm = 'none';
      e.yielded = undefined;
    } finally {
      if (e.abort === ac) e.abort = undefined;
      warming.delete(e);
      inflight -= 1;
      pumpIdle();
    }
  }

  function armIdle() {
    if (idleArmed || idleOpen) return;
    idleArmed = true;
    requestIdle(() => {
      idleArmed = false;
      idleOpen = true;
      pumpIdle();
    });
  }

  /** A cold tap is loading over the same line: it gets the bandwidth until it plays or fails. */
  function coldTapLoading() {
    return !!active && states.get(active.id)?.state === 'loading' && !active.el.src.startsWith('blob:');
  }

  /**
   * In order, at most `warmConcurrency` at a time: on a slow line the clip a teacher taps first is whole after one
   * clip's download, not after all of them (three parallel fetches each finish at three times the cost).
   */
  function pumpIdle() {
    if (!idleOpen && idleQueue.length) armIdle();
    if (coldTapLoading()) return;
    while (inflight < timing.warmConcurrency) {
      const q = nowQueue.length ? nowQueue : idleOpen ? idleQueue : null;
      if (!q || !q.length) break;
      const id = q.shift() as string;
      const e = entries.get(id);
      if (!e || e.warm !== 'queued') continue;
      if (!canSpend(e)) {
        e.warm = 'none';
        [...nowQueue, ...idleQueue].forEach((x) => { const y = entries.get(x); if (y?.warm === 'queued') y.warm = 'none'; });
        nowQueue = [];
        idleQueue = [];
        break;
      }
      void warmOne(e);
    }
  }

  /** A cold tap pauses every other prefetch; each goes back to the front of the queue and resumes after the tap. */
  function yieldWarming(except: Entry) {
    for (const w of [...warming].reverse()) {
      if (w === except || !w.abort) continue;
      w.yielded = true;
      w.abort.abort();
    }
  }

  // ---------- play ----------

  function elementFor(e: Entry): HTMLAudioElement {
    if (!e.el) {
      const el = createAudio();
      el.preload = 'auto';
      el.loop = false;
      e.el = el;
    }
    return e.el;
  }

  function finish(s: Session) {
    s.timers.forEach((t) => clearT(t));
    s.timers = [];
    s.off();
    if (active === s) active = null;
  }

  function stopActive() {
    const s = active;
    if (!s) return;
    finish(s);
    try { s.el.pause(); } catch { /* ignore */ }
    try { s.el.currentTime = 0; } catch { /* ignore */ }
    setState(s.id, 'idle', 0);
    pumpIdle();
  }

  function fail(s: Session, code: string) {
    if (active !== s) return;
    finish(s);
    try { s.el.pause(); } catch { /* ignore */ }
    setState(s.id, 'error', 0, s.owner);
    emit({ kind: 'audio_error', clip: s.id, ms: Math.round(now() - s.t0), result: code });
    pumpIdle();
  }

  function startPlay(s: Session) {
    let p: Promise<void> | undefined;
    try {
      p = s.el.play();
    } catch (err) {
      failFromPlay(s, err);
      return;
    }
    if (p && typeof p.catch === 'function') p.catch((err) => failFromPlay(s, err));
  }

  function failFromPlay(s: Session, err: unknown) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return; // a src switch or a stop interrupted this play() call
    if (active !== s) return;
    if (name === 'NotAllowedError') { fail(s, 'error-gesture'); return; }
    onMediaError(s, 'error-play');
  }

  function switchToOrig(s: Session) {
    const e = entries.get(s.id);
    if (!e || active !== s) return;
    s.triedOrig = true;
    s.source = 'orig';
    s.gotByte = false;
    s.el.src = e.clip.orig;
    try { s.el.currentTime = 0; } catch { /* ignore */ }
    startPlay(s);
  }

  function onMediaError(s: Session, code: string) {
    if (active !== s) return;
    const e = entries.get(s.id);
    if (e && !s.triedOrig && s.source === 'mirror' && e.clip.orig !== e.clip.src) {
      e.preferOrig = true;
      switchToOrig(s);
      return;
    }
    fail(s, code);
  }

  function start(e: Entry, owner?: string) {
    const id = e.clip.id;
    const el = elementFor(e);
    const t0 = now();
    setState(id, 'loading', 0, owner);

    // A warm fetch still running for this clip: stop it and stream (the tap must not wait for a full download).
    if (e.warm === 'loading' && e.abort) e.abort.abort();
    if (!e.blobUrl) yieldWarming(e);

    let url: string;
    let source: Source;
    let fromBlob = false;
    if (e.blobUrl) {
      url = e.blobUrl;
      source = e.blobSource ?? 'mirror';
      fromBlob = true;
    } else if (e.preferOrig) {
      url = e.clip.orig;
      source = 'orig';
    } else {
      url = e.clip.src;
      source = 'mirror';
    }

    const s: Session = {
      id, owner, el, source, t0,
      gotByte: false,
      triedOrig: source === 'orig' || e.clip.orig === e.clip.src,
      timers: [],
      off: () => {},
    };

    const onByte = () => { s.gotByte = true; };
    const onPlaying = () => {
      if (active !== s) return;
      s.timers.forEach((t) => clearT(t));
      s.timers = [];
      if (states.get(id)?.state !== 'playing') {
        setState(id, 'playing', progressOf(el), owner);
        emit({ kind: 'audio_play', clip: id, ms: Math.round(now() - t0), result: s.source === 'orig' ? 'ok-orig' : 'ok-mirror' });
      }
      pumpIdle();
    };
    const onTime = () => {
      if (active === s && states.get(id)?.state === 'playing') setState(id, 'playing', progressOf(el), owner);
    };
    const onEnded = () => {
      if (active !== s) return;
      finish(s);
      setState(id, 'idle', 0);
      pumpIdle();
    };
    const onError = () => {
      const code = el.error?.code;
      if (fromBlob && s.source === (e.blobSource ?? 'mirror') && el.src.startsWith('blob:')) {
        // The cached bytes did not decode: drop them and stream.
        dropBlob(e);
        fromBlob = false;
        s.gotByte = false;
        if (s.source === 'mirror') { el.src = e.clip.src; startPlay(s); return; }
      }
      onMediaError(s, `error-media${code ?? 0}`);
    };
    const byteEvents = ['loadedmetadata', 'loadeddata', 'progress', 'canplay'] as const;
    byteEvents.forEach((n) => el.addEventListener(n, onByte));
    el.addEventListener('playing', onPlaying);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    s.off = () => {
      byteEvents.forEach((n) => el.removeEventListener(n, onByte));
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
    active = s;

    el.loop = false;
    if (el.src !== url) el.src = url;
    try { el.currentTime = 0; } catch { /* not seekable yet: it starts at 0 anyway */ }
    startPlay(s);

    if (!fromBlob && !s.triedOrig) {
      s.timers.push(setT(() => {
        if (active === s && !s.gotByte && s.source === 'mirror' && states.get(id)?.state === 'loading') switchToOrig(s);
      }, timing.firstByteMs));
    }
    s.timers.push(setT(() => {
      if (active === s && states.get(id)?.state !== 'playing') fail(s, 'error-timeout');
    }, timing.giveUpMs));
  }

  function dropBlob(e: Entry) {
    if (e.blobUrl) revokeUrl(e.blobUrl);
    e.blobUrl = undefined;
    e.blobSource = undefined;
    if (e.warm === 'done') e.warm = 'failed';
  }

  return {
    register(clips) {
      for (const clip of clips) {
        if (!clip || !clip.id || entries.has(clip.id)) continue;
        entries.set(clip.id, { clip, warm: 'none' });
        // Open the connection to the mirror while the teacher reads: on a 300 ms line the handshake is most of a
        // cold tap.
        const origin = originOf(clip.src);
        if (origin && !origins.has(origin)) {
          origins.add(origin);
          try { preconnect(origin); } catch { /* a hint only */ }
        }
      }
    },

    warm(ids) {
      let immediate = 0;
      for (const id of ids) {
        const e = entries.get(id);
        if (!e || e.blobUrl || e.warm !== 'none') continue;
        e.warm = 'queued';
        if (immediate < timing.warmNow) {
          immediate += 1;
          nowQueue.push(id);
        } else {
          idleQueue.push(id);
        }
      }
      pumpIdle();
    },

    toggle(id, owner) {
      const e = entries.get(id);
      if (!e) return;
      const cur = states.get(id)?.state ?? 'idle';
      if (active && active.id === id && (cur === 'playing' || cur === 'loading') && active.owner === owner) {
        stopActive();
        return;
      }
      stopActive();
      // An error means the original failed too, so preferring it is unproven: a retry walks mirror → orig again.
      if (cur === 'error') e.preferOrig = undefined;
      start(e, owner);
    },

    stopAll() {
      stopActive();
    },

    subscribe(id, cb) {
      let set = listeners.get(id);
      if (!set) { set = new Set(); listeners.set(id, set); }
      set.add(cb);
      const cur = states.get(id);
      cb(cur?.state ?? 'idle', cur?.progress ?? 0, cur?.owner);
      return () => { set?.delete(cb); };
    },

    onEvent(cb) {
      eventListeners.add(cb);
      return () => { eventListeners.delete(cb); };
    },

    dispose() {
      stopActive();
      nowQueue = [];
      idleQueue = [];
      for (const e of entries.values()) {
        e.abort?.abort();
        dropBlob(e);
        e.warm = 'none';
        e.preferOrig = undefined;
      }
      spent = 0;
    },
  };
}

function progressOf(el: HTMLAudioElement): number {
  const d = el.duration;
  if (!d || !Number.isFinite(d)) return 0;
  return Math.min(1, Math.max(0, el.currentTime / d));
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Two hints: the <audio> element's connection pool (credentialed) and fetch()'s (anonymous) are separate. */
function defaultPreconnect(origin: string) {
  if (typeof document === 'undefined' || !document.head) return;
  for (const cors of [false, true]) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    if (cors) link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

function defaultRequestIdle(fn: () => void) {
  const w = typeof window !== 'undefined' ? (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }) : undefined;
  if (w?.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 300);
}
