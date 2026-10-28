import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { COPY_MODULES } from "../../teacher/copyRegistry";
import { COPY_ENTRY, SCHOOL_CARD } from "./copy";

/** The School card's words: Urdu complete, every value a label, the ontology's words (language-protocol §6.3). */
describe("coach · school card copy", () => {
  it("every English word has an Urdu one, none empty or still English", () => {
    expect(untranslated(SCHOOL_CARD, COPY_ENTRY.same ?? [])).toEqual([]);
  });

  it("every value is a label (4 words at most, no sentence), in both languages, except the phrases allowed by name", () => {
    for (const lang of ["en", "ur"] as const) {
      const bad = collectCopy(SCHOOL_CARD[lang]).filter((c) => copyProblem(c.text))
        .filter((c) => !(COPY_ENTRY.longOk ?? []).some((p) => c.path === p || c.path.startsWith(`${p}.`) || c.path.startsWith(`${p}(`)))
        .map((c) => `${lang} ${c.path}: ${c.text}`);
      expect(bad).toEqual([]);
    }
  });

  it("is registered with the app's copy checks and the Urdu review list", () => {
    expect(COPY_MODULES.some((m) => m.module === COPY_ENTRY.module)).toBe(true);
  });

  it("speaks the ontology: DC observation, Coach observations, Papers made, scores say whose", () => {
    expect(SCHOOL_CARD.en.tiles.dc).toBe("DC observations");
    expect(SCHOOL_CARD.ur.tiles.dc).toBe("ڈیجیٹل کوچنگ مشاہدات");
    expect(SCHOOL_CARD.en.coachObs).toBe("Coach observations");
    expect(SCHOOL_CARD.ur.coachObs).toBe("مشاہدات");
    expect(SCHOOL_CARD.en.tiles.papers).toBe("Papers made");
    expect(SCHOOL_CARD.ur.tiles.papers).toBe("بنائے گئے پرچے");
    expect(SCHOOL_CARD.en.aiScore).toBe("AI score");
    expect(SCHOOL_CARD.en.coachScore).toBe("Coach score");
    const every = [...collectCopy(SCHOOL_CARD.en), ...collectCopy(SCHOOL_CARD.ur)].map((c) => c.text).join(" | ");
    // ("Student Engagement" is a framework section's own name, not an engagement rate.)
    expect(every).not.toMatch(/HITL|\bHead\b|\bactive\b|usage|engagement %|% of teachers/i);
  });

  it("plain counts, never a rate of teachers", () => {
    expect(SCHOOL_CARD.en.byN(8, 14)).toBe("by 8 of 14 teachers");
    expect(SCHOOL_CARD.en.aboutDay(9)).toBe("about 9 a day");
    expect(SCHOOL_CARD.en.lessThanOneDay).toBe("less than 1 a day");
    expect(SCHOOL_CARD.en.tileLabel.lp(1)).toBe("lesson plan");
    expect(SCHOOL_CARD.en.tileLabel.lp(27)).toBe("lesson plans");
  });

  it("a number that did not load is a dash, never a 0", () => {
    expect(SCHOOL_CARD.en.pct(null)).toBe("—");
    expect(SCHOOL_CARD.ur.pct(null)).toBe("—");
  });
});
