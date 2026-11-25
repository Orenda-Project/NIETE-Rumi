/**
 * bd-ma9jiy — the recorder's heartbeat: one small sample every time a piece of the recording is saved on the phone (every
 * second), so we can see, per recording, what the phone was doing while it recorded and where it stopped.
 *
 *   each save     a sample: when, the piece's number, recorded time so far, the piece's bytes and the total, the recorder's
 *                 state, online, the page visible, the page focused (WhatsApp in front), the save ok or its error, and where
 *                 the phone tells: storage left, battery and charging, network type. Taken synchronously from values read
 *                 ahead (battery and storage are asked every 15 s), so a save never waits for it.
 *   on the phone  each sample is stored WITH its piece (recordingStore appendChunk `beat`), so a phone offline for the whole
 *                 lesson still has every sample, and a killed recording keeps them up to its last second.
 *   to us         in small batches (30 samples, or 30 s, whichever first) while online, the rest when the page hides
 *                 (keepalive) and when the recording is sent or thrown away (recordingStore deleteRecording): one log row per
 *                 batch (Axiom `recording.beats`), never one per second. Events (start, pause, resume, cut, stop, save
 *                 failed, save to phone, re-send) are rows of their own (`recording.event`).
 *   a cut         a recording found on the phone unfinished: the time between its last sample and now is the cut (the app
 *                 killed, the phone off), told once with the phone's state at that last sample.
 *
 * Instrumentation only: nothing here can stop or slow a recording; every failure is swallowed.
 */

import { browserEnv, getApiBaseUrl } from "@/lib/runtime";

export type RecordingKind = "dc" | "obs" | "dbrf";

export type BeatContext = {
  kind: RecordingKind;
  /** Coach and principal: the visit being observed, and the observed teacher. */
  visitId?: string | null;
  teacherExtId?: string | null;
  /** Debrief: the observation the talk belongs to. */
  observationId?: string | null;
};

/** One sample. Short keys: it is stored once a second for the whole lesson and sent in batches. */
export type BeatSample = {
  t: number; // epoch ms
  s: number; // the piece's number (seq)
  ms: number; // recorded time so far (pauses excluded)
  sz: number; // this piece's bytes
  kb: number; // all pieces so far, KB
  st: "r" | "p" | "i"; // MediaRecorder: recording / paused / inactive
  on: 0 | 1; // navigator.onLine
  vis: 0 | 1; // the page visible
  foc: 0 | 1; // the page has focus (the app in front)
  ok?: 0 | 1; // the save to the phone worked
  e?: string; // its error's name when it did not
  q?: number; // storage left on the phone for this site, MB
  b?: number; // battery %
  c?: 0 | 1; // charging
  n?: string; // network type (effectiveType or type)
};

export type BeatEvent = { k: string; t: number } & Record<string, string | number | boolean | null>;

type BatteryLike = { level: number; charging: boolean; addEventListener?: (t: string, f: () => void) => void };

