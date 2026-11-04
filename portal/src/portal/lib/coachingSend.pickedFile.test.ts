import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendLesson, SendError } from "./coachingSend";

/**
 * bd-bmc9a0.1 — ICT IAB rows 28–29: Submit said "No internet" on strong Wi-Fi.
 *
 * Production logs (dc_upload.failed, 21–28 Oct): 1,538 failures from 39 teachers in the Android app failed in under a
 * second, on the SAME picked file, for hours or days. The same bytes then went through from WhatsApp's browser, and the
 * app's own recordings (a Blob the page made) went through from the same app. The page PUT the picked File itself; the
 * app's WebView re-opens a picked file's handle to send it, and for some files that request dies before a byte leaves.
 *
 * So: a picked file is never sent as itself — an in-memory copy of its bytes is. A failure says which part and whether
 * the phone was offline (only then is it "No internet"). Try again re-sends only what did not arrive.
 */

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

function text(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

/** A picked file the phone cannot read (the read rejects as the WebView does). */
function unreadable(name: string, type: string): File {
  const f = new File(["x".repeat(20)], name, { type });
  const fail = () => Promise.reject(Object.assign(new Error("The file could not be read"), { name: "NotReadableError" }));
  Object.defineProperty(f, "arrayBuffer", { value: fail });
  return f;
}

let a: ReturnType<typeof api>;
let online = true;
beforeEach(() => {
  a = api();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("a picked file is never sent as itself (bd-bmc9a0.1)", () => {
  it("a picked recording, plan and photo are PUT as in-memory copies: same bytes, same type, not the File", async () => {
    const ogg = new File(["OggS-the-lesson"], "a.ogg", { type: "audio/ogg" });
    const plan = new File(["%PDF-plan"], "plan.pdf", { type: "application/pdf" });
    const photo = new File(["jpeg-board"], "board.jpg", { type: "image/jpeg" });
    await sendLesson({ audio: { blob: ogg, filename: "a.ogg" }, plan: { kind: "file", file: plan }, photos: [photo] }, a as never);

    expect(a.uploadToR2).toHaveBeenCalledTimes(3);
    const sent = a.uploadToR2.mock.calls.map((c) => c[1] as Blob);
    for (const [i, original] of [ogg, plan, photo].entries()) {
      expect(sent[i]).not.toBeInstanceOf(File);
      expect(sent[i].size).toBe(original.size);
      expect(sent[i].type).toBe(original.type);
      expect(await text(sent[i])).toBe(await text(original));
    }
  });

  it("a recording made in the app (a Blob the page built) is sent as it is", async () => {
    const recording = new Blob(["webm-bytes"], { type: "audio/webm" });
    await sendLesson({ audio: { blob: recording, filename: "Lesson.webm" }, plan: null, photos: [] }, a as never);
    expect(a.uploadToR2.mock.calls[0][1]).toBe(recording);
  });

  it("a picked file the phone cannot read: nothing is uploaded for it, and the error says so (not the internet)", async () => {
    const report = vi.fn();
    const err = await sendLesson({ audio: { blob: unreadable("a.ogg", "audio/ogg"), filename: "a.ogg" }, plan: null, photos: [] },
      a as never, undefined, report).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.kind).toBe("network");
    expect(err.detail).toEqual({ part: { kind: "audio", photo: 0 }, offline: false, unreadable: true });
    expect(a.presignCoachingUpload).not.toHaveBeenCalled();
    expect(a.uploadToR2).not.toHaveBeenCalled();
    expect(report.mock.calls[0][0]).toEqual(expect.objectContaining({ stage: "read", kind: "audio", item: 1, reason: "unreadable", sentBytes: 0 }));
  });
});

describe("a failure names its part and whether the phone was offline (bd-bmc9a0.1)", () => {
  const photo = (n: number) => new File(["p".repeat(n)], `p${n}.jpg`, { type: "image/jpeg" });

  it("photo 2 of 3 fails while online: part photo 2, offline false", async () => {
    let put = 0;
    a.uploadToR2.mockImplementation(async () => { put += 1; if (put === 3) throw new Error("upload failed (network)"); });
    const recording = new Blob(["0123456789"], { type: "audio/webm" });
    const err = await sendLesson({ audio: { blob: recording, filename: "L.webm" }, plan: null, photos: [photo(4), photo(5), photo(6)] }, a as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.kind).toBe("network");
    expect(err.detail).toEqual({ part: { kind: "photo", photo: 2 }, offline: false, unreadable: false });
  });

  it("the recording fails with the phone offline: offline true (the only case that is 'No internet')", async () => {
    online = false;
    a.uploadToR2.mockRejectedValueOnce(new Error("upload failed (network)"));
    const err = await sendLesson({ audio: { blob: new Blob(["abc"]), filename: "L.webm" }, plan: null, photos: [] }, a as never)
      .catch((e) => e);
    expect(err.detail).toEqual({ part: { kind: "audio", photo: 0 }, offline: true, unreadable: false });
  });

  it("starting the analysis fails: no part, still a network failure", async () => {
    a.startCoachingUpload.mockRejectedValueOnce({ response: { status: 502, data: {} } });
    const err = await sendLesson({ audio: { blob: new Blob(["abc"]), filename: "L.webm" }, plan: null, photos: [] }, a as never)
      .catch((e) => e);
    expect(err.kind).toBe("network");
    expect(err.detail).toEqual({ part: null, offline: false, unreadable: false });
  });

  it("the report says how much of the part left the phone, whether it was online, and what was sent", async () => {
    a.uploadToR2.mockImplementationOnce(async (_u: string, _b: Blob, _t: string, onProgress?: (l: number, t: number) => void) => {
      onProgress?.(3, 10);
      throw new Error("upload failed (network)");
    });
    const report = vi.fn();
    const ogg = new File(["0123456789"], "a.ogg", { type: "audio/ogg; codecs=opus" });
    await sendLesson({ audio: { blob: ogg, filename: "a.ogg" }, plan: null, photos: [] }, a as never, undefined, report).catch(() => null);
    expect(report.mock.calls[0][0]).toEqual(expect.objectContaining({
      stage: "upload", kind: "audio", sentBytes: 3, online: true, sentAs: "copy", type: "audio/ogg",
    }));
  });
});

describe("Try again re-sends only what did not arrive (bd-bmc9a0.1)", () => {
  it("the recording arrived, photo 1 did not: the second Submit uploads only the photo and starts with the first key", async () => {
    const uploaded = new WeakMap<Blob, string>();
    const recording = new Blob(["0123456789"], { type: "audio/webm" });
    const photo = new File(["board"], "board.jpg", { type: "image/jpeg" });
    a.uploadToR2
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => { throw new Error("upload failed (network)"); });
    await expect(sendLesson({ audio: { blob: recording, filename: "L.webm" }, plan: null, photos: [photo], uploaded }, a as never))
      .rejects.toBeInstanceOf(SendError);
    expect(a.presignCoachingUpload).toHaveBeenCalledTimes(2);

    a.presignCoachingUpload.mockClear();
    a.uploadToR2.mockClear();
    await sendLesson({ audio: { blob: recording, filename: "L.webm" }, plan: null, photos: [photo], uploaded }, a as never);
    expect(a.presignCoachingUpload).toHaveBeenCalledTimes(1);
    expect(a.presignCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "photo" }));
    expect(a.startCoachingUpload).toHaveBeenCalledWith({ key: "audio/1-L.webm", photoKeys: ["photo/3-board.jpg"] });
  });
});
