import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * bd-tfya0m (queue #205) — the coach's (and principal's) observation START is asked again when no answer comes back,
 * and a start that still fails says so plainly.
 *
 * Production, 19 Nov 10:28-10:30 PKT: a coach's recording reached R2 four times and no POST /leader/observe/start ever
 * reached the server. Her app ran a page loaded before the 18 Nov picker fix (bd-tymy1n); that part is fixed. What this
 * pins is the rest of the same path: once every file has arrived, the start is one small request, and a dropped
 * connection or a 5xx (a deploy restarting the bot) must not end the send. The bot answers a repeated start of the same
 * recording with the same observation (portal-observe.service: `already`), so asking again is safe.
 *
 *   - no answer / 5xx on the start → asked again after short waits; the files are not uploaded again
 *   - a 4xx is an answer → not asked again
 *   - still no answer after the last try → "network" with no part (every file arrived), which the Sending page shows
 *     as its own words: the recording arrived, the observation did not start, Try again (start_failed)
 */
vi.mock("../../services/api", () => ({ portal: {}, leader: {} }));

import { sendObservation } from "../../lib/coachObserve";
import { SendError } from "../../lib/coachingSend";
import { failureWords } from "./format";
import { OBSERVE } from "./copy";
import { startCodeOf } from "./sender";

const noAnswer = () => Object.assign(new Error("Network Error"), { response: undefined });
const status = (s: number, data: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${s}`), { response: { status: s, data } });

function api() {
  return {
    presignObserveUpload: vi.fn(async ({ kind }: { kind: string }) => ({ key: `${kind}-k`, uploadUrl: "u", contentType: "audio/mp4" })),
    startObservation: vi.fn(),
    startTalk: vi.fn(),
  };
}
const upload = () => ({ uploadToR2: vi.fn().mockResolvedValue(undefined) });
const base = { teacherExtId: "9231", schoolExtId: "niete:7", audio: { blob: new Blob(["a"]), filename: "l.m4a" }, plan: null, photos: [] as File[] };

let a: ReturnType<typeof api>;
let u: ReturnType<typeof upload>;
beforeEach(() => { a = api(); u = upload(); });

describe("the start is asked again when no answer comes back", () => {
  it("no answer, then the bot's answer: the observation starts and the recording went up once", async () => {
    a.startObservation.mockRejectedValueOnce(noAnswer()).mockResolvedValueOnce({ coachingSessionId: "cs-1" });
    const out = await sendObservation({ ...base, startRetryMs: [0, 0] }, a as any, u as any);
    expect(out).toEqual({ coachingSessionId: "cs-1" });
    expect(a.startObservation).toHaveBeenCalledTimes(2);
    expect(u.uploadToR2).toHaveBeenCalledTimes(1);
  });

  it("a 502 (the bot restarting) is asked again too", async () => {
    a.startObservation.mockRejectedValueOnce(status(502)).mockResolvedValueOnce({ coachingSessionId: "cs-2" });
    await expect(sendObservation({ ...base, startRetryMs: [0, 0] }, a as any, u as any)).resolves.toEqual({ coachingSessionId: "cs-2" });
    expect(a.startObservation).toHaveBeenCalledTimes(2);
  });

  it("a 4xx is an answer: not asked again", async () => {
    a.startObservation.mockRejectedValue(status(400, { reason: "not_your_teacher" }));
    await expect(sendObservation({ ...base, startRetryMs: [0, 0] }, a as any, u as any)).rejects.toMatchObject({ kind: "refused" });
    expect(a.startObservation).toHaveBeenCalledTimes(1);
  });

  it("the coach's send asks again by default (two more tries)", async () => {
    vi.useFakeTimers();
    try {
      a.startObservation.mockRejectedValue(noAnswer());
      const out = sendObservation(base, a as any, u as any).catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await out;
      expect(err).toBeInstanceOf(SendError);
      expect(a.startObservation).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still no answer after the last try: 'network' with no part — every file arrived", async () => {
    a.startObservation.mockRejectedValue(noAnswer());
    const err = await sendObservation({ ...base, startRetryMs: [0, 0] }, a as any, u as any).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.kind).toBe("network");
    expect(err.detail).toMatchObject({ part: null, unreadable: false });
    expect(a.startObservation).toHaveBeenCalledTimes(3);
  });
});

describe("a start that never answered has its own words", () => {
  it("the job's code is start_failed (not 'The internet stopped')", () => {
    const err = new SendError("network", undefined, undefined, { part: null, offline: false, unreadable: false });
    expect(startCodeOf(err)).toBe("start_failed");
  });
  it("offline is still 'network' (No internet is the true reason then)", () => {
    const err = new SendError("network", undefined, undefined, { part: null, offline: true, unreadable: false });
    expect(startCodeOf(err)).toBe("network");
  });
  it("an upload that stopped is still 'network'", () => {
    const err = new SendError("network", undefined, undefined, { part: { kind: "audio", photo: 0 }, offline: false, unreadable: false });
    expect(startCodeOf(err)).toBe("network");
  });
  it("Sending says the recording arrived and the observation did not start, in English and Urdu", () => {
    expect(failureWords("start_failed", OBSERVE.en)).toBe(OBSERVE.en.failure.startFailed);
    expect(OBSERVE.en.failure.startFailed).toMatch(/arrived/);
    expect(OBSERVE.en.failure.startFailed).toMatch(/Try again/);
    expect(failureWords("start_failed", OBSERVE.ur)).toBe(OBSERVE.ur.failure.startFailed);
    expect(OBSERVE.ur.failure.startFailed).toMatch(/[؀-ۿ]/);
  });
});
