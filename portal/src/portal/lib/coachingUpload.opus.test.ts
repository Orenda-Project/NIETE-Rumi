import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { AUDIO_ACCEPT, acceptFor, checkAudioFile, checkFile, checkRecording } from "./coachingUpload";

/**
 * bd-hronni (queue #237) — "is .opus not recognized as an audio format to attach?" (operator, 23 Nov).
 *
 * A file NAMED *.opus was taken everywhere. What was refused:
 *   - every attach screen but the teacher's Digital Coaching page decided "is this a recording?" by the name ending
 *     alone (checkFile), so an Opus file whose name has no ending (an Android picker hands over "1000043567"), or whose
 *     only clue is its type (audio/ogg; codecs=opus, application/ogg), was "Not a recording";
 *   - .oga (Ogg audio) was in no list at all, here or on the server.
 * Now every attach screen uses checkRecording: the name ending, else the type the phone gives, else the first bytes.
 *
 * The bytes are a REAL Ogg Opus recording (tests/fixtures/audio/lesson-hello.opus: 4 s of speech, 16 kbps, 7.7 KB).
 */
const OPUS = readFileSync(resolve(__dirname, "../../../../tests/fixtures/audio/lesson-hello.opus"));
const opus = (name: string, type = "") => new File([OPUS], name, { type });

describe("the picker offers Ogg audio by every name it goes by", () => {
  it("the accept list names .opus, .ogg and .oga, any audio type, and application/ogg", () => {
    const accepted = AUDIO_ACCEPT.split(",");
    for (const t of [".opus", ".ogg", ".oga", "audio/*", "application/ogg"]) expect(accepted).toContain(t);
    for (const ext of acceptFor("audio").split(",")) expect(accepted).toContain(ext);
  });
});

describe("a real Opus recording is a recording (checkRecording)", () => {
  it("named .opus: taken as it is, the same File", async () => {
    const f = opus("PTT-20261123-WA0005.opus", "audio/ogg");
    const out = await checkRecording(f);
    expect(out.problem).toBeNull();
    expect(out.file).toBe(f);
  });

  it("named .oga or .ogg: taken", async () => {
    expect((await checkRecording(opus("lesson.oga"))).file?.name).toBe("lesson.oga");
    expect((await checkRecording(opus("lesson.OGG"))).file?.name).toBe("lesson.OGG");
  });

  it("no name ending and no type (an Android picker's name): its bytes say Ogg, so it goes up as .ogg", async () => {
    const out = await checkRecording(opus("1000043567"));
    expect(out.problem).toBeNull();
    expect(out.file?.name).toBe("1000043567.ogg");
    expect(out.file?.size).toBe(OPUS.length);
  });

  it("no name ending, typed audio/ogg; codecs=opus → .ogg; application/ogg → .ogg; audio/x-opus+ogg → .opus", async () => {
    expect((await checkRecording(opus("Voice 014", "audio/ogg; codecs=opus"))).file?.name).toBe("Voice 014.ogg");
    expect((await checkRecording(opus("Voice 015", "application/ogg"))).file?.name).toBe("Voice 015.ogg");
    expect((await checkRecording(opus("Voice 016", "audio/x-opus+ogg"))).file?.name).toBe("Voice 016.opus");
  });

  it("a photo or a PDF is still Not a recording, whatever its name", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], "IMG_0042", { type: "image/jpeg" });
    expect((await checkRecording(jpeg)).problem).toBe("wrong_type");
    const pdf = new File(["%PDF-1.7 ..."], "notes.pdf", { type: "application/pdf" });
    expect((await checkRecording(pdf)).problem).toBe("wrong_type");
  });

  it("over the cap is too large, even for a good Opus file", async () => {
    const big = opus("lesson.opus");
    Object.defineProperty(big, "size", { value: 301 * 1024 * 1024 });
    expect((await checkRecording(big)).problem).toBe("too_large");
  });
});

describe(".oga reaches the older checks too", () => {
  it("checkFile and the Digital Coaching check take .oga", async () => {
    expect(checkFile(opus("lesson.oga"), "audio")).toBeNull();
    expect(await checkAudioFile(opus("lesson.oga"))).toEqual({ problem: null, filename: "lesson.oga" });
  });
});

/**
 * Every screen that attaches a recording uses the one check and the one accept list — a screen that went back to the
 * name ending alone would refuse a nameless Opus file again.
 */
describe("no attach screen decides by the name ending alone", () => {
  const SRC = resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "coachingUpload.ts") files.push(p);
    }
  };
  walk(SRC);

  it("no screen checks a recording with checkFile(…, 'audio'), nor builds its own audio accept list", () => {
    const nameOnly = files.filter((f) => /checkFile\([^)]*["']audio["']\)/.test(readFileSync(f, "utf8")));
    const ownAccept = files.filter((f) => /acceptFor\(["']audio["']\)\}?,audio\/\*/.test(readFileSync(f, "utf8")));
    expect(nameOnly.map((f) => f.slice(SRC.length))).toEqual([]);
    expect(ownAccept.map((f) => f.slice(SRC.length))).toEqual([]);
  });

  it("every audio file input takes AUDIO_ACCEPT", () => {
    const pickers = files.filter((f) => /accept=\{AUDIO_ACCEPT\}/.test(readFileSync(f, "utf8")));
    // coach upload, coach debrief, principal observe + talk, the older teacher page, the teacher DC pages, the sheets
    expect(pickers.length).toBeGreaterThanOrEqual(9);
  });
});
