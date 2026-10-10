import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { COPY_ENTRY, REPORTS } from "./copy";
import { OBSERVE } from "../observe/copy";

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

  it("the recorder's Finish sheet, in Urdu, uses the observation's words (one vocabulary, nothing new) — bd-fmf24g.41", () => {
    const r = REPORTS.ur.recorder;
    expect(r.finishTitle).toBe(`${OBSERVE.ur.stopAsk}؟`);
    expect(r.yesFinish).toBe(OBSERVE.ur.yesStop);
    expect(r.keepRecording).toBe(OBSERVE.ur.keepRecording);
    expect(r.recorded(12 * 60_000)).toBe(OBSERVE.ur.recordedFor(OBSERVE.ur.minShort(12)));
    expect(r.recorded(30_000)).toBe(OBSERVE.ur.recordedFor(OBSERVE.ur.underMinute));
  });
});
