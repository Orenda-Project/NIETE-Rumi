import { describe, it, expect, vi } from "vitest";
import { holdPhoto, isHeld, readPicked, sniff, Unreadable } from "./pickedRead";

/**
 * bd-r2uzg1.9 — ICT IAB row 29 (queue #116): in the Android app a teacher's Digital Coaching Submit stopped on
 * "Photo N not sent · File will not open". Production, 29 Oct–13 Nov: 331 rejections, 32 photos, 25 teachers; every
 * one an ordinary JPEG (the phone said image/jpeg; the 183 photos that did arrive from the same phones all start
 * FF D8 FF) and 12 of the 32 arrived intact later. The format was never the problem: the phone lost its hold on a
 * photo it had picked. One teacher's same photo went through on the next Submit two minutes later.
 *
 * So: a picked photo is read ONCE, when she picks it, and the page keeps those bytes (never the picked handle); a
 * read that fails is tried again before it counts; a file that is not a JPEG or PNG inside is refused at the pick.
 */

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const MP4 = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32];
const HEIC = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];

const file = (bytes: number[], name = "board.jpg", type = "image/jpeg") =>
  new File([new Uint8Array([...bytes, 1, 2, 3, 4])], name, { type, lastModified: 1_700_000_000_000 });

/** A Blob's bytes through FileReader (jsdom's Blob has no arrayBuffer()). */
function viaReader(b: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

/** A picked photo whose reads fail `fails` times (as the WebView does), then work; Infinity: never. */
function flaky(bytes: number[], fails: number, name = "board.jpg") {
  const f = file(bytes, name);
  const real = () => viaReader(f);
  let n = 0;
  const arrayBuffer = vi.fn(() => {
    n += 1;
    if (n <= fails) return Promise.reject(Object.assign(new Error("The requested file could not be read"), { name: "NotReadableError" }));
    return real();
  });
  Object.defineProperty(f, "arrayBuffer", { value: arrayBuffer });
  return { f, arrayBuffer };
}

const bytesOf = async (b: Blob) => Array.from(new Uint8Array(await viaReader(b)));

describe("what a picked file is inside", () => {
  it("names JPEG, PNG and the formats a phone can hand over instead", () => {
    expect(sniff(new Uint8Array(JPEG))).toBe("jpeg");
    expect(sniff(new Uint8Array(PNG))).toBe("png");
    expect(sniff(new Uint8Array(MP4))).toBe("video");
    expect(sniff(new Uint8Array(HEIC))).toBe("heic");
    expect(sniff(new Uint8Array(WEBP))).toBe("webp");
    expect(sniff(new Uint8Array(PDF))).toBe("pdf");
    expect(sniff(new Uint8Array([0x78, 0x78]))).toBe("other");
  });
});

describe("a photo is held when she picks it (bd-r2uzg1.9)", () => {
  it("a JPEG: the page keeps a copy of its bytes, not the picked file — same name, bytes and type", async () => {
    const picked = file(JPEG);
    const out = await holdPhoto(picked, []);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.file).not.toBe(picked);
    expect(out.file.name).toBe("board.jpg");
    expect(out.file.type).toBe("image/jpeg");
    expect(await bytesOf(out.file)).toEqual(await bytesOf(picked));
    expect(isHeld(out.file)).toBe(true);
    expect(isHeld(picked)).toBe(false);
  });

  it("the copy still reads after the phone has lost the picked file", async () => {
    const { f, arrayBuffer } = flaky(JPEG, 0);
    const out = await holdPhoto(f, []);
    arrayBuffer.mockImplementation(() => Promise.reject(Object.assign(new Error("gone"), { name: "NotReadableError" })));
    expect(out.ok && (await bytesOf(out.file)).slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  });

  it("a PNG is held as image/png", async () => {
    const out = await holdPhoto(file(PNG, "chart.png", "image/png"), []);
    expect(out.ok && out.file.type).toBe("image/png");
  });

  it.each([["an mp4", MP4], ["a HEIC", HEIC], ["a PDF", PDF]])("%s named .jpg is not taken as a photo", async (_n, bytes) => {
    const out = await holdPhoto(file(bytes), []);
    expect(out).toEqual(expect.objectContaining({ ok: false, problem: "not_a_photo" }));
  });

  it("a read that fails is tried again: the second read works, the photo is held", async () => {
    const { f, arrayBuffer } = flaky(JPEG, 1);
    const out = await holdPhoto(f, [0, 0]);
    expect(out.ok).toBe(true);
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
  });

  it("a photo that never opens: refused at the pick, with the browser's error name", async () => {
    const { f, arrayBuffer } = flaky(JPEG, Infinity);
    const out = await holdPhoto(f, [0, 0]);
    expect(out).toEqual({ ok: false, problem: "wont_open", kind: null, errName: "NotReadableError" });
    expect(arrayBuffer).toHaveBeenCalledTimes(3);
  });

  it("no memory for the copy (RangeError) is not her photo's fault: the picked file is kept as it is", async () => {
    const f = file(JPEG);
    Object.defineProperty(f, "arrayBuffer", { value: () => Promise.reject(new RangeError("Array buffer allocation failed")) });
    const out = await holdPhoto(f, [0, 0]);
    expect(out).toEqual({ ok: true, file: f });
  });
});

describe("readPicked", () => {
  it("throws Unreadable carrying the last error's name after every try failed", async () => {
    const { f } = flaky(JPEG, Infinity);
    const err = await readPicked(f, [0]).catch((e) => e);
    expect(err).toBeInstanceOf(Unreadable);
    expect(err.errName).toBe("NotReadableError");
  });

  it("a RangeError is thrown at once, never retried", async () => {
    const read = vi.fn(() => Promise.reject(new RangeError("oom")));
    const f = file(JPEG);
    Object.defineProperty(f, "arrayBuffer", { value: read });
    await expect(readPicked(f, [0, 0])).rejects.toBeInstanceOf(RangeError);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
