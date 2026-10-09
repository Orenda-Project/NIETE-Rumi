import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanCopy, scanStyle } from "../../newui/checks/source";

/**
 * bd-4404s7.4 — the Observe screens keep the teacher kit's design rules, with the same checkers the kit and the teacher
 * features use (teacher/ui/checks.test.tsx): start/end only (Urdu mirrors), motion only under motion-safe:, no lying theme
 * classes, and NO WORDS WRITTEN INTO A COMPONENT (they come from observe/copy.ts, in both languages).
 *
 * The files are the Observe screens' own: the shared coach files (ui.tsx, copy.ts) belong to every coach screen and keep
 * their own checks.
 */
const PAGES = ["CoachObserve", "CoachObservePick", "CoachVisit", "CoachRecord", "CoachAttach", "CoachCheckSend", "CoachSending"];
const files = [
  ...PAGES.map((p) => ({ rel: `pages/${p}.tsx`, path: resolve(__dirname, `../pages/${p}.tsx`) })),
  { rel: "observe/ObservePage.tsx", path: resolve(__dirname, "ObservePage.tsx") },
  { rel: "observe/sender.ts", path: resolve(__dirname, "sender.ts") },
  { rel: "observe/format.ts", path: resolve(__dirname, "format.ts") },
].map((f) => ({ rel: f.rel, text: readFileSync(f.path, "utf8") }));

describe("Observe: style", () => {
  it("reads the screens' source", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["pages/CoachSending.tsx", "observe/sender.ts"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files.flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("Observe: copy", () => {
  it("no words written into a screen (they come from copy.ts)", () => {
    const problems = files.flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});
