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
 */

import { withDuration } from "./webmDuration";
import * as Store from "./recordingStore";
import type { RecordingType } from "./recordingSupport";

const SLICE_MS = 5_000;

// Opus at 32 kb/s mono is clear speech for transcription, and a 40-minute
// lesson stays near 10 MB — an upload a weak connection can finish.
const AUDIO_BITS_PER_SECOND = 32_000;

type StoreLike = Pick<typeof Store, "createRecording" | "appendChunk" | "markFinished" | "deleteRecording">;

export type FinishedRecording = { blob: Blob; durationMs: number; type: RecordingType; id: string };

type Options = {
  stream: MediaStream;
  type: RecordingType;
  store?: StoreLike;
  MediaRecorder?: typeof MediaRecorder;
  now?: () => number;
  id?: string;
  startedAt?: () => string;
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
  }

  async start(): Promise<void> {
    try {
      await this.store.createRecording({
        id: this.id, mimeType: this.type.mimeType, ext: this.type.ext, startedAt: this.startedAt(),
      });
    } catch {
      // No phone storage (private browsing): the recording still lives in memory.
    }
    const recorder = new this.MR(this.stream, { mimeType: this.type.mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    recorder.ondataavailable = (e: BlobEvent | { data: Blob }) => {
      if (!e.data || e.data.size === 0) return;
      this.chunks.push(e.data);
      const seq = this.seq;
      this.seq += 1;
      this.store.appendChunk(this.id, seq, e.data, this.elapsedMs()).catch(() => { /* memory copy remains */ });
    };
    this.recorder = recorder;
    this.runningSince = this.now();
    recorder.start(SLICE_MS);
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
  }

  resume(): void {
    if (!this.recorder || !this.paused) return;
    this.recorder.resume();
    this.runningSince = this.now();
    this.paused = false;
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

    // An unpatched file still transcribes; only its length would be unknown.
    const blob = await withDuration(new Blob(this.chunks, { type: this.type.mimeType }), this.type.ext, durationMs);
    try { await this.store.markFinished(this.id, durationMs); } catch { /* memory copy remains */ }
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
    try { await this.store.deleteRecording(this.id); } catch { /* nothing stored */ }
  }

  private release(): void {
    for (const track of this.stream.getTracks()) {
      try { track.stop(); } catch { /* already stopped */ }
    }
  }
}
