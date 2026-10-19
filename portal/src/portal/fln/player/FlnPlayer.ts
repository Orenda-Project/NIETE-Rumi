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
 * - Warm path: `warm()` loads each clip into its own <audio preload="auto">, in grid order; a tap on a warming clip
 *   plays from the head it already has (see the warm section for the bench numbers). A mirror error during the warm
 *   moves that element to `orig` at once, before any tap.
 * - Cold tap: stream `src`; no first byte within 2.5 s → switch the SAME element to `orig` (never race two streams on
 *   a 400 kbps line). After `orig` fails, or no `playing` and no bytes arriving, the control shows the retry state (A6):
 *   the give-up is 6 s after the tap, pushed out while bytes still arrive (stall window after the last byte, hard
 *   ceiling 20 s), so a big clip still downloading on a slow line is never called failed.
 * - Every tap ends in one event: `audio_play` (`ok-mirror` | `ok-orig`) or `audio_error` (`error-<code>`), A12.
 */

// firstByteMs: the element reports its first bytes (progress / loadedmetadata) only with the first playable frames, which
// on a 400 kbps / 300 ms line is ~1.65 s for the larger clips every time (9 of 60 fresh-connection loads, max 1,654 ms;
// bench 18 Oct). At 1.5 s those taps always fell to orig and played at ~3.4 s; 2.5 s leaves the real stall path at
// 2.5 s + orig cold, inside the 6 s give-up.
// giveUpMs / stallMs / ceilingMs (QA-A2-bigclip, 18 Oct): the RH-EN phonics clips are 192 kbps stereo, 180–240 KB, and on a
// 400 kbps / 300 ms line the tapped clip was still downloading, bytes arriving, when a flat 6 s give-up fired (22
// error-timeout in sandbox, p50 6,003 ms). The give-up is now 6 s after the tap OR stallMs after the last byte, whichever
// is later, never past ceilingMs: no "Couldn't play" while bytes arrive, and a trickle still ends.
const DEFAULT_TIMING: FlnPlayerTiming = {
  firstByteMs: 2500, giveUpMs: 6000, stallMs: 3000, ceilingMs: 20000,
  warmNow: 3, budgetBytes: 1_500_000, warmConcurrency: 2, warmStepMs: 8000,
};

type Source = 'mirror' | 'orig';
type WarmState = 'none' | 'queued' | 'loading' | 'done' | 'failed';

interface Entry {
  clip: Clip;
  el?: HTMLAudioElement;
  /** The URL last given to `el.src`, as given (the getter returns it re-encoded, so it cannot be compared). */
  url?: string;
  warm: WarmState;
  /** Detaches the warm listeners (a tap takes the element over, or the warm step ends). */
  warmOff?: () => void;
  /** The mirror already failed for this clip (the warm load errored): a tap goes straight to `orig`. */
  preferOrig?: boolean;
}

interface Session {
  id: string;
  owner?: string;
  el: HTMLAudioElement;
  source: Source;
  t0: number;
  gotByte: boolean;
  /** now() at the last byte event (progress / loadedmetadata / loadeddata / canplay) on the current source. */
  lastByteAt?: number;
  /** The tap found its warm load mid-stream with no parsed bytes yet (QA-A2-switch): counted as a first byte, unproven. */
  assumedByte?: boolean;
  /** now() when the current source's give-up window opened (the tap, or the late move to `orig`). */
  windowAt: number;
  triedOrig: boolean;
  /** Nothing of this clip was buffered at the tap: it streams over the line and the warm queue waits for it. */
  cold: boolean;
  timers: unknown[];
  off: () => void;
}

const HAVE_METADATA = 1;
const NETWORK_LOADING = 2;
const HAVE_FUTURE_DATA = 3;

