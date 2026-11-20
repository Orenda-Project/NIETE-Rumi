import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { COPY_ENTRY, FLOW_V7_WEEK } from "./copyV7week";

/**
 * bd-o15qnr.28.1 — the words v7's week page, Home's "Your week" and My progress add: English and Urdu from day one, every
 * value a label (the long ones named), never "him/her/his/she/he" for a teacher, and no percentages in the words.
 */
describe("v7 week and My progress copy", () => {
  it("Urdu is complete", () => {
    expect(untranslated(COPY_ENTRY.module, COPY_ENTRY.same)).toEqual([]);
  });

  it.each(["en", "ur"] as const)("every %s value is a label (or a named long one)", (lang) => {
    const bad = collectCopy(FLOW_V7_WEEK[lang]).filter((c) => copyProblem(c.text))
      .filter((c) => !COPY_ENTRY.longOk.some((p) => c.path.startsWith(p))).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("never a pronoun for a teacher, never a %", () => {
    const en = collectCopy(FLOW_V7_WEEK.en).map((c) => c.text).join(" | ");
    expect(en).not.toMatch(/\b(him|her|his|she|he)\b/i);
    expect(collectCopy(FLOW_V7_WEEK.ur).map((c) => c.text).join(" ")).not.toMatch(/%/);
    expect(en).not.toMatch(/%/);
  });

  it("the board's words", () => {
    expect(FLOW_V7_WEEK.en.progressTitle).toBe("My progress");
    expect(FLOW_V7_WEEK.ur.progressTitle).toBe("میری پیش رفت");
    expect(FLOW_V7_WEEK.en.goal(6, 10)).toBe("Goal 6 of 10");
    expect(FLOW_V7_WEEK.ur.goal(6, 10)).toBe("ہدف: 10 میں سے 6");
  });
});
