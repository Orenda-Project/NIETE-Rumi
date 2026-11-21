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
    expect(FORM_V7.en.rumisLevel).toBe("NIETE Teaching Assistant’s level");
    expect(FORM_V7.en.whyLevelMin(20)).toBe("Why this level (20 letters at least)");
    expect(FORM_V7.ur.whyLevelMin(20)).toBe("یہ سطح کیوں (کم از کم 20 حروف)");
    expect(FORM_V7.en.changedSummary(2, 3, true)).toBe("2 levels and 3 notes changed from the NIETE Teaching Assistant’s");
    expect(FORM_V7.en.changedSummary(1, 1, false)).toBe("1 level and 1 note changed");
    expect(FORM_V7.en.nextStep("Record the debrief")).toBe("Next: Record the debrief");
    expect(FORM_V7.ur.changedFrom("Developing")).toBe("Developing سے بدلا گیا");
  });

  // bd-o15qnr.31 (#188 canvas-ff, LOCKED 21 Nov): the collapsed form, evidence option B, the gaps toast.
  it("the collapsed form's words (ff-outer, ff-list, ff-detail, ff-b-*), English and Urdu", () => {
    expect(FORM_V7.en.doneOf(3, 8)).toBe("3/8 done");
    expect(FORM_V7.en.checkedOf(3, 8)).toBe("3 of 8 checked");
    expect(FORM_V7.ur.checkedOf(3, 8)).toBe("8 میں سے 3 دیکھ لیے");
    expect(FORM_V7.en.saveLeft(3)).toBe("Save (3 sections to finish)");
    expect(FORM_V7.ur.saveLeft(3)).toBe("محفوظ کریں (3 حصے باقی)");
    expect(FORM_V7.en.nextToCheck("C4", "Children's choices")).toBe("Next to check: C4 Children's choices");
    expect(FORM_V7.ur.nextToCheck("C4", "بچوں کے انتخاب")).toBe("اگلا: C4 بچوں کے انتخاب");
    expect(FORM_V7.en.indicatorCrumb("Feedback Form", "C", 1, 8)).toBe("Feedback Form · C · 1 of 8");
    expect(FORM_V7.ur.agreeNext).toBe("متفق، اگلا");
    expect(FORM_V7.ur.addEvidence).toBe("شواہد شامل کریں");
    expect(FORM_V7.en.needLevel(3)).toBe("3 items still need a level");
    expect(FORM_V7.en.needLevel(1)).toBe("1 item still needs a level");
  });

  it("the AI is the NIETE Teaching Assistant, never Rumi, in both languages", () => {
    const en = collectCopy(FORM_V7.en).map((c) => c.text).join(" ");
    const ur = collectCopy(FORM_V7.ur).map((c) => c.text).join(" ");
    expect(en).not.toMatch(/Rumi/);
    expect(ur).not.toMatch(/Rumi/);
    expect(FORM_V7.en.rumiTag).toBe("NIETE Teaching Assistant");
    expect(FORM_V7.ur.rumiTag.replace(/[\u2066-\u2069]/g, "")).toBe("NIETE ٹیچنگ اسسٹنٹ");
  });
});
