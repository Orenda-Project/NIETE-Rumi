import { describe, it, expect } from "vitest";
import { keptOffer, wasCut, lastSavedAt, RESUME_WINDOW_MS } from "./keptOffer";

/**
 * bd-91htd2 (queue #292, NIETE prod 26 Nov) — since portal_recording_resume = "teachers" (25 Nov 23:41 PKT) the DC
 * screen reopened EVERY recording kept on the phone as a paused lesson: ones she had stopped herself, ones from days
 * before. 110 of the 117 reopened that morning were older than the release; 63 were resumed, so today's lesson was
 * joined onto an old one (6 had 15+ old minutes and 10+ new). Only a lesson cut by a kill, reopened soon, is resumed.
 */

const NOW = Date.parse("2026-11-26T09:00:00Z");
const MIN = 60_000;
const kept = (o: { finished?: boolean; startedMinAgo?: number; elapsedMin?: number; beats?: Record<string, unknown>[] } = {}) => ({
  meta: {
    id: "rec-1", mimeType: "audio/webm", ext: ".webm",
    startedAt: new Date(NOW - (o.startedMinAgo ?? 30) * MIN).toISOString(),
    elapsedMs: (o.elapsedMin ?? 20) * MIN, finished: o.finished ?? false,
  },
  blob: new Blob(["x"], { type: "audio/webm" }), nextSeq: 1, parts: 1, beats: o.beats ?? [],
});

describe("keptOffer: what the DC screen does with a recording kept on the phone", () => {
  it("cut by a kill (not finished), last saved minutes ago: resume (the paused screen)", () => {
    expect(keptOffer(kept({ startedMinAgo: 25, elapsedMin: 20 }), NOW)).toBe("resume");
  });

  it("cut by a kill, last beat 10 min ago: resume", () => {
    const beats = [{ s: 0, t: NOW - 30 * MIN, st: "r" }, { s: 1, t: NOW - 10 * MIN, st: "r" }];
    expect(keptOffer(kept({ beats, startedMinAgo: 60 }), NOW)).toBe("resume");
  });

  it("cut by a kill, but last saved more than the window ago (yesterday): never resumed; 15+ min goes to Send", () => {
    expect(keptOffer(kept({ startedMinAgo: 24 * 60, elapsedMin: 23 }), NOW)).toBe("send");
    const beats = [{ s: 0, t: NOW - RESUME_WINDOW_MS - MIN, st: "r" }];
    expect(keptOffer(kept({ beats, elapsedMin: 30 }), NOW)).toBe("send");
  });

  it("STOPPED by her (finished, last state inactive) a minute ago: never resumed; 15+ min goes to Send", () => {
    const beats = [{ s: 0, t: NOW - 2 * MIN, st: "r" }, { s: 1, t: NOW - MIN, st: "i" }];
    expect(keptOffer(kept({ finished: true, beats, elapsedMin: 29 }), NOW)).toBe("send");
    expect(keptOffer(kept({ finished: true, startedMinAgo: 40, elapsedMin: 29 }), NOW)).toBe("send");
  });

  it("stopped or too old, and under 15 min (cannot be sent): nothing (the screen as before)", () => {
    expect(keptOffer(kept({ finished: true, startedMinAgo: 5, elapsedMin: 0.1 }), NOW)).toBe("none");
    expect(keptOffer(kept({ startedMinAgo: 3 * 24 * 60, elapsedMin: 6 }), NOW)).toBe("none");
  });

  it("a stopped recording resumed and then killed (finished stays true, last beat recording): a cut", () => {
    const beats = [{ s: 0, t: NOW - 5 * MIN, st: "i" }, { s: 1, t: NOW - 2 * MIN, st: "r" }];
    const k = kept({ finished: true, beats });
    expect(wasCut(k)).toBe(true);
    expect(keptOffer(k, NOW)).toBe("resume");
  });

  it("lastSavedAt: the last beat's time; with no beats (saved before 25 Nov), its start plus its length", () => {
    expect(lastSavedAt(kept({ beats: [{ s: 3, t: NOW - 7 * MIN }] }))).toBe(NOW - 7 * MIN);
    expect(lastSavedAt(kept({ startedMinAgo: 30, elapsedMin: 20 }))).toBe(NOW - 10 * MIN);
  });
});
