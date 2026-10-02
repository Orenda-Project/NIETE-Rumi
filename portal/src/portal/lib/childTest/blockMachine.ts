/**
 * bd-s1oo0.7 — one block of the child test on the coach app, as a pure reducer.
 *
 *   ready ──Start──▶ recording ──Stop──▶ review ──Send──▶ sending ──▶ sent
 *     ▲                  │                 │                 │
 *     └──── Re-record ───┴─────────────────┘            failed (kept on the phone; Send again)
 *
 * Inside `recording` there is ONE timed minute — the story for a reading block
 * (it starts with Start, after the coach says the cue) or the quick sums for
 * maths (it starts on "Start quick sums", after the numbers). When it passes
 * the tone is due exactly once; the recording carries on for the questions and
 * made-up words until the coach taps Stop. A child who finishes early, or cannot
 * read the first line (the letters/words fallback), ends the minute by a tap.
 *
 * The clock is wall time from ticks, not a count of ticks, so a slow phone or a
 * backgrounded tab cannot stretch the minute.
 */

export type Block = "urdu" | "english" | "maths";

export type Phase = "ready" | "micBlocked" | "recording" | "review" | "sending" | "sent" | "failed";

export type BlockState = {
  block: Block;
  phase: Phase;
  timedSeconds: number;
  startedAt: number | null;
  timedStartAt: number | null;
  timedEndAt: number | null;
  now: number | null;
  toneDue: boolean;
  finishedEarly: boolean;
  fallback: boolean;
  recordingId: string | null;
  durationMs: number | null;
  attempts: number;
  error: string | null;
};

export type BlockEvent =
  | { type: "START"; now: number }
  | { type: "MIC_DENIED" }
  | { type: "START_TIMED"; now: number }
  | { type: "TICK"; now: number }
  | { type: "TONE_PLAYED" }
  | { type: "FINISH_EARLY"; now: number }
  | { type: "FALLBACK"; now: number }
  | { type: "STOPPED"; recordingId: string; durationMs: number }
  | { type: "RERECORD" }
  | { type: "SEND" }
  | { type: "SENT" }
  | { type: "SEND_FAILED"; reason: string };

export function initialBlock(block: Block, timedSeconds = 60): BlockState {
  return {
    block, phase: "ready", timedSeconds,
    startedAt: null, timedStartAt: null, timedEndAt: null, now: null,
    toneDue: false, finishedEarly: false, fallback: false,
    recordingId: null, durationMs: null, attempts: 0, error: null,
  };
}

export function inTimedMinute(s: BlockState): boolean {
  return s.phase === "recording" && s.timedStartAt != null && s.timedEndAt == null;
}

export function secondsLeft(s: BlockState): number {
  if (s.timedStartAt == null) return s.timedSeconds;
  if (s.timedEndAt != null) return Math.max(0, s.timedSeconds - Math.floor((s.timedEndAt - s.timedStartAt) / 1000));
  const elapsed = (s.now ?? s.timedStartAt) - s.timedStartAt;
  return Math.max(0, Math.ceil((s.timedSeconds * 1000 - elapsed) / 1000));
}

export function elapsedSeconds(s: BlockState): number {
  if (s.startedAt == null) return 0;
  return Math.max(0, Math.floor(((s.now ?? s.startedAt) - s.startedAt) / 1000));
}

/** The timed minute as offsets into the recording — sent with the upload for the scorer's window. */
export function appTiming(s: BlockState) {
  const off = (t: number | null) => (t != null && s.startedAt != null ? t - s.startedAt : null);
  return {
    timedStartMs: off(s.timedStartAt),
    timedEndMs: off(s.timedEndAt),
    finishedEarly: s.finishedEarly,
    fallback: s.fallback,
    attempts: s.attempts + 1,
  };
}

function endMinute(s: BlockState, at: number, extra: Partial<BlockState>): BlockState {
  if (s.timedEndAt != null) return s;
  return { ...s, timedStartAt: s.timedStartAt ?? at, timedEndAt: at, now: at, ...extra };
}

export function reduceBlock(s: BlockState, e: BlockEvent): BlockState {
  switch (e.type) {
    case "START":
      if (s.phase !== "ready" && s.phase !== "micBlocked") return s;
      return {
        ...initialBlock(s.block, s.timedSeconds),
        attempts: s.attempts,
        phase: "recording",
        startedAt: e.now,
        now: e.now,
        // maths: the numbers come first, untimed
        timedStartAt: s.block === "maths" ? null : e.now,
      };
    case "MIC_DENIED":
      return s.phase === "ready" || s.phase === "micBlocked" ? { ...s, phase: "micBlocked" } : s;
    case "START_TIMED":
      if (s.phase !== "recording" || s.timedStartAt != null) return s;
      return { ...s, timedStartAt: e.now, now: e.now };
    case "TICK": {
      if (s.phase !== "recording") return s;
      const next = { ...s, now: e.now };
      if (inTimedMinute(s) && e.now - (s.timedStartAt as number) >= s.timedSeconds * 1000) {
        return { ...next, timedEndAt: (s.timedStartAt as number) + s.timedSeconds * 1000, toneDue: true };
      }
      return next;
    }
    case "TONE_PLAYED":
      return s.toneDue ? { ...s, toneDue: false } : s;
    case "FINISH_EARLY":
      if (!inTimedMinute(s)) return s;
      return endMinute(s, e.now, { finishedEarly: true });
    case "FALLBACK":
      if (s.phase !== "recording" || s.block === "maths" || s.fallback) return s;
      return { ...endMinute(s, e.now, {}), fallback: true };
    case "STOPPED":
      if (s.phase !== "recording") return s;
      return {
        ...s,
        phase: "review",
        recordingId: e.recordingId,
        durationMs: e.durationMs,
        // stopping inside the minute ends it there
        timedEndAt: s.timedStartAt != null && s.timedEndAt == null ? (s.now ?? s.timedStartAt) : s.timedEndAt,
        toneDue: false,
      };
    case "RERECORD":
      if (s.phase !== "review" && s.phase !== "failed") return s;
      return { ...initialBlock(s.block, s.timedSeconds), attempts: s.attempts + 1 };
    case "SEND":
      if (s.phase !== "review" && s.phase !== "failed") return s;
      return { ...s, phase: "sending", error: null };
    case "SENT":
      return s.phase === "sending" ? { ...s, phase: "sent", error: null } : s;
    case "SEND_FAILED":
      return s.phase === "sending" ? { ...s, phase: "failed", error: e.reason } : s;
    default:
      return s;
  }
}