export function createFlnPlayer(deps: FlnPlayerDeps = {}): FlnPlayer {
  const timing = { ...DEFAULT_TIMING, ...deps.timing };
  const createAudio = deps.createAudio ?? (() => new Audio());
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const requestIdle = deps.requestIdle ?? defaultRequestIdle;
  const preconnect = deps.preconnect ?? defaultPreconnect;

  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<StateListener>>();
  const states = new Map<string, { state: PlayerState; progress: number; owner?: string }>();
  const eventListeners = new Set<(e: PlayerEvent) => void>();

  let active: Session | null = null;
  let spent = 0;
  let inflight = 0;
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
  //
  // An <audio preload="auto"> per clip, in grid order, `warmConcurrency` at a time. The queue moves on as soon as a
  // clip can start (its head is in), not when the whole file is: a tap only needs the head, and the browser keeps
  // filling the rest. Bench 18 Oct 16:24Z: the phonics clips are ~200 KB / 12 s, so on a 400 kbps line a whole-file
  // fetch() lands one clip per 4 s while a teacher taps one per 2 s, and a tap on a half-fetched clip had to start
  // over. A tap on a warming element plays from what it has. A mirror error during the warm (429/5xx/404/network) moves
  // the element to `orig` at once.

  /**
   * A narration (47–323 s, up to 2.5 MB) warms its head only: preload=metadata, one small range, and it streams on the
   * tap. It never spends the sound budget, so it cannot hold the line against the sound tiles (voice 163503).
   */
  const isNarration = (e: Entry) => e.clip.role === 'narration';
  const cost = (e: Entry) => (isNarration(e) ? 0 : e.clip.bytes ?? 0);

  function canSpend(e: Entry) {
    return spent + cost(e) <= timing.budgetBytes;
  }

  function warmOne(e: Entry) {
    const el = elementFor(e);
    e.warm = 'loading';
    inflight += 1;
    spent += cost(e);
    const narration = isNarration(e);
    let source: Source = e.preferOrig ? 'orig' : 'mirror';
    let ended = false;
    const end = (state: WarmState) => {
      if (ended) return;
      ended = true;
      off();
      e.warm = state;
      inflight -= 1;
      pumpIdle();
    };
    const onReady = () => { if (el.readyState >= (narration ? HAVE_METADATA : HAVE_FUTURE_DATA)) end('done'); };
    const onSuspend = () => { if (el.readyState >= HAVE_METADATA) end('done'); };
    const onError = () => {
      if (source === 'mirror' && e.clip.orig !== e.clip.src) {
        source = 'orig';
        e.preferOrig = true;
        setSrc(e, el, e.clip.orig);
        el.load();
        return;
      }
      end('failed');
    };
    // A slow head must not hold the queue: after warmStepMs the next clip starts beside it.
    const step = setT(() => end(el.readyState >= HAVE_METADATA ? 'done' : 'loading'), timing.warmStepMs);
    const off = () => {
      clearT(step);
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('loadedmetadata', onReady);
      el.removeEventListener('canplaythrough', onReady);
      el.removeEventListener('suspend', onSuspend);
      el.removeEventListener('error', onError);
      if (e.warmOff === stop) e.warmOff = undefined;
    };
    const stop = () => {
      if (ended) return;
      ended = true;
      off();
      inflight -= 1;
      if (e.warm === 'loading') e.warm = 'done';
    };
    e.warmOff = stop;
    el.addEventListener('canplay', onReady);
    if (narration) el.addEventListener('loadedmetadata', onReady);
    el.addEventListener('canplaythrough', onReady);
    el.addEventListener('suspend', onSuspend);
    el.addEventListener('error', onError);
    el.preload = narration ? 'metadata' : 'auto';
    setSrc(e, el, source === 'orig' ? e.clip.orig : e.clip.src);
    el.load();
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
    return !!active && active.cold && states.get(active.id)?.state === 'loading';
  }

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
      warmOne(e);
    }
  }

  // ---------- play ----------

  function elementFor(e: Entry): HTMLAudioElement {
    if (!e.el) {
      const el = createAudio();
      el.preload = 'auto';
      el.loop = false;
      if (el.dataset) el.dataset.flnClip = e.clip.id; // the bench reads it
      e.el = el;
    }
    return e.el;
  }

  function setSrc(e: Entry, el: HTMLAudioElement, url: string) {
    e.url = url;
    el.src = url;
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
    s.lastByteAt = undefined;
    setSrc(e, s.el, e.clip.orig);
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

    // The tap takes the element over from its warm step (it keeps what it has buffered).
    e.warmOff?.();
    const url = e.preferOrig ? e.clip.orig : e.clip.src;
    const source: Source = e.preferOrig ? 'orig' : 'mirror';
    const buffered = e.url === url && el.readyState >= HAVE_METADATA;
    // QA-A2-switch: a warm load still streaming on this URL has bytes on the wire before the element parses any (a
    // headerless CBR mp3 reaches loadedmetadata only after ~80 KB). Aborting it at 2.5 s threw away a nearly complete
    // download; it counts as a first byte, and the give-up moves it to `orig` if no real byte follows.
    const midStream = !buffered && e.url === url && el.networkState === NETWORK_LOADING;

    const s: Session = {
      id, owner, el, source, t0,
      gotByte: buffered || midStream,
      assumedByte: midStream,
      windowAt: t0,
      cold: !buffered,
      triedOrig: source === 'orig' || e.clip.orig === e.clip.src,
      timers: [],
      off: () => {},
    };

    const onByte = () => { s.gotByte = true; s.assumedByte = false; s.lastByteAt = now(); };
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
    const onError = () => { onMediaError(s, `error-media${el.error?.code ?? 0}`); };
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
    if (e.url !== url) setSrc(e, el, url);
    // Only when it is not already at 0: assigning 0 still seeks, ~220 ms on some mp3s (bench 18 Oct 17:20Z, plan 10601).
    try { if (el.currentTime !== 0) el.currentTime = 0; } catch { /* not seekable yet: it starts at 0 anyway */ }
    startPlay(s);

    if (!buffered && !s.triedOrig) {
      s.timers.push(setT(() => {
        if (active === s && !s.gotByte && s.source === 'mirror' && states.get(id)?.state === 'loading') switchToOrig(s);
      }, timing.firstByteMs));
    }
    s.timers.push(setT(() => giveUpCheck(s), timing.giveUpMs));
  }

  /**
   * The give-up (A6) without calling a download that is still moving a failure: due at the later of giveUpMs after the
   * tap and stallMs after the last byte, never later than ceilingMs. Re-arms itself while bytes keep it in the future.
   * Result: `error-timeout` (the plain 6 s rule), `error-stall` (bytes stopped after the 6 s mark), `error-ceiling`.
   */
  function giveUpCheck(s: Session) {
    if (active !== s || states.get(s.id)?.state === 'playing') return;
    const base = s.windowAt + timing.giveUpMs;
    const ceiling = s.windowAt + timing.ceilingMs;
    const stallAt = s.lastByteAt === undefined ? -Infinity : s.lastByteAt + timing.stallMs;
    const due = Math.min(ceiling, Math.max(base, stallAt));
    const t = now();
    if (t < due) {
      s.timers.push(setT(() => giveUpCheck(s), due - t));
      return;
    }
    // A mid-stream warm load that never produced a byte: try `orig` once, with its own window, before the A6 state.
    if (s.assumedByte && s.source === 'mirror' && !s.triedOrig) {
      switchToOrig(s);
      s.assumedByte = false;
      s.windowAt = t;
      s.timers.push(setT(() => giveUpCheck(s), timing.giveUpMs));
      return;
    }
    fail(s, due >= ceiling && stallAt > ceiling ? 'error-ceiling' : stallAt > base ? 'error-stall' : 'error-timeout');
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
        if (!e || e.warm !== 'none') continue;
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
        e.warmOff?.();
        if (e.el) {
          // Let the browser drop the buffer and the connection.
          try { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); } catch { /* ignore */ }
        }
        e.url = undefined;
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
