import { describe, it, expect, vi, afterEach } from "vitest";
import { checkAudioFile, mediaProbe, UPLOAD_RULES } from "./coachingUpload";

/**
 * bd-i0u6n2 — the recording slot of a teacher's Digital Coaching: DC is audio only.
 *   - A video is refused with its own line (not "Not a recording", not "File too large").
 *   - A file the phone marks as audio is taken whatever its name ends in, and sent under a name the server takes.
 *   - Anything else (a photo, a document) is still "Not a recording". A video the browser cannot read but that
 *     carries an audio name (.mp4) is let through, as today: the pipeline transcribes its sound.
 */
const MB = 1024 * 1024;
const file = (name: string, type: string, size = 2 * MB) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

afterEach(() => { vi.restoreAllMocks(); });

describe("a file the phone marks as audio (bd-i0u6n2)", () => {
  it("no name ending, marked audio/mpeg: taken, sent as .mp3", async () => {
    expect(await checkAudioFile(file("Lesson recording", "audio/mpeg"))).toEqual({ problem: null, filename: "Lesson recording.mp3" });
  });
  it("a bare number from the picker, marked audio/ogg: taken, sent as .ogg", async () => {
    expect(await checkAudioFile(file("1000043567", "audio/ogg"))).toEqual({ problem: null, filename: "1000043567.ogg" });
  });
  it("an unknown ending but marked audio/x-m4a: taken under .m4a", async () => {
    expect(await checkAudioFile(file("AUD-20261020.gg", "audio/x-m4a"))).toEqual({ problem: null, filename: "AUD-20261020.m4a" });
  });
  it("a known ending is kept as it is, even with no type", async () => {
    expect(await checkAudioFile(file("class.m4a", ""))).toEqual({ problem: null, filename: "class.m4a" });
  });
  it("an audio type the pipeline has never seen (flac) is still not taken", async () => {
    expect((await checkAudioFile(file("x.flac", "audio/flac"))).problem).toBe("wrong_type");
  });
  it("a photo or a document is still Not a recording", async () => {
    expect((await checkAudioFile(file("board.jpg", "image/jpeg"))).problem).toBe("wrong_type");
    expect((await checkAudioFile(file("plan.pdf", "application/pdf"))).problem).toBe("wrong_type");
  });
  it("audio over 300 MB is still too large", async () => {
    expect((await checkAudioFile(file("a.mp3", "audio/mpeg", UPLOAD_RULES.audio.maxBytes + 1))).problem).toBe("too_large");
  });
  it("plain audio is never opened as a video", async () => {
    const spy = vi.spyOn(mediaProbe, "hasVideo");
    await checkAudioFile(file("class.m4a", "audio/mp4"));
    await checkAudioFile(file("class.mp3", "audio/mpeg"));
    await checkAudioFile(file("rec.webm", "audio/webm"));
    await checkAudioFile(file("rec.3gp", "audio/3gpp"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("a video in the recording slot (bd-i0u6n2)", () => {
  it("an .mp4 with a picture is refused as a video — before its size is looked at", async () => {
    vi.spyOn(mediaProbe, "hasVideo").mockResolvedValue(true);
    expect((await checkAudioFile(file("class.mp4", "video/mp4", 900 * MB))).problem).toBe("video");
  });
  it("an iPhone .mov is refused as a video, even when the browser cannot read it", async () => {
    vi.spyOn(mediaProbe, "hasVideo").mockResolvedValue(null);
    expect((await checkAudioFile(file("IMG_0042.MOV", "video/quicktime"))).problem).toBe("video");
  });
  it("an audio-only .mp4 (Android calls every .mp4 video/mp4) is taken", async () => {
    vi.spyOn(mediaProbe, "hasVideo").mockResolvedValue(false);
    expect(await checkAudioFile(file("voice.mp4", "video/mp4"))).toEqual({ problem: null, filename: "voice.mp4" });
  });
  it("an .mp4 the browser cannot read is let through, as today", async () => {
    vi.spyOn(mediaProbe, "hasVideo").mockResolvedValue(null);
    expect((await checkAudioFile(file("clip.mp4", "video/mp4"))).problem).toBeNull();
  });
});
