/**
 * bd-5rz1v — the recorder behind "Record now".
 *
 *  · MediaRecorder hands over a chunk every SLICE_MS; each is kept in memory AND
 *    written to the phone (recordingStore), so a reload or a failed upload never
 *    costs the lesson. A storage refusal does not stop the recording.
 *  · Pause stops the clock: the duration is time actually recorded.
 *  · MediaRecorder's WebM carries NO duration in its header. ffprobe then says
 *    "N/A", the pipeline stores no length for the lesson, and the
 *    short-recording warning never fires. On stop the real duration is written
 *    in (fix-webm-duration). An MP4 recording already carries it.
 *
 * bd-ma9jiy (queue #262) — the ONE recorder of the teacher's Digital Coaching lesson, the coach's and principal's
 * observation and the coach's debrief:
 *  · a piece every SECOND (was 5 s; the child test passes its own 5 s): a killed app loses about a second, not five;
 *  · `resume` continues a recording kept on the phone (cut by a kill): the same id, the next piece numbers (the first one
 *    flagged as a new part), the clock carried on from the kept length; Stop joins the kept file and the new part into
 *    ONE WebM (webmJoin). The kept copy stays on the phone throughout, so a second kill loses nothing either;
 *  · `heart` (recordingBeat) gets a sample with each piece, stored beside it, and hears whether the save worked: a failed
 *    save was dropped silently; it is now counted, told, and the recording goes on from memory as before.
 */

import { withDuration } from "./webmDuration";
import { joinBlobs } from "./webmJoin";
import * as Store from "./recordingStore";
import type { RecordingType } from "./recordingSupport";
import type { BeatSample } from "./recordingBeat";

/** bd-ma9jiy — 1 s (was 5 s). See the work folder's slice-bench for the cost on a low-end phone. */
export const SLICE_MS = 1_000;

// Opus at 32 kb/s mono is clear speech for transcription, and a 40-minute
// lesson stays near 10 MB — an upload a weak connection can finish.
const AUDIO_BITS_PER_SECOND = 32_000;

type StoreLike = Pick<typeof Store, "createRecording" | "appendChunk" | "markFinished" | "deleteRecording">;

/** The heartbeat's side (recordingBeat RecordingHeart): a sample per piece, the save's answer, events. */
export type HeartLike = {
  sample: (x: { seq: number; ms: number; size: number; state: string }) => BeatSample | Record<string, unknown>;
  saved: (beat: never, ok: boolean, err?: unknown) => void;
  event: (k: string, fields?: Record<string, string | number | boolean | null>) => void;
  dispose: (final?: boolean) => unknown;
};

/** A recording kept on the phone to continue (recordingStore readKept): its file so far, where its pieces go on, its length. */
export type ResumeFrom = { prior: Blob; nextSeq: number; elapsedMs: number };

export type FinishedRecording = { blob: Blob; durationMs: number; type: RecordingType; id: string };

