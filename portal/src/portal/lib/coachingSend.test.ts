import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendLesson, SendError } from "./coachingSend";

// bd-5rz1v — "Send to Digital Coach": every file goes straight to R2, then the
// analysis starts. Nothing is started unless EVERY file arrived. A lesson plan
// is either a file (her own plan, or a photo of it) or a library pick — the
// pick travels as `lessonPlan`, and the bot links it as WhatsApp does.

function api() {
  let n = 0;
  return {
    presignCoachingUpload: vi.fn(async ({ kind, filename }: { kind: string; filename: string }) => {
      n += 1;
      return { key: `${kind}/${n}-${filename}`, uploadUrl: `https://r2/put/${n}`, contentType: "x/y" };
    }),
    uploadToR2: vi.fn(async (_url: string, blob: Blob, _type: string, onProgress?: (l: number, t: number) => void) => {
      onProgress?.(blob.size, blob.size);
    }),
    startCoachingUpload: vi.fn().mockResolvedValue({ coachingSessionId: "cs-9" }),
  };
}

const audio = { blob: new Blob(["0123456789"]), filename: "Lesson 2 Oct.webm" };

let a: ReturnType<typeof api>;
beforeEach(() => { a = api(); });

describe("sendLesson", () => {
  it("uploads the recording and starts the analysis", async () => {
    const out = await sendLesson({ audio, plan: null, photos: [] }, a as never);

    expect(a.presignCoachingUpload).toHaveBeenCalledWith({ filename: "Lesson 2 Oct.webm", sizeBytes: 10, kind: "audio" });
    expect(a.startCoachingUpload).toHaveBeenCalledWith({ key: "audio/1-Lesson 2 Oct.webm", photoKeys: [] });
    expect(out).toEqual({ coachingSessionId: "cs-9" });
  });

  it("bd-fmf24g.9 — the class she picked travels with the recording; without one nothing is added", async () => {
    await sendLesson({ audio, plan: null, photos: [], teacherClass: { grade: 4, subject: "General Science", subjectKey: "science" } }, a as never);
    expect(a.startCoachingUpload).toHaveBeenCalledWith({
      key: "audio/1-Lesson 2 Oct.webm", photoKeys: [], teacherClass: { grade: 4, subject: "General Science", subjectKey: "science" },
    });
    a = api();
    await sendLesson({ audio, plan: null, photos: [], teacherClass: null }, a as never);
    expect(a.startCoachingUpload.mock.calls[0][0]).not.toHaveProperty("teacherClass");
  });

  it("bd-v0toag.31 — sendLesson passes liveMoves when present", async () => {
    const liveMoves = { lessonId: "L1", stamp: "s1", liveId: "live-1", moves: [{ idx: 0, covers: [], tickedAtMs: 5000 }], taps: [], drops: 0, bytesSent: 9 };
    await sendLesson({ audio, plan: null, photos: [], liveMoves }, a as never);
    expect(a.startCoachingUpload).toHaveBeenCalledWith({ key: "audio/1-Lesson 2 Oct.webm", photoKeys: [], liveMoves });
    a = api();
    await sendLesson({ audio, plan: null, photos: [] }, a as never);
    expect(a.startCoachingUpload.mock.calls[0][0]).not.toHaveProperty("liveMoves");
  });

  it("a library pick is sent as lessonPlan, with nothing uploaded for it", async () => {
    await sendLesson({ audio, plan: { kind: "library", pick: { lessonId: "g4-sst-ch3-seg2" } }, photos: [] }, a as never);
    expect(a.presignCoachingUpload).toHaveBeenCalledTimes(1);
    expect(a.startCoachingUpload).toHaveBeenCalledWith({
      key: "audio/1-Lesson 2 Oct.webm", photoKeys: [], lessonPlan: { lessonId: "g4-sst-ch3-seg2" },
    });
  });

  it("a plan file (or a photo of her plan) is uploaded as the lesson plan", async () => {
    const planPhoto = new File(["img"], "IMG_0042.jpg");
    await sendLesson({ audio, plan: { kind: "file", file: planPhoto }, photos: [] }, a as never);
    expect(a.presignCoachingUpload).toHaveBeenCalledWith({ filename: "IMG_0042.jpg", sizeBytes: 3, kind: "lesson_plan" });
    expect(a.startCoachingUpload).toHaveBeenCalledWith({
      key: "audio/1-Lesson 2 Oct.webm", lessonPlanKey: "lesson_plan/2-IMG_0042.jpg", photoKeys: [],
    });
  });

  it("board photos are uploaded and listed", async () => {
    await sendLesson({ audio, plan: null, photos: [new File(["p"], "a.jpg"), new File(["q"], "b.png")] }, a as never);
    expect(a.startCoachingUpload).toHaveBeenCalledWith({
      key: "audio/1-Lesson 2 Oct.webm", photoKeys: ["photo/2-a.jpg", "photo/3-b.png"],
    });
  });

  it("reports progress over all the bytes, ending at 100", async () => {
    const seen: number[] = [];
    await sendLesson({ audio, plan: { kind: "file", file: new File(["1234567890"], "p.pdf") }, photos: [] },
      a as never, (pct) => seen.push(pct));
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen).toContain(50);
  });

  it("starts nothing if an upload fails, and says the network is to blame", async () => {
    a.uploadToR2.mockRejectedValueOnce(new Error("upload failed (network)"));
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never)).rejects.toMatchObject({ kind: "network" });
    expect(a.startCoachingUpload).not.toHaveBeenCalled();
  });

  it("one lesson already being analysed is its own answer, with that lesson's id", async () => {
    a.startCoachingUpload.mockRejectedValue({ response: { status: 409, data: { status: "in_progress", coachingSessionId: "cs-1" } } });
    const err = await sendLesson({ audio, plan: null, photos: [] }, a as never).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err).toMatchObject({ kind: "in_progress", coachingSessionId: "cs-1" });
  });

  it.each([["plan_not_ready"], ["plan_not_found"]])("a lesson plan the bot cannot use (%s) is named", async (reason) => {
    a.startCoachingUpload.mockRejectedValue({ response: { status: 400, data: { status: "invalid", reason } } });
    await expect(sendLesson({ audio, plan: { kind: "library", pick: { assetId: "x" } }, photos: [] }, a as never))
      .rejects.toMatchObject({ kind: reason });
  });

  it("a server that cannot be reached is a network problem, so she can try again", async () => {
    a.startCoachingUpload.mockRejectedValue({ response: { status: 502, data: {} } });
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never)).rejects.toMatchObject({ kind: "network" });
  });
});

