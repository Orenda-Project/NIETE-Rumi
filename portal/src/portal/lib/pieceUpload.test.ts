import { createHash } from "crypto";
import { describe, it, expect, vi } from "vitest";
import {
  sendInPieces, choosePieceBytes, memoryMemo, PiecesUnavailable, RETRY_WAITS_MS,
  type PiecesApi, type PutPiece,
} from "./pieceUpload";
import { readBytes } from "./audioHash";

// bd-q261rec (queue #261) — a recording goes up in pieces that RESUME. Production 25 Nov: four failed sends of one
// recording on a weak line, each from byte 0. Now: the file goes up as byte pieces; a drop waits and goes on from the
// next piece the server does not have; a killed app, reopened, asks the server what it holds and sends only the rest;
// the bot joins the pieces into one file, byte-identical to the phone's.

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytesOf = async (b: Blob) => new Uint8Array(await readBytes(b));

function randomBlob(size: number, type = "audio/webm") {
  const a = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) a[i] = (i * 7919 + 13) % 251;
  return new Blob([a], { type });
}

/** A fake server: holds pieces per key, joins them, and can be told to fail. */
function server() {
  const pieces = new Map<string, Map<number, Uint8Array>>();
  const joined = new Map<string, Uint8Array>();
  let n = 0;
  const api: PiecesApi & { calls: string[] } = {
    calls: [],
    begin: vi.fn(async ({ sizeBytes, pieceBytes, key }) => {
      api.calls.push(`begin${key ? ":" + key : ""}`);
      const k = key || `classroom_audio/u/2026-11/portal_${(n += 1)}.webm`;
      if (!pieces.has(k)) pieces.set(k, new Map());
      const count = Math.ceil(sizeBytes / pieceBytes);
      if (joined.has(k)) return { key: k, contentType: "audio/webm", pieceBytes, pieces: count, have: [], joined: true };
      const have = [...pieces.get(k)!.entries()]
        .filter(([i, b]) => b.length === (i === count - 1 ? sizeBytes - pieceBytes * (count - 1) : pieceBytes))
        .map(([i]) => i).sort((x, y) => x - y);
      return { key: k, contentType: "audio/webm", pieceBytes, pieces: count, have, joined: false };
    }),
    sign: vi.fn(async ({ key, pieces: ns }) => ({
      contentType: "application/octet-stream",
      urls: ns.map((i: number) => ({ n: i, url: `put://${key}#${i}` })),
    })),
    join: vi.fn(async ({ key, sizeBytes, pieceBytes, digests }) => {
      api.calls.push("join");
      if (joined.has(key)) return { key, sizeBytes };
      const held = pieces.get(key)!;
      const count = Math.ceil(sizeBytes / pieceBytes);
      const missing = [];
      for (let i = 0; i < count; i += 1) if (!held.has(i)) missing.push(i);
      if (missing.length) throw Object.assign(new Error("400"), { response: { status: 400, data: { reason: "pieces_missing", missing } } });
      const bad = (digests || []).map((d: string, i: number) => (d && sha(held.get(i)!) !== d ? i : -1)).filter((i: number) => i >= 0);
      if (bad.length) {
        bad.forEach((i: number) => held.delete(i));
        throw Object.assign(new Error("400"), { response: { status: 400, data: { reason: "pieces_mismatch", bad } } });
      }
      const all = new Uint8Array(sizeBytes);
      let at = 0;
      for (let i = 0; i < count; i += 1) { all.set(held.get(i)!, at); at += held.get(i)!.length; }
      joined.set(key, all);
      pieces.delete(key);
      return { key, sizeBytes, sha256: sha(all) };
    }),
  };
  const puts: number[] = [];
  let failAt: Set<number> = new Set();
  const put: PutPiece = vi.fn(async (url, body, _type, onProgress) => {
    const [key, i] = url.replace("put://", "").split("#");
    const idx = Number(i);
    puts.push(idx);
    if (failAt.has(puts.length)) { onProgress?.(Math.floor(body.size / 2)); throw new Error("upload failed (network)"); }
    pieces.get(key)!.set(idx, await bytesOf(body));
    onProgress?.(body.size);
  });
  return { api, put, puts, joined, pieces, failOnPut: (...nth: number[]) => { failAt = new Set(nth); } };
}

const noWait = () => Promise.resolve();
const PIECE = 64 * 1024;