type Options = {
  stream: MediaStream;
  type: RecordingType;
  store?: StoreLike;
  MediaRecorder?: typeof MediaRecorder;
  now?: () => number;
  id?: string;
  startedAt?: () => string;
  /** bd-v0toag.31: the live screen's copy of each chunk, called after it is saved; it can never stop the recording. */
  onChunk?: (blob: Blob, seq: number, elapsedMs: number) => void;
  /** bd-ma9jiy: how often a piece is handed over and saved (default SLICE_MS, 1 s). */
  sliceMs?: number;
  /** bd-ma9jiy: continue this kept recording (pass its `id` too). */
  resume?: ResumeFrom;
  /** bd-ma9jiy: the heartbeat (recordingBeat). None: no telemetry (the child test). */
  heart?: HeartLike;
};

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export class LessonRecorder {
  readonly id: string;
  private readonly stream: MediaStream;
  private readonly type: RecordingType;
  private readonly store: StoreLike;
  private readonly MR: typeof MediaRecorder;
  private readonly now: () => number;
  private readonly startedAt: () => string;
  private readonly onChunk?: (blob: Blob, seq: number, elapsedMs: number) => void;
  private readonly sliceMs: number;
  private readonly prior: Blob | null;
  private readonly heart?: HeartLike;
  private firstOfPart: boolean;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private seq = 0;
  private runningSince: number | null = null;
  private banked = 0;
  private paused = false;

  constructor(opts: Options) {
    this.stream = opts.stream;
    this.type = opts.type;
    this.store = opts.store || Store;
    this.MR = opts.MediaRecorder || MediaRecorder;
    this.now = opts.now || (() => Date.now());
    this.id = opts.id || newId();
    this.startedAt = opts.startedAt || (() => new Date().toISOString());
    this.onChunk = opts.onChunk;
    this.sliceMs = opts.sliceMs || SLICE_MS;
    this.heart = opts.heart;
    this.prior = opts.resume ? opts.resume.prior : null;
    this.firstOfPart = !!opts.resume;
    if (opts.resume) {
      this.seq = opts.resume.nextSeq;
      this.banked = opts.resume.elapsedMs;
    }
  }

  async start(): Promise<void> {
    if (!this.prior) {
      try {
        await this.store.createRecording({
          id: this.id, mimeType: this.type.mimeType, ext: this.type.ext, startedAt: this.startedAt(),
        });
      } catch {
        // No phone storage (private browsing): the recording still lives in memory.
      }
    }
    const recorder = new this.MR(this.stream, { mimeType: this.type.mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    recorder.ondataavailable = (e: BlobEvent | { data: Blob }) => {
      if (!e.data || e.data.size === 0) return;
      this.chunks.push(e.data);
      const seq = this.seq;
      this.seq += 1;
      const ms = this.elapsedMs();
      const first = this.firstOfPart;
      this.firstOfPart = false;
      let beat: Record<string, unknown> | undefined;
      try { beat = this.heart?.sample({ seq, ms, size: e.data.size, state: recorder.state }) as Record<string, unknown> | undefined; } catch { beat = undefined; }
      const extra = beat || first ? { ...(beat ? { beat } : {}), ...(first ? { first: true } : {}) } : undefined;
      const saving = extra ? this.store.appendChunk(this.id, seq, e.data, ms, extra) : this.store.appendChunk(this.id, seq, e.data, ms);
      saving.then(
        () => { if (beat) this.tellHeart(beat, true); },
        (err: unknown) => { if (beat) this.tellHeart(beat, false, err); /* memory copy remains */ },
      );
      try { this.onChunk?.(e.data, seq, ms); } catch { /* the live path never touches the recording */ }
    };
    this.recorder = recorder;
    this.runningSince = this.now();
    recorder.start(this.sliceMs);
    this.tellEvent(this.prior ? "resume" : "start", { ms: Math.round(this.banked), s: this.seq, slice: this.sliceMs, mime: this.type.mimeType });
  }

  private tellHeart(beat: Record<string, unknown>, ok: boolean, err?: unknown): void {
    try { this.heart?.saved(beat as never, ok, ok ? undefined : err); } catch { /* instrumentation only */ }
  }

  private tellEvent(k: string, fields: Record<string, string | number | boolean | null>): void {
    try { this.heart?.event(k, fields); } catch { /* instrumentation only */ }
  }

  elapsedMs(): number {
    return this.banked + (this.runningSince != null ? this.now() - this.runningSince : 0);
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    if (!this.recorder || this.paused) return;
    this.recorder.pause();
    this.banked = this.elapsedMs();
    this.runningSince = null;
    this.paused = true;
    this.tellEvent("pause", { ms: Math.round(this.banked) });
  }

  resume(): void {
    if (!this.recorder || !this.paused) return;
    this.recorder.resume();
    this.runningSince = this.now();
    this.paused = false;
    this.tellEvent("unpause", { ms: Math.round(this.banked) });
  }

  async stop(): Promise<FinishedRecording> {
    const durationMs = this.elapsedMs();
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    this.banked = durationMs;
    this.runningSince = null;
    this.release();

    // bd-ma9jiy: a resumed recording is the kept file and this part, joined into one.
    const whole = this.prior
      ? await joinBlobs(this.prior, this.chunks, this.type.mimeType)
      : new Blob(this.chunks, { type: this.type.mimeType });
    // An unpatched file still transcribes; only its length would be unknown.
    const blob = await withDuration(whole, this.type.ext, durationMs);
    try { await this.store.markFinished(this.id, durationMs); } catch { /* memory copy remains */ }
    this.tellEvent("stop", { ms: Math.round(durationMs), s: this.seq, bytes: blob.size });
    try { void this.heart?.dispose(true); } catch { /* instrumentation only */ }
    return { blob, durationMs, type: this.type, id: this.id };
  }

  /** Throw the recording away: off the phone, microphone released. */
  async discard(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      try { recorder.stop(); } catch { /* already stopped */ }
    }
    this.release();
    this.chunks = [];
    this.tellEvent("discard", { ms: Math.round(this.elapsedMs()) });
    try { void this.heart?.dispose(true); } catch { /* instrumentation only */ }
    try { await this.store.deleteRecording(this.id); } catch { /* nothing stored */ }
  }

  private release(): void {
    for (const track of this.stream.getTracks()) {
      try { track.stop(); } catch { /* already stopped */ }
    }
  }
}
