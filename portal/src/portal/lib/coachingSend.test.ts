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
