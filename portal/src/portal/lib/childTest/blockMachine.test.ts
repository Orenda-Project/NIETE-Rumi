import { describe, it, expect } from "vitest";
import { initialBlock, reduceBlock, secondsLeft, inTimedMinute, appTiming, type BlockState } from "./blockMachine";

// bd-s1oo0.7 — one block of the child test (Urdu, English or maths) on the app:
//   ready → recording (timed minute, then the rest) → review → sending → sent
// The 60-second minute is the story (reading) or the quick sums (maths). The
// tone is due exactly once, when the minute passes; the recording keeps going
// for the questions / made-up words until the coach taps Stop.

const T0 = 1_000_000;

function run(state: BlockState, ...events: Parameters<typeof reduceBlock>[1][]) {
  return events.reduce(reduceBlock, state);
}

describe("reading block", () => {
  it("Start begins recording AND the timed minute", () => {
    const s = run(initialBlock("urdu"), { type: "START", now: T0 });
    expect(s.phase).toBe("recording");
    expect(s.startedAt).toBe(T0);
    expect(s.timedStartAt).toBe(T0);
    expect(inTimedMinute(s)).toBe(true);
    expect(secondsLeft(s)).toBe(60);
  });

  it("counts down on ticks and makes the tone due once at 60 s", () => {
    let s = run(initialBlock("urdu"), { type: "START", now: T0 }, { type: "TICK", now: T0 + 59_400 });
    expect(secondsLeft(s)).toBe(1);
    expect(s.toneDue).toBe(false);
    s = reduceBlock(s, { type: "TICK", now: T0 + 60_000 });
    expect(secondsLeft(s)).toBe(0);
    expect(s.toneDue).toBe(true);
    expect(s.timedEndAt).toBe(T0 + 60_000);
    expect(s.finishedEarly).toBe(false);
    expect(inTimedMinute(s)).toBe(false);
    s = reduceBlock(s, { type: "TONE_PLAYED" });
    s = reduceBlock(s, { type: "TICK", now: T0 + 61_000 });
    expect(s.toneDue).toBe(false);
    expect(s.phase).toBe("recording"); // still recording the questions
  });

  it("the child finishing early ends the minute without a tone and records it", () => {
    const s = run(initialBlock("english"), { type: "START", now: T0 }, { type: "FINISH_EARLY", now: T0 + 42_000 });
    expect(s.timedEndAt).toBe(T0 + 42_000);
    expect(s.finishedEarly).toBe(true);
    expect(s.toneDue).toBe(false);
    expect(inTimedMinute(s)).toBe(false);
  });

  it("cannot read the first line → the fallback card, and the minute ends", () => {
    const s = run(initialBlock("urdu"), { type: "START", now: T0 }, { type: "FALLBACK", now: T0 + 8_000 });
    expect(s.fallback).toBe(true);
    expect(s.timedEndAt).toBe(T0 + 8_000);
    expect(inTimedMinute(s)).toBe(false);
  });

  it("Stop → review with the recording; re-record goes back to ready and counts the attempt", () => {
    let s = run(initialBlock("urdu"), { type: "START", now: T0 }, { type: "STOPPED", recordingId: "r1", durationMs: 95_000 });
    expect(s.phase).toBe("review");
    expect(s.recordingId).toBe("r1");
    s = reduceBlock(s, { type: "RERECORD" });
    expect(s.phase).toBe("ready");
    expect(s.recordingId).toBeNull();
    expect(s.attempts).toBe(1);
    expect(s.startedAt).toBeNull();
  });

  it("Send → sending → sent; a failed send keeps the recording and can be retried", () => {
    let s = run(initialBlock("urdu"), { type: "START", now: T0 }, { type: "STOPPED", recordingId: "r1", durationMs: 95_000 }, { type: "SEND" });
    expect(s.phase).toBe("sending");
    s = reduceBlock(s, { type: "SEND_FAILED", reason: "network" });
    expect(s.phase).toBe("failed");
    expect(s.recordingId).toBe("r1");
    expect(s.error).toBe("network");
    s = run(s, { type: "SEND" }, { type: "SENT" });
    expect(s.phase).toBe("sent");
    expect(s.error).toBeNull();
  });

  it("a denied microphone is its own state, and Start from there tries again", () => {
    let s = reduceBlock(initialBlock("urdu"), { type: "MIC_DENIED" });
    expect(s.phase).toBe("micBlocked");
    s = reduceBlock(s, { type: "START", now: T0 });
    expect(s.phase).toBe("recording");
  });

  it("ignores events that make no sense in the current phase", () => {
    const ready = initialBlock("urdu");
    expect(reduceBlock(ready, { type: "TICK", now: T0 })).toBe(ready);
    expect(reduceBlock(ready, { type: "SEND" })).toBe(ready);
    const sent = run(ready, { type: "START", now: T0 }, { type: "STOPPED", recordingId: "r", durationMs: 1 }, { type: "SEND" }, { type: "SENT" });
    expect(reduceBlock(sent, { type: "RERECORD" })).toBe(sent);
  });
});

describe("maths block", () => {
  it("Start records the numbers untimed; the minute starts with the quick sums", () => {
    let s = run(initialBlock("maths"), { type: "START", now: T0 });
    expect(s.phase).toBe("recording");
    expect(s.timedStartAt).toBeNull();
    expect(inTimedMinute(s)).toBe(false);
    expect(secondsLeft(s)).toBe(60);
    s = run(s, { type: "TICK", now: T0 + 30_000 }, { type: "START_TIMED", now: T0 + 30_000 });
    expect(s.timedStartAt).toBe(T0 + 30_000);
    s = reduceBlock(s, { type: "TICK", now: T0 + 90_000 });
    expect(s.toneDue).toBe(true);
  });
});

describe("appTiming", () => {
  it("gives the timed minute as offsets into the recording, for the scorer's window", () => {
    const s = run(initialBlock("maths"), { type: "START", now: T0 }, { type: "START_TIMED", now: T0 + 30_000 },
      { type: "TICK", now: T0 + 90_000 }, { type: "STOPPED", recordingId: "r", durationMs: 100_000 });
    expect(appTiming(s)).toEqual({ timedStartMs: 30_000, timedEndMs: 90_000, finishedEarly: false, fallback: false, attempts: 1 });
  });
});