export type BeatEnv = {
  now: () => number;
  online: () => boolean;
  visible: () => boolean;
  focused: () => boolean;
  net: () => string | null;
  battery: () => Promise<BatteryLike | null>;
  storageLeftMb: () => Promise<number | null>;
  /** POST the batch; true when it arrived. keepalive: the page may be going away. */
  post: (body: string, keepalive: boolean) => Promise<boolean>;
  setInterval: (f: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
  onHide: (f: () => void) => () => void;
};

export const BEATS_PATH = "/funnel/recording";
const BATCH_ROWS = 30;
const BATCH_MS = 30_000;
const ASK_EVERY_MS = 15_000;
const MAX_QUEUE = 900; // 15 minutes offline held in memory; the rest is on the phone with the pieces
const SENT_KEY = "niete.rec.beats.";
export const COLUMNS = ["dt", "s", "ms", "sz", "kb", "st", "on", "vis", "foc", "ok", "e", "q", "b", "c", "n"] as const;

export function defaultBeatEnv(): BeatEnv {
  return {
    now: () => Date.now(),
    online: () => (typeof navigator === "undefined" || navigator.onLine !== false),
    visible: () => (typeof document === "undefined" || document.visibilityState !== "hidden"),
    focused: () => {
      try { return typeof document === "undefined" || document.hasFocus(); } catch { return true; }
    },
    net: () => {
      try {
        const c = (navigator as unknown as { connection?: { effectiveType?: string; type?: string } }).connection;
        if (!c) return null;
        const v = c.type && c.type !== "unknown" ? `${c.type}${c.effectiveType ? `/${c.effectiveType}` : ""}` : c.effectiveType;
        return v ? String(v).slice(0, 24) : null;
      } catch { return null; }
    },
    battery: async () => {
      try {
        const get = (navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery;
        return get ? await get.call(navigator) : null;
      } catch { return null; }
    },
    storageLeftMb: async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (!est || est.quota == null) return null;
        return Math.max(0, Math.round(((est.quota || 0) - (est.usage || 0)) / (1024 * 1024)));
      } catch { return null; }
    },
    post: async (body, keepalive) => {
      try {
        const res = await fetch(`${getApiBaseUrl()}${BEATS_PATH}`, {
          method: "POST", body, keepalive, credentials: "include", headers: { "Content-Type": "text/plain;charset=UTF-8" },
        });
        return res.ok || res.status === 400; // a 400 will never be accepted: drop it, never resend it forever
      } catch { return false; }
    },
    setInterval: (f, ms) => setInterval(f, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    onHide: (f) => {
      if (typeof document === "undefined") return () => undefined;
      const h = () => { if (document.visibilityState === "hidden") f(); };
      document.addEventListener("visibilitychange", h);
      window.addEventListener("pagehide", f);
      return () => { document.removeEventListener("visibilitychange", h); window.removeEventListener("pagehide", f); };
    },
  };
}

type Sent = { s: number; ctx?: BeatContext };

function readSent(rid: string): Sent | null {
  try {
    const v = window.localStorage.getItem(SENT_KEY + rid);
    return v ? (JSON.parse(v) as Sent) : null;
  } catch { return null; }
}
function writeSent(rid: string, v: Sent | null): void {
  try {
    if (v) window.localStorage.setItem(SENT_KEY + rid, JSON.stringify(v));
    else window.localStorage.removeItem(SENT_KEY + rid);
  } catch { /* private window: beats may be sent twice, never lost */ }
}

/** The batch on the wire: columns once, then one short row per sample (dt = ms after t0). */
export function encodeBatch(rid: string, ctx: BeatContext, beats: BeatSample[], events: BeatEvent[], final = false): string {
  const t0 = beats.length ? beats[0].t : events.length ? events[0].t : Date.now();
  const rows = beats.map((b) => [b.t - t0, b.s, b.ms, b.sz, b.kb, b.st, b.on, b.vis, b.foc, b.ok ?? null, b.e ?? null, b.q ?? null, b.b ?? null, b.c ?? null, b.n ?? null]);
  const ev = events.map(({ t, ...rest }) => ({ ...rest, dt: t - t0 }));
  let b: string | undefined;
  try { b = browserEnv(); } catch { b = undefined; }
  return JSON.stringify({ v: 1, rid, ...ctx, b, t0, cols: COLUMNS, rows, ev, ...(final ? { final: true } : {}) });
}

export class RecordingHeart {
  readonly rid: string;
  private readonly ctx: BeatContext;
  private readonly env: BeatEnv;
  private queue: BeatSample[] = [];
  private events: BeatEvent[] = [];
  private totalBytes = 0;
  private lastFlush: number;
  private sentUpTo: number;
  private flushing: Promise<void> | null = null;
  private battery: BatteryLike | null = null;
  private storageMb: number | null = null;
  private timer: unknown = null;
  private unHide: (() => void) | null = null;
  private disposed = false;

  constructor({ recordingId, ctx, env, bytesSoFar = 0 }: { recordingId: string; ctx: BeatContext; env?: BeatEnv; bytesSoFar?: number }) {
    this.rid = recordingId;
    this.ctx = ctx;
    this.env = env || defaultBeatEnv();
    this.totalBytes = bytesSoFar;
    this.lastFlush = this.env.now();
    const sent = readSent(recordingId);
    this.sentUpTo = sent ? sent.s : -1;
    writeSent(recordingId, { s: this.sentUpTo, ctx });
    void this.env.battery().then((b) => { this.battery = b; }).catch(() => {});
    const ask = () => { void this.env.storageLeftMb().then((q) => { this.storageMb = q; }).catch(() => {}); };
    ask();
    this.timer = this.env.setInterval(() => {
      ask();
      if (this.env.now() - this.lastFlush >= BATCH_MS) void this.flush();
    }, ASK_EVERY_MS);
    this.unHide = this.env.onHide(() => { void this.flush({ keepalive: true }); });
  }

  /** The sample for a piece about to be saved. Synchronous and cheap. */
  sample({ seq, ms, size, state }: { seq: number; ms: number; size: number; state: string }): BeatSample {
    this.totalBytes += size;
    const b: BeatSample = {
      t: this.env.now(), s: seq, ms: Math.round(ms), sz: size, kb: Math.round(this.totalBytes / 1024),
      st: state === "paused" ? "p" : state === "inactive" ? "i" : "r",
      on: this.env.online() ? 1 : 0, vis: this.env.visible() ? 1 : 0, foc: this.env.focused() ? 1 : 0,
    };
    if (this.storageMb != null) b.q = this.storageMb;
    if (this.battery) { b.b = Math.round(this.battery.level * 100); b.c = this.battery.charging ? 1 : 0; }
    const n = this.env.net();
    if (n) b.n = n;
    return b;
  }

  /** The save to the phone answered. A failure is also an event of its own (the first, then every 10th). */
  saved(beat: BeatSample, ok: boolean, err?: unknown): void {
    beat.ok = ok ? 1 : 0;
    if (!ok) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "Error";
      beat.e = name.slice(0, 40);
      const failures = this.queue.filter((q) => q.ok === 0).length;
      if (failures % 10 === 0) this.event("save_failed", { s: beat.s, e: beat.e, q: beat.q ?? null });
    }
    this.queue.push(beat);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= BATCH_ROWS || this.env.now() - this.lastFlush >= BATCH_MS) void this.flush();
  }

  event(k: string, fields: Record<string, string | number | boolean | null> = {}): void {
    this.events.push({ ...fields, k, t: this.env.now() });
    if (k !== "save_failed") void this.flush();
  }

  /** Send what is queued, when online (keepalive: the page is going away). Never two at once. */
  flush({ keepalive = false, final = false }: { keepalive?: boolean; final?: boolean } = {}): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.queue.length && !this.events.length) return Promise.resolve();
    if (!this.env.online() && !final) return Promise.resolve();
    const beats = this.queue.slice(0, 600);
    const events = this.events.slice(0, 50);
    const body = encodeBatch(this.rid, this.ctx, beats, events, final);
    this.lastFlush = this.env.now();
    this.flushing = this.env.post(body, keepalive || final).then((ok) => {
      if (!ok) return;
      this.queue.splice(0, beats.length);
      this.events.splice(0, events.length);
      if (beats.length) {
        this.sentUpTo = Math.max(this.sentUpTo, beats[beats.length - 1].s);
        if (!this.disposed) writeSent(this.rid, { s: this.sentUpTo, ctx: this.ctx });
      }
    }).catch(() => {}).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** The recording ended (stopped, sent or thrown away): the rest goes now, and the timers stop. */
  dispose(final = true): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.env.clearInterval(this.timer);
    this.unHide?.();
    const out = this.flush({ keepalive: true, final });
    this.disposed = true;
    return out;
  }
}

