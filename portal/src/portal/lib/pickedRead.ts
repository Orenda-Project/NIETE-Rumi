/**
 * bd-r2uzg1.9 — ICT IAB row 29 (queue #116): reading a file she PICKED, in the Android app.
 *
 * Production, 29 Oct–13 Nov: Digital Coaching's Submit stopped 331 times for 25 teachers on "Photo N not sent · File
 * will not open". Every one was an ordinary JPEG: the phone called all of them image/jpeg, the 183 photos that did
 * arrive from the same phones all start FF D8 FF, and 12 of the 32 rejected photos arrived intact later. The format
 * was never the problem; the WebView lost its hold on a photo it had picked (one teacher's same photo went through on
 * the next Submit two minutes later; another's failed for 47 minutes and went through when picked again).
 *
 * So a photo is read once, when she picks it, and the page keeps those bytes rather than the picked handle; a read
 * that fails is tried again before it counts; and a file that is not a JPEG or PNG inside (an mp4 or a PDF named
 * .jpg) is refused at the pick. Evidence: 06_Logs & Misc/…/bd-r2uzg1-ict-issues-sheet-triage/workbench/photo_formats/.
 */

import { readBytes } from "./audioHash";

/** Waits before each extra try of a failed read (ms). Two more tries, about 1.6 s in all. */
export const READ_RETRY_MS = [400, 1200];

/** The phone could not read a file she picked, after every try. `errName`: the browser's name for the last error. */
export class Unreadable extends Error {
  constructor(public errName: string | null, message: string) {
    super(message);
    this.name = "Unreadable";
  }
}

/** The browser's error name (NotReadableError, NotFoundError, SecurityError …), or null for anything else. */
export function errNameOf(err: unknown): string | null {
  const n = (err as { name?: unknown })?.name;
  return typeof n === "string" && /^[A-Za-z]{1,40}$/.test(n) ? n : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * A picked file's bytes. A failed read is tried again after each wait in `waits`; a RangeError (no memory for the
 * copy) is thrown at once, since trying again cannot help and the caller has another way to send it.
 */
export async function readPicked(blob: Blob, waits: number[] = READ_RETRY_MS): Promise<ArrayBuffer> {
  let last: unknown = null;
  for (let i = 0; i <= waits.length; i += 1) {
    if (i > 0) await sleep(waits[i - 1]);
    try {
      return await readBytes(blob);
    } catch (err) {
      if (err instanceof RangeError) throw err;
      last = err;
    }
  }
  throw new Unreadable(errNameOf(last), String((last as Error)?.message || last || "unreadable"));
}

export type FileKind = "jpeg" | "png" | "webp" | "heic" | "gif" | "video" | "pdf" | "zip" | "other";

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));

/** What a file is from its first bytes, whatever its name says. */
export function sniff(b: Uint8Array): FileKind {
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (ascii(b, 4, 8) === "ftyp") return /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif)/.test(ascii(b, 8, 12)) ? "heic" : "video";
  return "other";
}

const PHOTO_TYPES: Partial<Record<FileKind, string>> = { jpeg: "image/jpeg", png: "image/png" };

/** Photos this page holds as bytes it read itself: sent as they are, never re-read from the phone. */
const HELD = new WeakSet<Blob>();
export function isHeld(blob: Blob): boolean {
  return HELD.has(blob);
}

export type PhotoTaken = { ok: true; file: File };
export type PhotoRefused = { ok: false; problem: "not_a_photo" | "wont_open"; kind: FileKind | null; errName: string | null };
export type HeldPhoto = PhotoTaken | PhotoRefused;

/** The portal builds without strictNullChecks, where `ok: true | false` alone does not narrow: this does. */
export function isRefused(out: HeldPhoto): out is PhotoRefused {
  return out.ok === false;
}

/**
 * Read a photo she has just picked and keep its bytes: the File returned is a copy in memory (same name, bytes and
 * type), so nothing later depends on the phone still opening the picked file. Not a JPEG or PNG inside: not_a_photo.
 * Unreadable after every try: wont_open. No memory for the copy: the picked file is kept as it is (Submit reads it).
 */
export async function holdPhoto(file: File, waits: number[] = READ_RETRY_MS): Promise<HeldPhoto> {
  let bytes: ArrayBuffer;
  try {
    bytes = await readPicked(file, waits);
  } catch (err) {
    if (err instanceof RangeError) return { ok: true, file };
    return { ok: false, problem: "wont_open", kind: null, errName: err instanceof Unreadable ? err.errName : errNameOf(err) };
  }
  const kind = sniff(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)));
  const type = PHOTO_TYPES[kind];
  if (!type) return { ok: false, problem: "not_a_photo", kind, errName: null };
  const held = new File([bytes], file.name, { type, lastModified: file.lastModified });
  HELD.add(held);
  return { ok: true, file: held };
}
