import { describe, it, expect, vi } from "vitest";

// bd-5rz1v.6 — the coach's send: the teacher's sendLesson (every file to R2,
// then the start) through the coach's endpoints, carrying the observed teacher.

vi.mock("../services/api", () => ({ portal: {}, leader: {} }));

import { ENTRY_VARIANT, entryCopy, firstName, isWaiting, sendObservation, sendTalk, trackerIndex } from "./coachObserve";

describe("entry copy", () => {
  it("follows the operator's pick (B3) with the teachers' sheet words", () => {
    expect(ENTRY_VARIANT).toBe("B3");
    const c = entryCopy();
    expect([c.title, c.rec, c.file, c.sheet("Ayesha")]).toEqual([
      "Send a lesson to your Digital Coach", "Record Live Lecture", "Upload Recording", "Send Ayesha’s lesson",
    ]);
  });
  it("never promises to record on the button itself", () => {
    expect(entryCopy().title).not.toMatch(/record/i);
  });
});

describe("steps", () => {
  it("map onto the five tracker items", () => {
    expect(["analysing", "draft", "talk", "listening", "feedback", "report", "sending", "sent"].map((s) => trackerIndex(s as any)))
      .toEqual([0, 1, 2, 2, 3, 4, 4, 5]);
  });
  it("the page re-reads only while the worker has the next move", () => {
    expect(isWaiting({ step: "listening", preparing: false })).toBe(true);
    expect(isWaiting({ step: "report", preparing: true })).toBe(true);
    expect(isWaiting({ step: "report", preparing: false })).toBe(false);
    expect(isWaiting({ step: "draft", preparing: false })).toBe(false);
  });
  it("first names", () => {
    expect(firstName("Ayesha Bibi")).toBe("Ayesha");
    expect(firstName("")).toBe("the teacher");
  });
});

describe("sendObservation / sendTalk", () => {
  const api = () => ({
    presignObserveUpload: vi.fn(async ({ kind }: any) => ({ key: `${kind}-k`, uploadUrl: "u", contentType: "audio/mp4" })),
    startObservation: vi.fn().mockResolvedValue({ coachingSessionId: "cs-1" }),
    startTalk: vi.fn().mockResolvedValue({ success: true }),
  });
  const upload = { uploadToR2: vi.fn().mockResolvedValue(undefined) };

  it("uploads through the coach's presign and starts for the named teacher", async () => {
    const a = api();
    const out = await sendObservation({
      teacherExtId: "9231", schoolExtId: "niete:7", audio: { blob: new Blob(["a"]), filename: "l.m4a" }, plan: null, photos: [],
    }, a as any, upload as any);
    expect(out).toEqual({ coachingSessionId: "cs-1" });
    expect(a.presignObserveUpload).toHaveBeenCalledWith({ filename: "l.m4a", sizeBytes: 1, kind: "audio" });
    expect(a.startObservation).toHaveBeenCalledWith({ key: "audio-k", photoKeys: [], teacherExtId: "9231", schoolExtId: "niete:7" });
  });

  it("a talk: one upload, then attached", async () => {
    const a = api();
    await sendTalk("cs-1", { blob: new Blob(["a"]), filename: "t.m4a" }, a as any, upload as any);
    expect(a.startTalk).toHaveBeenCalledWith("cs-1", "audio-k");
  });

  it("a refused talk is 'refused', a dropped one is 'network'", async () => {
    const a = api();
    a.startTalk.mockRejectedValueOnce({ response: { status: 409 } });
    await expect(sendTalk("cs-1", { blob: new Blob(["a"]), filename: "t.m4a" }, a as any, upload as any)).rejects.toMatchObject({ kind: "refused" });
    a.presignObserveUpload.mockRejectedValueOnce(new Error("offline"));
    await expect(sendTalk("cs-1", { blob: new Blob(["a"]), filename: "t.m4a" }, a as any, upload as any)).rejects.toMatchObject({ kind: "network" });
  });
});