/**
 * A recording found on the phone unfinished (reopened as paused, or sent from the phone copy): the cut, told once —
 * the time from its last saved sample to now, and the phone's state at that sample. Null when there is no sample (a
 * recording from before the heartbeat).
 */
export function cutOf(beats: Record<string, unknown>[], now: number): Record<string, string | number | boolean | null> | null {
  const last = beats.length ? (beats[beats.length - 1] as Partial<BeatSample>) : null;
  if (!last || typeof last.t !== "number") return null;
  const hidden = beats.filter((b) => (b as Partial<BeatSample>).vis === 0).length;
  const offline = beats.filter((b) => (b as Partial<BeatSample>).on === 0).length;
  return {
    gapS: Math.max(0, Math.round((now - last.t) / 1000)),
    lastS: last.s ?? null, lastMs: last.ms ?? null, lastVis: last.vis ?? null, lastFoc: last.foc ?? null, lastOn: last.on ?? null,
    lastBattery: last.b ?? null, lastCharging: last.c ?? null, lastQuotaMb: last.q ?? null, lastState: last.st ?? null,
    hiddenSamples: hidden, offlineSamples: offline, samples: beats.length,
  };
}

/**
 * The samples of a recording that never reached us (the phone was offline, or the app was killed before a batch went),
 * sent when the recording leaves the phone (recordingStore deleteRecording) or is reopened. Best effort, keepalive.
 */
export async function sendLeftoverBeats(rid: string, beats: Record<string, unknown>[], env: BeatEnv = defaultBeatEnv()): Promise<void> {
  try {
    const sent = readSent(rid);
    const upTo = sent ? sent.s : -1;
    const left = beats.filter((b) => typeof (b as Partial<BeatSample>).s === "number" && (b as BeatSample).s > upTo) as BeatSample[];
    if (left.length && sent?.ctx) {
      for (let i = 0; i < left.length; i += 600) {
        // eslint-disable-next-line no-await-in-loop
        await env.post(encodeBatch(rid, sent.ctx, left.slice(i, i + 600), [], true), true);
      }
    }
  } catch { /* instrumentation only */ }
  writeSent(rid, null);
}
