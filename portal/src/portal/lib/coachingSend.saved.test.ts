import { createHash } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendLesson, SendError } from "./coachingSend";
import { sha256Hex, HASH_MAX_BYTES } from "./audioHash";

// bd-c5reix — a recording she sent on WhatsApp is already in R2 (the bot saved it for the app). Sending it uploads
// nothing for the audio: the analysis starts from its key. A key that was already sent is 409 already_sent.

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
const SAVED = "classroom_audio/u1/2026-10/portal_wa-0123456789abcdef-b2c3.ogg";

let a: ReturnType<typeof api>;
beforeEach(() => { a = api(); });

describe("sendLesson — a saved recording", () => {
  it("starts from its key: no audio presign, no audio upload", async () => {
    const pct: number[] = [];
    const out = await sendLesson({ audio: { key: SAVED }, plan: null, photos: [] }, a as never, (p) => pct.push(p));
    expect(a.presignCoachingUpload).not.toHaveBeenCalled();
    expect(a.uploadToR2).not.toHaveBeenCalled();
    expect(a.startCoachingUpload).toHaveBeenCalledWith({ key: SAVED, photoKeys: [] });
    expect(out).toEqual({ coachingSessionId: "cs-9" });
    expect(pct[pct.length - 1]).toBe(100);
  });

  it("her plan file and photos still upload; only the audio is skipped", async () => {
    const photo = new File(["p"], "board.jpg");
    await sendLesson({ audio: { key: SAVED }, plan: { kind: "file", file: new File(["lp"], "plan.pdf") }, photos: [photo] }, a as never);
    expect(a.presignCoachingUpload.mock.calls.map((c) => c[0].kind)).toEqual(["lesson_plan", "photo"]);
    expect(a.startCoachingUpload).toHaveBeenCalledWith({ key: SAVED, lessonPlanKey: "lesson_plan/1-plan.pdf", photoKeys: ["photo/2-board.jpg"] });
  });

  it("409 already_sent: SendError already_sent, carrying the session that holds it", async () => {
    a.startCoachingUpload.mockRejectedValue({ response: { status: 409, data: { status: "already_sent", coachingSessionId: "cs-first" } } });
    const err = await sendLesson({ audio: { key: SAVED }, plan: null, photos: [] }, a as never, undefined, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.kind).toBe("already_sent");
    expect(err.coachingSessionId).toBe("cs-first");
  });
});

describe("sha256Hex — the bytes' hash, as the bot's dedupe takes it", () => {
  it("is the sha256 of the file's bytes, lower-case hex", async () => {
    const f = new File(["same lesson"], "lesson.m4a");
    expect(await sha256Hex(f)).toBe(createHash("sha256").update("same lesson").digest("hex"));
  });

  it("above the cap, or empty, there is no answer (the server's dedupe still stands)", async () => {
    expect(await sha256Hex(new Blob([]))).toBeNull();
    expect(await sha256Hex(new Blob(["abc"]), 2)).toBeNull();
    expect(HASH_MAX_BYTES).toBeGreaterThanOrEqual(40 * 1024 * 1024); // a 45-minute m4a fits
  });
});
