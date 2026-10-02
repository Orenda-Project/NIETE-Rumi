// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// bd-5rz1v.6.6 — the coach's pages talk ABOUT a teacher, who may be a man
// ("Send Mashhood her report", handset test). Their copy is neutral: the
// teacher's name, "the teacher", or "their" — never her / she / hers.
// And the entry speaks to the coach: "Record your Teacher's Lesson".

import { entryCopy, trackerItems, STEP_CHIP } from "./coachObserve";

const COACH_FILES = [
  "pages/LeaderObserveRecord.tsx",
  "pages/LeaderObservation.tsx",
  "pages/LeaderObserveDraft.tsx",
  "pages/LeaderObserveTalk.tsx",
  "lib/coachObserve.ts",
  "components/coaching/coach/CoachRecorder.tsx",
];
const GENDERED = /\b(her|she|hers|herself)\b/i;

/** Every string literal on a non-comment line — what can reach the screen. */
function literals(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || line.startsWith("{/*")) continue;
    const rx = /(['"`])((?:\\.|(?!\1).)*)\1/g;
    let m;
    while ((m = rx.exec(line))) out.push(m[2]);
  }
  return out;
}

describe("coach copy", () => {
  it.each(COACH_FILES)("%s says the teacher's name, 'the teacher' or 'their' — never her / she", (rel) => {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const gendered = literals(src).filter((s) => GENDERED.test(s) && !/^[\w./@-]+$/.test(s));
    expect(gendered).toEqual([]);
  });

  it("the entry speaks to the coach, and the sheet follows it", () => {
    const c = entryCopy();
    expect(c.title).toBe("Record your Teacher’s Lesson");
    expect(c.sheet("Mashhood")).toBe("Record Mashhood’s lesson");
    expect([c.rec, c.file]).toEqual(["Record Live Lecture", "Upload Recording"]);
    for (const s of [c.title, c.sub, c.recSub, c.fileSub]) expect(s).not.toMatch(GENDERED);
  });

  it("the tracker and the step chips are neutral too", () => {
    expect(trackerItems("Mashhood").map((t) => t.label)).toEqual([
      "Lesson analysed", "Check the draft report", "Talk with Mashhood", "Your feedback", "Send Mashhood the report",
    ]);
    for (const s of Object.values(STEP_CHIP)) expect(s).not.toMatch(GENDERED);
  });
});
