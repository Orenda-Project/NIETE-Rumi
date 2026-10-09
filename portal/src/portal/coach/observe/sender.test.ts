import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * bd-4404s7.4 — the observation is sent by this module, not by the page that asked: leaving the page does not stop it,
 * the notices follow it, a failure keeps the files so Try again sends the SAME observation, and the phone's copy of a
 * recording is let go only once the server has it.
 */
const lib = vi.hoisted(() => ({ sendObservation: vi.fn(), forgetRecording: vi.fn() }));
vi.mock("../../lib/coachObserve", () => lib);
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}) }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: {} }));

import { deleteRecording } from "../../lib/recordingStore";
import { SendError } from "../../lib/coachingSend";
import { noticeTracker } from "../../teacher/notices/tracker";
import { setDraft, getDraft, clearDraft } from "../observeDraft";
import { getJob, resetSender, retrySend, sendingPath, startSend, type SendArgs } from "./sender";

const send = lib.sendObservation as ReturnType<typeof vi.fn>;
const ID = "observation:v1";

const args = (over: Partial<SendArgs> = {}): SendArgs => ({
  visitId: "v1", teacherExtId: "923001110001", schoolExtId: "niete:110", teacherName: "Ayesha Bibi", visitDay: "2026-10-06",
  durationMs: 38 * 60_000, recordingId: "rec-1",
  audio: { blob: new Blob(["a"]), filename: "Observation 6 Oct 11.30.webm" }, plan: null, photos: [], ...over,
});

/** A send the test finishes by hand. */
function pending() {
  let done!: (v: { coachingSessionId: string }) => void;
  let fail!: (e: unknown) => void;
  let progress!: (pct: number) => void;
  send.mockImplementationOnce((_a: unknown, _b: unknown, _c: unknown, onProgress: (n: number) => void) => {
    progress = onProgress;
    return new Promise((res, rej) => { done = res; fail = rej; });
  });
  return { done: (v: { coachingSessionId: string }) => done(v), fail: (e: unknown) => fail(e), progress: (n: number) => progress(n) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  noticeTracker.attach("923001234567", { server: false });
  resetSender();
  clearDraft("v1");
});
afterEach(() => { noticeTracker.reset(); });

describe("startSend", () => {
  it("returns at once; the notices follow it as 'Observation · Ayesha Bibi' with its own page as where a tap goes", () => {
    pending();
    const job = startSend(args());
    expect(job).toMatchObject({ visitId: "v1", state: "sending", pct: 0 });
    expect(noticeTracker.getItems()).toEqual([
      expect.objectContaining({ id: ID, kind: "observation", state: "making", title: "Ayesha Bibi", waitHref: sendingPath("v1"), visitDay: "2026-10-06", durationMs: 38 * 60_000 }),
    ]);
  });

  it("sends THIS visit's teacher, school, audio, plan and photos through the existing pipeline", () => {
    pending();
    const photo = new File(["p"], "board.jpg", { type: "image/jpeg" });
    startSend(args({ photos: [photo], plan: { kind: "library", pick: { assetId: "a1" } } }));
    expect(send.mock.calls[0][0]).toMatchObject({
      teacherExtId: "923001110001", schoolExtId: "niete:110", audio: { filename: "Observation 6 Oct 11.30.webm" },
      plan: { kind: "library", pick: { assetId: "a1" } }, photos: [photo],
    });
  });

  it("progress is real: the job and the strip carry the pipeline's percent", () => {
    const p = pending();
    startSend(args());
    p.progress(62);
    expect(getJob("v1")?.pct).toBe(62);
    expect(noticeTracker.getItems()[0].progress).toBeCloseTo(0.62);
  });

  it("a second tap on a visit already sending does not send twice", () => {
    pending();
    startSend(args());
    startSend(args());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sent: the observation it started is kept, the item is ready, and the phone's copy is let go", async () => {
    const p = pending();
    setDraft("v1", { blob: new Blob(["a"]), filename: "x", durationMs: 1, recordingId: "rec-1", label: "l", sub: "s" });
    startSend(args());
    p.done({ coachingSessionId: "cs-7" });
    await settle();
    expect(getJob("v1")).toMatchObject({ state: "sent", pct: 100, observationId: "cs-7" });
    expect(noticeTracker.getItems()[0]).toMatchObject({ state: "ready", observationId: "cs-7" });
    expect(deleteRecording).toHaveBeenCalledWith("rec-1");
    expect(lib.forgetRecording).toHaveBeenCalledWith("rec-1");
    expect(getDraft("v1")).toBeNull();
  });

  it("a chosen file has no phone copy to let go", async () => {
    const p = pending();
    startSend(args({ recordingId: null }));
    p.done({ coachingSessionId: "cs-7" });
    await settle();
    expect(deleteRecording).not.toHaveBeenCalled();
  });
});

describe("a failure", () => {
  it("is the app's alone: the item fails with the real reason, and the recording stays on the phone", async () => {
    const p = pending();
    startSend(args());
    p.fail(new SendError("network"));
    await settle();
    expect(getJob("v1")).toMatchObject({ state: "failed", errorCode: "network" });
    expect(noticeTracker.getItems()[0]).toMatchObject({ state: "failed", errorCode: "network" });
    expect(deleteRecording).not.toHaveBeenCalled();
  });

  it.each([
    [new SendError("plan_not_ready"), "plan_not_ready"],
    [new SendError("refused", undefined, "not_your_teacher"), "not_your_teacher"],
    [new SendError("refused"), "refused"],
    [new Error("boom"), "network"],
  ])("%#: the reason is kept as %s", async (err, code) => {
    const p = pending();
    startSend(args());
    p.fail(err);
    await settle();
    expect(getJob("v1")?.errorCode).toBe(code);
  });

  it("Try again sends the SAME observation again, from the strip's or the banner's button", async () => {
    const first = pending();
    startSend(args());
    first.fail(new SendError("network"));
    await settle();
    const second = pending();
    expect(await noticeTracker.retry(ID)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].audio).toBe(send.mock.calls[0][0].audio);
    expect(send.mock.calls[1][0].audio.filename).toBe("Observation 6 Oct 11.30.webm");
    expect(getJob("v1")).toMatchObject({ state: "sending", pct: 0, errorCode: null });
    expect(noticeTracker.getItems()[0]).toMatchObject({ state: "making", progress: 0 });
    second.done({ coachingSessionId: "cs-8" });
    await settle();
    expect(getJob("v1")?.observationId).toBe("cs-8");
  });

  it("Try again works after the notices let go of the failed item (she was on the Sending page)", async () => {
    const first = pending();
    startSend(args());
    first.fail(new SendError("network"));
    await settle();
    noticeTracker.settle(ID);
    expect(noticeTracker.getItems()).toHaveLength(0);
    pending();
    expect(retrySend("v1")).toBe(true);
    expect(noticeTracker.getItems()).toEqual([expect.objectContaining({ id: ID, state: "making" })]);
  });

  it("there is nothing to retry for a visit that is not failed", () => {
    pending();
    startSend(args());
    expect(retrySend("v1")).toBe(false);
    expect(retrySend("other")).toBe(false);
  });
});
