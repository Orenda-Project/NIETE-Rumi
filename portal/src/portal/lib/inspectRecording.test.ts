import { describe, it, expect } from "vitest";
import { inspectRecording } from "./inspectRecording";
import { recordingRepairOn } from "./recordingRepair";

/** bd-8sr958 — synthetic boxes only: no teacher audio. */
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const box = (type: string, body: number[] | Uint8Array, size?: number) => {
  const b = Uint8Array.from(body);
  return [...u32(size ?? 8 + b.length), ...Array.from(type).map((c) => c.charCodeAt(0)), ...b];
};
const ftyp = box("ftyp", [...Array.from("M4A ").map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
const free = box("free", new Array(8).fill(0));
const mdat = (n: number, size?: number) => box("mdat", new Array(n).fill(7), size);
const moov = box("moov", new Array(40).fill(1));
const blob = (...parts: number[][]) => new Blob([Uint8Array.from(parts.flat())]);

describe("inspectRecording", () => {
  it("a finished m4a is ok", async () => {
    expect((await inspectRecording(blob(ftyp, free, mdat(500), moov))).kind).toBe("ok");
  });
  it("an m4a with no moov is damaged, and carries the recorder signature", async () => {
    const r = await inspectRecording(blob(ftyp, free, mdat(500)));
    expect(r.kind).toBe("damaged");
    expect(r.signature).toBe("M4A M4A free=16");
  });
  it("a media box cut short (its size runs past the end) is damaged even when a moov follows nothing", async () => {
    expect((await inspectRecording(blob(ftyp, free, mdat(500, 99999)))).kind).toBe("damaged");
  });
  it("a media box whose size was never written (0) and no moov is damaged", async () => {
    expect((await inspectRecording(blob(ftyp, free, mdat(500, 0)))).kind).toBe("damaged");
  });
  it("a 0-byte file is empty", async () => {
    expect((await inspectRecording(new Blob([]))).kind).toBe("empty");
  });
  it("other containers are not judged", async () => {
    expect((await inspectRecording(blob(Array.from("OggS....").map((c) => c.charCodeAt(0)), new Array(50).fill(0)))).kind).toBe("unchecked");
  });
});

describe("recordingRepairOn", () => {
  it("only a literal true turns it on; anything else is off", () => {
    expect(recordingRepairOn({ features: { recordingRepair: true } })).toBe(true);
    expect(recordingRepairOn({ features: { recordingRepair: "true" } })).toBe(false);
    expect(recordingRepairOn({ features: {} })).toBe(false);
    expect(recordingRepairOn(null)).toBe(false);
  });
});
