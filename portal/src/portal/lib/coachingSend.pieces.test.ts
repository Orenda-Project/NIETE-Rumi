import { describe, it, expect, vi } from "vitest";
import { sendLesson, SendError } from "./coachingSend";
import { sendTalk } from "./coachObserve";
import { memoryMemo, type PiecesApi } from "./pieceUpload";

// bd-q261rec (queue #261) — with portal_upload_pieces on for her, the RECORDING goes up in pieces that resume (her plan
// and photos, small, go as before); the start reads the joined key. Off, or on an older server (no pieces routes), the
// recording goes as one PUT, exactly as before.

function piecesApi(): PiecesApi & { begin: ReturnType<typeof vi.fn>; sign: ReturnType<typeof vi.fn>; join: ReturnType<typeof vi.fn> } {
  return {
    begin: vi.fn(async ({ sizeBytes, pieceBytes }) => ({
      key: "classroom_audio/u/2026-11/portal_p1.webm", contentType: "audio/webm", pieceBytes, pieces: Math.ceil(sizeBytes / pieceBytes), have: [], joined: false,
    })),
    sign: vi.fn(async ({ pieces }) => ({ contentType: "application/octet-stream", urls: pieces.map((n: number) => ({ n, url: `put://${n}` })) })),
    join: vi.fn(async ({ key, sizeBytes }) => ({ key, sizeBytes })),
  };
}

function api(pieces?: PiecesApi) {
  let n = 0;
  return {
    presignCoachingUpload: vi.fn(async ({ kind, filename }: { kind: string; filename: string }) => {
      n += 1;
      return { key: `${kind}/${n}-${filename}`, uploadUrl: `https://r2/put/${n}`, contentType: "x/y" };
    }),
    uploadToR2: vi.fn(async (_u: string, blob: Blob, _t: string, onProgress?: (l: number, t: number) => void) => { onProgress?.(blob.size, blob.size); }),
    startCoachingUpload: vi.fn().mockResolvedValue({ coachingSessionId: "cs-1" }),
    ...(pieces ? { pieces } : {}),
  };
}

const audio = () => ({ blob: new Blob([new Uint8Array(300 * 1024).fill(3)], { type: "audio/webm" }), filename: "lesson.webm" });
const put = vi.fn(async (_u: string, body: Blob, _t: string, onProgress?: (l: number) => void) => { onProgress?.(body.size); });
const opts = { memo: memoryMemo(), put, sleep: () => Promise.resolve(), pieceBytes: 64 * 1024 };

describe("sendLesson — the recording in pieces", () => {
  it("on: the recording goes in pieces, the photo as before, and the start reads the joined key", async () => {
    const p = piecesApi();
    const a = api(p);
    const photo = new File(["p"], "board.jpg");
    const pct: number[] = [];
    await sendLesson({ audio: audio(), plan: null, photos: [photo], piecesOn: true, pieceOptions: opts }, a as never, (x) => pct.push(x));
    expect(p.begin).toHaveBeenCalledTimes(1);
    expect(p.join).toHaveBeenCalledTimes(1);
    expect(a.presignCoachingUpload).toHaveBeenCalledTimes(1);
    expect(a.presignCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "photo" }));
    expect(a.startCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ key: "classroom_audio/u/2026-11/portal_p1.webm" }));
    expect(pct[pct.length - 1]).toBe(100);
  });

  it("an in-app recording is found again by its recording id (its header may be rewritten when rebuilt)", async () => {
    const p = piecesApi();
    const memo = memoryMemo();
    await sendLesson({ audio: { ...audio(), recordingId: "rec-77" }, plan: null, photos: [], piecesOn: true, pieceOptions: { ...opts, memo } }, api(p) as never);
    expect(memo.get("id:rec:rec-77")).toMatchObject({ key: "classroom_audio/u/2026-11/portal_p1.webm" });
  });

  it("off: one PUT of the whole recording, as before (pieces never asked)", async () => {
    const p = piecesApi();
    const a = api(p);
    await sendLesson({ audio: audio(), plan: null, photos: [], piecesOn: false }, a as never);
    expect(p.begin).not.toHaveBeenCalled();
    expect(a.presignCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio" }));
  });

  it("an older server (no pieces routes, 404): the recording goes as one PUT instead", async () => {
    const p = piecesApi();
    p.begin.mockRejectedValueOnce(Object.assign(new Error("404"), { response: { status: 404 } }));
    const a = api(p);
    await sendLesson({ audio: audio(), plan: null, photos: [], piecesOn: true, pieceOptions: opts }, a as never);
    expect(a.presignCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio" }));
    expect(a.startCoachingUpload).toHaveBeenCalledWith(expect.objectContaining({ key: "audio/1-lesson.webm" }));
  });

  it("a weak line: she is told it waits, then it goes on", async () => {
    const p = piecesApi();
    const a = api(p);
    let n = 0;
    const flaky = vi.fn(async (_u: string, body: Blob, _t: string, onProgress?: (l: number) => void) => {
      n += 1;
      if (n === 2) throw new Error("upload failed (network)");
      onProgress?.(body.size);
    });
    const onWait = vi.fn();
    await sendLesson({
      audio: audio(), plan: null, photos: [], piecesOn: true, onWait,
      pieceOptions: { ...opts, put: flaky },
    }, a as never);
    expect(onWait).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, pieces: 5 }));
    expect(a.startCoachingUpload).toHaveBeenCalled();
  });

  it("a dead line: the usual network failure for the recording, every failed try reported", async () => {
    const p = piecesApi();
    const a = api(p);
    const dead = vi.fn(async () => { throw new Error("upload failed (network)"); });
    const report = vi.fn();
    const err = await sendLesson({
      audio: audio(), plan: null, photos: [], piecesOn: true, pieceOptions: { ...opts, put: dead, waits: [1, 1] },
    }, a as never, undefined, report).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.kind).toBe("network");
    expect(err.detail.part).toEqual({ kind: "audio", photo: 0 });
    expect(report).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ stage: "upload", kind: "audio", sentAs: "pieces" }));
    expect(a.startCoachingUpload).not.toHaveBeenCalled();
  });
});

describe("sendTalk — the debrief talk in pieces", () => {
  it("on: the talk goes in pieces and the joined key starts the talk", async () => {
    const p = piecesApi();
    const obs = {
      presignObserveUpload: vi.fn(), startObservation: vi.fn(), startTalk: vi.fn().mockResolvedValue({}), observePieces: p,
    };
    await sendTalk("cs-1", audio(), obs as never, { uploadToR2: vi.fn() } as never, undefined, { piecesOn: true, pieceOptions: opts });
    expect(obs.presignObserveUpload).not.toHaveBeenCalled();
    expect(obs.startTalk).toHaveBeenCalledWith("cs-1", "classroom_audio/u/2026-11/portal_p1.webm");
  });

  it("off: one PUT, as before", async () => {
    const p = piecesApi();
    const obs = {
      presignObserveUpload: vi.fn().mockResolvedValue({ key: "k1", uploadUrl: "u", contentType: "audio/webm" }),
      startObservation: vi.fn(), startTalk: vi.fn().mockResolvedValue({}), observePieces: p,
    };
    const up = { uploadToR2: vi.fn().mockResolvedValue(undefined) };
    await sendTalk("cs-1", audio(), obs as never, up as never, undefined, { piecesOn: false });
    expect(p.begin).not.toHaveBeenCalled();
    expect(obs.startTalk).toHaveBeenCalledWith("cs-1", "k1");
  });
});
