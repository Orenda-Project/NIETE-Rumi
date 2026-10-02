import { describe, it, expect } from "vitest";
import { parseTranscript } from "./transcript";

// bd-5rz1v — "What was said in class" on the lesson page. Transcription stores
// the lesson as `[mm:ss] Speaker (LANG): words`, one turn per paragraph.

describe("parseTranscript", () => {
  it("splits a transcript into timed turns, speaker and words", () => {
    const text = "[00:18] Teacher (UR): آج ہم نے نیا ٹاپک پڑھنا ہے\n\n[00:20] Student (UR): یس۔\n\n[01:02:05] Teacher (EN): Good.";
    expect(parseTranscript(text)).toEqual([
      { at: "00:18", who: "Teacher", text: "آج ہم نے نیا ٹاپک پڑھنا ہے" },
      { at: "00:20", who: "Student", text: "یس۔" },
      { at: "01:02:05", who: "Teacher", text: "Good." },
    ]);
  });

  it("keeps a line it cannot split as plain words, attached to no one", () => {
    expect(parseTranscript("[00:18] Teacher: Salaam\n\nsomething else")).toEqual([
      { at: "00:18", who: "Teacher", text: "Salaam" },
      { at: null, who: null, text: "something else" },
    ]);
  });

  it("is empty for no transcript", () => {
    expect(parseTranscript(null)).toEqual([]);
    expect(parseTranscript("  ")).toEqual([]);
  });
});
