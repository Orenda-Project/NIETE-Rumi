import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { COPY_ENTRY, PLAN_V7 } from "./copyV7plan";

/**
 * bd-o15qnr.33 — the words of Check and send's Attach lesson plan step: English and Urdu from day one, every value a label,
 * never "him/her/his/she/he" for a teacher, and the ontology's words (Lesson plan لیسن پلان, Chapter باب).
 */
describe("Attach lesson plan copy (v7)", () => {
  it("Urdu is complete", () => {
    expect(untranslated(COPY_ENTRY.module, COPY_ENTRY.same)).toEqual([]);
  });

  it.each(["en", "ur"] as const)("every %s value is a label", (lang) => {
    const bad = collectCopy(PLAN_V7[lang]).filter((c) => copyProblem(c.text))
      .filter((c) => !COPY_ENTRY.longOk.some((k) => c.path.startsWith(k))).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("never a pronoun for a teacher", () => {
    expect(collectCopy(PLAN_V7.en).map((c) => c.text).join(" | ")).not.toMatch(/\b(him|her|his|she|he)\b/i);
  });

  it("the operator's heading, and the ontology's words", () => {
    expect(PLAN_V7.en.attachPlan).toBe("Attach lesson plan");
    expect(PLAN_V7.ur.attachPlan).toContain("لیسن پلان");
    expect(PLAN_V7.ur.nietePlan).toContain("لیسن پلان");
    expect(PLAN_V7.ur.pickChapter).toContain("باب");
    expect(PLAN_V7.ur.recentPlans).toBe("حالیہ لیسن پلان");
    // never the AI's old name
    expect(JSON.stringify(PLAN_V7)).not.toMatch(/Rumi/);
  });
});
