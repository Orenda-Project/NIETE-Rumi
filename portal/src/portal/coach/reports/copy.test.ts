import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { COPY_ENTRY } from "./copy";

/**
 * bd-4404s7.5 — the Reports area's words are English and Urdu from day one (language-protocol §6.3): no empty or
 * still-English Urdu, and every value a label (never a sentence), as the teacher app's copy modules are held.
 */
describe("coach reports copy", () => {
  it("Urdu is complete", () => {
    expect(untranslated(COPY_ENTRY.module, COPY_ENTRY.same)).toEqual([]);
  });

  it("every Urdu value is a label", () => {
    const bad = collectCopy(COPY_ENTRY.module.ur)
      .filter((c) => copyProblem(c.text))
      .filter((c) => !COPY_ENTRY.longOk.some((p) => c.path.startsWith(p)))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("every English value is a label", () => {
    const bad = collectCopy(COPY_ENTRY.module.en)
      .filter((c) => copyProblem(c.text))
      .filter((c) => !COPY_ENTRY.longOk.some((p) => c.path.startsWith(p)))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("uses the locked words: Observation not lesson, Start recording, Feedback Form, Debrief", () => {
    const en = JSON.stringify(COPY_ENTRY.module.en);
    expect(en).toContain("Start recording");
    expect(en).toContain("Feedback Form");
    expect(en).not.toMatch(/\bTalk\b|Check draft|Record live/);
  });
});
