import { describe, it, expect, vi, afterEach } from "vitest";
import { checkAudioFile, mediaProbe, sniffAudioExt } from "./coachingUpload";

/**
 * bd-qbbikm — a real recording whose name says nothing (operator, 20 Oct: "Grade4-Science-…-2026-10-16.MP3EG", a
 * real MP3) was still "Not a recording": the browser gives a file a type from its name ending, so an unknown ending
 * has no type either. The slot now reads the file's first bytes; a known audio signature is taken and uploaded
 * under the right ending. A photo or document renamed is still refused (its bytes are not audio).
 */
const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const file = (name: string, head: Uint8Array, type = "") => new File([head, new Uint8Array(64)], name, { type });

// The first 16 bytes of the operator's .MP3EG file (ID3 v2.4).
const MP3EG_HEAD = bytes(0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x22, 0x54, 0x53, 0x53, 0x45, 0x00, 0x00);

afterEach(() => { vi.restoreAllMocks(); });

describe("the first bytes say what it is (bd-qbbikm)", () => {
  it("ID3 → .mp3; a bare MPEG frame → .mp3; ADTS AAC → .aac", async () => {
    expect(await sniffAudioExt(file("x", MP3EG_HEAD))).toBe(".mp3");
    expect(await sniffAudioExt(file("x", bytes(0xff, 0xfb, 0x90, 0x64)))).toBe(".mp3");
    expect(await sniffAudioExt(file("x", bytes(0xff, 0xf1, 0x50, 0x80)))).toBe(".aac");
  });
  it("OggS → .ogg; RIFF…WAVE → .wav; #!AMR → .amr", async () => {
    expect(await sniffAudioExt(file("x", bytes(...ascii("OggS"), 0, 2)))).toBe(".ogg");
    expect(await sniffAudioExt(file("x", bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE"))))).toBe(".wav");
    expect(await sniffAudioExt(file("x", bytes(...ascii("#!AMR\n"))))).toBe(".amr");
  });
  it("an MP4 container: M4A brand → .m4a, 3gp brand → .3gp, any other → .mp4; WebM → .webm", async () => {
    expect(await sniffAudioExt(file("x", bytes(0, 0, 0, 0x20, ...ascii("ftypM4A "))))).toBe(".m4a");
    expect(await sniffAudioExt(file("x", bytes(0, 0, 0, 0x18, ...ascii("ftyp3gp4"))))).toBe(".3gp");
    expect(await sniffAudioExt(file("x", bytes(0, 0, 0, 0x18, ...ascii("ftypisom"))))).toBe(".mp4");
    expect(await sniffAudioExt(file("x", bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 2)))).toBe(".webm");
  });
  it("a photo, a PDF or nothing recognisable → null", async () => {
    expect(await sniffAudioExt(file("x", bytes(0xff, 0xd8, 0xff, 0xe0)))).toBeNull(); // JPEG
    expect(await sniffAudioExt(file("x", bytes(0x89, ...ascii("PNG"))))).toBeNull();
    expect(await sniffAudioExt(file("x", bytes(...ascii("%PDF-1.7"))))).toBeNull();
    expect(await sniffAudioExt(file("x", bytes(1, 2, 3, 4, 5)))).toBeNull();
  });
});

describe("the recording slot with an unknown name (bd-qbbikm)", () => {
  it("the operator's .MP3EG file is taken and sent as .mp3", async () => {
    expect(await checkAudioFile(file("Grade4-Science-Sound-and-Vibration-2026-10-16.MP3EG", MP3EG_HEAD)))
      .toEqual({ problem: null, filename: "Grade4-Science-Sound-and-Vibration-2026-10-16.mp3" });
  });
  it("no name ending, no type, Ogg inside: taken as .ogg", async () => {
    expect(await checkAudioFile(file("1000043567", bytes(...ascii("OggS"), 0, 2))))
      .toEqual({ problem: null, filename: "1000043567.ogg" });
  });
  it("a photo renamed to look like audio is still Not a recording", async () => {
    expect((await checkAudioFile(file("lesson.mp3eg", bytes(0xff, 0xd8, 0xff, 0xe0)))).problem).toBe("wrong_type");
  });
  it("an MP4 found by its bytes is opened to see if it is a video: a picture → video", async () => {
    vi.spyOn(mediaProbe, "hasVideo").mockResolvedValue(true);
    expect((await checkAudioFile(file("clip.dat", bytes(0, 0, 0, 0x18, ...ascii("ftypisom"))))).problem).toBe("video");
  });
  it("an MP4 found by its bytes with sound only is taken as .mp4", async () => {
    vi.spyOn(mediaProbe, "hasVideo").mockResolvedValue(false);
    expect(await checkAudioFile(file("voice.dat", bytes(0, 0, 0, 0x18, ...ascii("ftypisom")))))
      .toEqual({ problem: null, filename: "voice.mp4" });
  });
  it("a known name is never read (no extra work for the usual case)", async () => {
    const f = file("class.m4a", bytes(1, 2, 3), "audio/mp4");
    const spy = vi.spyOn(f, "slice");
    await checkAudioFile(f);
    expect(spy).not.toHaveBeenCalled();
  });
});
