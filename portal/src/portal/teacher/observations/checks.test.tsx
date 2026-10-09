import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { OBSERVATIONS_COPY } from "./copy";

/**
 * bd-fmf24g.4 — the teacher v2 Observations page keeps the kit's rules (teacher/ui/checks.test.tsx): start/end
 * only, motion only under motion-safe:, no lying theme classes; every word from copy.ts, ≤4 words, no sentence.
 */
const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("observations: style and copy", () => {
  it("reads the page's source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["ObservationsHome.tsx", "routes.tsx"]));
  });
  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
  it("every word is a label: at most 4 words, never a sentence", () => {
    expect(collectCopy(OBSERVATIONS_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`)).toEqual([]);
  });
  it("no words written into a page (they come from copy.ts)", () => {
    expect(files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text))).toEqual([]);
  });
});
