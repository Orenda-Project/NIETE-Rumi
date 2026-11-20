import { describe, it, expect } from "vitest";
import { untranslated } from "../../teacher/i18n";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { COPY_ENTRY, FORM_V7 } from "./copyV7form";

/**
 * bd-o15qnr.28 (v7) — the Feedback Form's v7 words (copyV7form.ts): both languages complete, every word a label (at most
 * four words, never a sentence) except the lines the boards print word for word, and never "him/her/his/she/he" for a
 * teacher (the name, or "the teacher").
 */
describe("the v7 Feedback Form's words", () => {
  it("every Urdu word is there and is not the English", () => {
    expect(untranslated(FORM_V7, COPY_ENTRY.same)).toEqual([]);
  });

  it("labels are labels; only the boards' own lines are longer", () => {
    const longOk = (path: string) => COPY_ENTRY.longOk.some((k) => path === k || path.startsWith(`${k}.`) || path.startsWith(`${k}(`));
    const bad = collectCopy(FORM_V7.en).filter((c) => copyProblem(c.text) && !longOk(c.path)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("never him, her, his, she or he for a teacher", () => {
    const words = collectCopy(FORM_V7.en).map((c) => c.text).join(" ");
    expect(words).not.toMatch(/\b(him|her|his|she|he)\b/i);
  });

  it("the boards' words, in English and Urdu", () => {
    expect(FORM_V7.en.rumisLevel).toBe("Rumi’s level");
    expect(FORM_V7.en.whyLevelMin(20)).toBe("Why this level (20 letters at least)");
    expect(FORM_V7.ur.whyLevelMin(20)).toBe("یہ سطح کیوں (کم از کم 20 حروف)");
    expect(FORM_V7.en.changedSummary(2, 3, true)).toBe("2 levels and 3 notes changed from Rumi’s");
    expect(FORM_V7.en.changedSummary(1, 1, false)).toBe("1 level and 1 note changed");
    expect(FORM_V7.en.nextStep("Record the debrief")).toBe("Next: Record the debrief");
    expect(FORM_V7.ur.changedFrom("Developing")).toBe("Developing سے بدلا گیا");
  });
});