describe("sendInPieces", () => {
  it("sends every piece once, joins, and the joined file is byte-identical to the phone's", async () => {
    const s = server();
    const blob = randomBlob(5 * PIECE + 123);
    const seen: number[] = [];
    const key = await sendInPieces(blob, "lesson.webm", {
      api: s.api, put: s.put, memo: memoryMemo(), sleep: noWait, pieceBytes: PIECE, onProgress: (l) => seen.push(l),
    });
    expect(s.puts).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sha(s.joined.get(key)!)).toBe(sha(await bytesOf(blob)));
    expect(seen[seen.length - 1]).toBe(blob.size);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
  });

  it("sends each piece's sha256 with the join", async () => {
    const s = server();
    const blob = randomBlob(2 * PIECE + 5);
    await sendInPieces(blob, "lesson.webm", { api: s.api, put: s.put, memo: memoryMemo(), sleep: noWait, pieceBytes: PIECE });
    const digests = (s.api.join as ReturnType<typeof vi.fn>).mock.calls[0][0].digests;
    const b = await bytesOf(blob);
    expect(digests).toEqual([0, 1, 2].map((i) => sha(b.subarray(i * PIECE, Math.min((i + 1) * PIECE, b.length)))));
  });

  it("a dropped piece waits, asks again what the server holds, and goes on from there (never from zero)", async () => {
    const s = server();
    const blob = randomBlob(6 * PIECE);
    s.failOnPut(4); // the 4th PUT (piece 3) drops
    const waits: number[] = [];
    const key = await sendInPieces(blob, "lesson.webm", {
      api: s.api, put: s.put, memo: memoryMemo(), sleep: async (ms) => { waits.push(ms); }, pieceBytes: PIECE,
    });
    expect(s.puts).toEqual([0, 1, 2, 3, 3, 4, 5]);
    expect(waits).toEqual([RETRY_WAITS_MS[0]]);
    expect(s.api.calls.filter((c) => c.startsWith("begin"))).toEqual(["begin", `begin:${key}`]);
    expect(sha(s.joined.get(key)!)).toBe(sha(await bytesOf(blob)));
  });

  it("a killed send, started again with the same recording, sends only the pieces the server does not have", async () => {
    const s = server();
    const memo = memoryMemo();
    const blob = randomBlob(5 * PIECE + 1);
    s.failOnPut(3);
    // first run: two pieces arrive, then the line dies and every wait runs out (the app is "killed" here)
    await expect(sendInPieces(blob, "lesson.webm", {
      api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE, waits: [],
    })).rejects.toThrow();
    expect(s.puts).toEqual([0, 1, 2]);
    s.failOnPut();
    // reopened: a NEW Blob over the same bytes (rebuilt from the phone's copy)
    const again = new Blob([await readBytes(blob)], { type: blob.type });
    const key = await sendInPieces(again, "lesson.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    expect(s.puts).toEqual([0, 1, 2, 2, 3, 4, 5]);
    expect(sha(s.joined.get(key)!)).toBe(sha(await bytesOf(blob)));
  });

  it("the same in-app recording rebuilt with a new header (or grown by a resume): only the changed and new pieces go", async () => {
    const s = server();
    const memo = memoryMemo();
    const first = await bytesOf(randomBlob(6 * PIECE));
    s.failOnPut(5); // pieces 0-3 arrive, then the app is killed
    await expect(sendInPieces(new Blob([first]), "lesson.webm", {
      api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE, waits: [], identity: "rec:r-1",
    })).rejects.toThrow();
    s.failOnPut();
    // reopened: the header is rewritten (its duration) and she recorded 1 more piece
    const again = new Uint8Array(7 * PIECE);
    again.set(first);
    again[10] ^= 0xff;
    for (let i = 6 * PIECE; i < again.length; i += 1) again[i] = 7;
    const key = await sendInPieces(new Blob([again]), "lesson.webm", {
      api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE, identity: "rec:r-1",
    });
    expect(s.puts.slice(5)).toEqual([4, 5, 6, 0]);
    expect(sha(s.joined.get(key)!)).toBe(sha(again));
  });

  it("a different recording never picks up another's pieces", async () => {
    const s = server();
    const memo = memoryMemo();
    const a = randomBlob(2 * PIECE);
    const b = new Blob([new Uint8Array(2 * PIECE).fill(9)], { type: "audio/webm" });
    const ka = await sendInPieces(a, "a.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    const kb = await sendInPieces(b, "b.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    expect(kb).not.toBe(ka);
    expect(sha(s.joined.get(kb)!)).toBe(sha(await bytesOf(b)));
  });

  it("a join that names missing pieces sends just those and joins again", async () => {
    const s = server();
    const blob = randomBlob(4 * PIECE);
    const realPut = s.put;
    let dropped = false;
    // piece 2's PUT "succeeds" on the phone but never lands on the server
    const put: PutPiece = async (url, body, type, onProgress) => {
      if (!dropped && url.endsWith("#2")) { dropped = true; onProgress?.(body.size); return; }
      return realPut(url, body, type, onProgress);
    };
    const key = await sendInPieces(blob, "lesson.webm", { api: s.api, put, memo: memoryMemo(), sleep: noWait, pieceBytes: PIECE });
    expect(s.api.calls.filter((c) => c === "join")).toHaveLength(2);
    expect(sha(s.joined.get(key)!)).toBe(sha(await bytesOf(blob)));
  });

  it("already joined (the answer was lost): nothing is sent again", async () => {
    const s = server();
    const memo = memoryMemo();
    const blob = randomBlob(2 * PIECE);
    const key = await sendInPieces(blob, "lesson.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    const before = s.puts.length;
    const again = await sendInPieces(blob, "lesson.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    expect(again).toBe(key);
    expect(s.puts.length).toBe(before);
  });

  it("a line that keeps moving never gives up: each piece that arrives resets the waits", async () => {
    const s = server();
    const blob = randomBlob(6 * PIECE);
    s.failOnPut(2, 4, 6, 8); // every other PUT drops
    const waits: number[] = [];
    await sendInPieces(blob, "lesson.webm", {
      api: s.api, put: s.put, memo: memoryMemo(), sleep: async (ms) => { waits.push(ms); }, pieceBytes: PIECE, waits: [10, 20],
    });
    expect(waits).toEqual([10, 10, 10, 10]);
  });

  it("a dead line gives up after the last wait, and keeps what arrived for Try again", async () => {
    const s = server();
    const memo = memoryMemo();
    const blob = randomBlob(3 * PIECE);
    s.failOnPut(2, 3, 4);
    const waits: number[] = [];
    const onWait = vi.fn();
    await expect(sendInPieces(blob, "lesson.webm", {
      api: s.api, put: s.put, memo, sleep: async (ms) => { waits.push(ms); }, pieceBytes: PIECE, waits: [10, 20], onWait,
    })).rejects.toThrow(/network/);
    expect(waits).toEqual([10, 20]);
    expect(onWait).toHaveBeenCalledWith(expect.objectContaining({ ms: 10, sent: 1, pieces: 3 }));
    expect(s.pieces.size).toBe(1); // piece 0 is still on the server
  });

  it("our API refusing (a 4xx) is not retried", async () => {
    const s = server();
    (s.api.begin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("400"), { response: { status: 400, data: { reason: "not_audio" } } }));
    const sleep = vi.fn(noWait);
    await expect(sendInPieces(randomBlob(10), "x.webm", { api: s.api, put: s.put, memo: memoryMemo(), sleep, pieceBytes: PIECE }))
      .rejects.toMatchObject({ response: { status: 400 } });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a remembered key the server no longer accepts is forgotten and the send starts fresh", async () => {
    const s = server();
    const memo = memoryMemo();
    const blob = randomBlob(PIECE);
    await sendInPieces(blob, "a.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    s.joined.clear();
    (s.api.begin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("400"), { response: { status: 400, data: { reason: "not_yours" } } }));
    const key = await sendInPieces(blob, "a.webm", { api: s.api, put: s.put, memo, sleep: noWait, pieceBytes: PIECE });
    expect(sha(s.joined.get(key)!)).toBe(sha(await bytesOf(blob)));
  });

  it("the pieces routes missing (an old server) is PiecesUnavailable, so the caller sends the old way", async () => {
    const s = server();
    (s.api.begin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("404"), { response: { status: 404 } }));
    await expect(sendInPieces(randomBlob(10), "x.webm", { api: s.api, put: s.put, memo: memoryMemo(), sleep: noWait, pieceBytes: PIECE }))
      .rejects.toBeInstanceOf(PiecesUnavailable);
  });

  it("a wait ends early when the phone comes back online (wake)", async () => {
    const s = server();
    const blob = randomBlob(2 * PIECE);
    s.failOnPut(2);
    const started = Date.now();
    let done = false;
    const p = sendInPieces(blob, "lesson.webm", { api: s.api, put: s.put, memo: memoryMemo(), pieceBytes: PIECE, waits: [60_000] })
      .finally(() => { done = true; });
    // "back online" until it has gone on (on a loaded machine the wait may start after the first event)
    while (!done && Date.now() - started < 4_000) {
      window.dispatchEvent(new Event("online"));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 25); });
    }
    await p;
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("choosePieceBytes", () => {
  it("about a minute of a weak line each: 256 KB for a short in-app lesson, more for a big file, never over 100 pieces", () => {
    expect(choosePieceBytes(4_700_000)).toBe(256 * 1024);
    const big = choosePieceBytes(40 * 1024 * 1024);
    expect(big % (64 * 1024)).toBe(0);
    expect(Math.ceil((40 * 1024 * 1024) / big)).toBeLessThanOrEqual(100);
    expect(choosePieceBytes(300 * 1024 * 1024)).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