// bd-1d6g8o — ICT IAB row 19: Submit said "No internet" on strong Wi-Fi, and nothing recorded which file failed or why
// (the server answered every request it saw with 200). A failure is now reported — the step, the file, its size and
// type, the HTTP status or the browser's reason — and the page still gets SendError("network") as before.
describe("a failed send is reported (bd-1d6g8o)", () => {
  const photo = (n: number) => new File(["p".repeat(n)], `p${n}.jpg`, { type: "image/jpeg" });

  it("the 5th file's upload fails in the browser: reported as upload / photo / item 5 of 5 / network", async () => {
    let put = 0;
    a.uploadToR2.mockImplementation(async () => { put += 1; if (put === 5) throw new Error("upload failed (network)"); });
    const report = vi.fn();
    const planPhoto = new File(["img"], "plan.jpg", { type: "image/jpeg" });
    await expect(sendLesson({ audio, plan: { kind: "file", file: planPhoto }, photos: [photo(4), photo(5), photo(6)] }, a as never, undefined, report))
      .rejects.toEqual(new SendError("network"));
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toEqual(expect.objectContaining({
      stage: "upload", kind: "photo", item: 5, items: 5, status: null, reason: "network", sizeBytes: 6, type: "image/jpeg",
    }));
    expect(a.startCoachingUpload).not.toHaveBeenCalled();
  });

  it("storage answers 403 to the upload: reason http, status 403", async () => {
    a.uploadToR2.mockRejectedValueOnce(new Error("upload failed (403)"));
    const report = vi.fn();
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never, undefined, report)).rejects.toEqual(new SendError("network"));
    expect(report.mock.calls[0][0]).toEqual(expect.objectContaining({ stage: "upload", kind: "audio", item: 1, status: 403, reason: "http" }));
  });

  it("the server refuses the upload slot (500): stage presign", async () => {
    a.presignCoachingUpload.mockRejectedValueOnce(Object.assign(new Error("x"), { response: { status: 500 } }));
    const report = vi.fn();
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never, undefined, report)).rejects.toEqual(new SendError("network"));
    expect(report.mock.calls[0][0]).toEqual(expect.objectContaining({ stage: "presign", kind: "audio", status: 500, reason: "http" }));
  });

  it("starting the analysis fails with no answer: stage start / network", async () => {
    a.startCoachingUpload.mockRejectedValueOnce(new Error("Network Error"));
    const report = vi.fn();
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never, undefined, report)).rejects.toEqual(new SendError("network"));
    expect(report.mock.calls[0][0]).toEqual(expect.objectContaining({ stage: "start", status: null, reason: "network" }));
  });

  it("a send that succeeds reports nothing; a reporter that throws never changes the outcome", async () => {
    const report = vi.fn(() => { throw new Error("boom"); });
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never, undefined, report)).resolves.toEqual({ coachingSessionId: "cs-9" });
    expect(report).not.toHaveBeenCalled();
    a.uploadToR2.mockRejectedValueOnce(new Error("upload failed (network)"));
    await expect(sendLesson({ audio, plan: null, photos: [] }, a as never, undefined, report)).rejects.toEqual(new SendError("network"));
  });
});
