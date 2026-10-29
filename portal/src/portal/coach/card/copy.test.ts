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

  it("speaks the ontology: DC observation, Coach observations, Assessments, scores say whose", () => {
    expect(SCHOOL_CARD.en.tileLabel.dc(2)).toBe("DC observations");
    expect(SCHOOL_CARD.ur.tileLabel.dc(2)).toBe("ڈیجیٹل کوچنگ مشاہدات");
    expect(SCHOOL_CARD.en.coachObs).toBe("Coach observations");
    expect(SCHOOL_CARD.ur.coachObs).toBe("مشاہدات");
    // "Papers" reads "Assessments" (the feature's name; ontology: Assessment پرچہ, never "Papers made" in a heading)
    expect(SCHOOL_CARD.en.tiles.papers).toBe("Assessments");
    expect(SCHOOL_CARD.ur.tiles.papers).toBe("پرچے");
    expect(SCHOOL_CARD.en.tileLabel.papers(1)).toBe("assessment");
    expect(SCHOOL_CARD.en.tileLabel.papers(5)).toBe("assessments");
    expect(SCHOOL_CARD.en.byTeacher.papers).toBe("Assessments by teacher");
    expect(SCHOOL_CARD.en.allOf.papers).toBe("All Assessments");
    expect(SCHOOL_CARD.en.countsSpoken(1, 2, 3, 4)).toContain("assessments 4");
    const en = collectCopy(SCHOOL_CARD.en).map((c) => c.text).join(" | ");
    expect(en).not.toMatch(/\bpapers?\b/i);
    expect(SCHOOL_CARD.en.aiScore).toBe("AI score");
    expect(SCHOOL_CARD.en.coachScore).toBe("Coach score");
    const every = [...collectCopy(SCHOOL_CARD.en), ...collectCopy(SCHOOL_CARD.ur)].map((c) => c.text).join(" | ");
    // ("Student Engagement" is a framework section's own name, not an engagement rate.)
    expect(every).not.toMatch(/HITL|\bHead\b|\bactive\b|usage|engagement %|% of teachers/i);
  });

  it("Digital Coaching and Coach observations (v9): averages, days used, practices, reports; observations, never visits", () => {
    expect(SCHOOL_CARD.en.digitalCoaching).toBe("Digital Coaching");
    expect(SCHOOL_CARD.ur.digitalCoaching).toBe("ڈیجیٹل کوچنگ");
    expect(SCHOOL_CARD.en.coachObsName).toBe("Coach observations");
    expect(SCHOOL_CARD.ur.coachObsName).toBe("کوچ کے مشاہدات");
    expect(SCHOOL_CARD.en.avgOf.dc).toBe("average AI score");
    expect(SCHOOL_CARD.en.avgOf.coach).toBe("average Coach score");
    expect(SCHOOL_CARD.en.byTeacher.dc).toBe("Digital Coaching by teacher");
    expect(SCHOOL_CARD.en.byTeacher.coach).toBe("Coach observations by teacher");
    expect(SCHOOL_CARD.en.daysUsed).toBe("days used");
    expect(SCHOOL_CARD.en.byPractice).toBe("Average by practice");
    expect(SCHOOL_CARD.en.across.dc(4, 2)).toBe("Across her 4 reports · out of 2");
    expect(SCHOOL_CARD.en.across.coach(1, 2)).toBe("Across her 1 observation · out of 2");
    expect(SCHOOL_CARD.en.scoredIn(1, 4)).toBe("Scored in 1 of 4 (the others had no lesson plan)");
    expect(SCHOOL_CARD.en.herList.dc).toBe("Her reports");
    expect(SCHOOL_CARD.en.herList.coach).toBe("Her observations");
    expect(SCHOOL_CARD.en.noKind.dc.week).toBe("No DC observations this week");
    expect(SCHOOL_CARD.en.noKind.coach.today).toBe("No coach observations today");
    expect(SCHOOL_CARD.en.lessonOf("Math")).toBe("Math lesson");
    expect(SCHOOL_CARD.ur.lessonOf("ریاضی")).toBe("ریاضی کا سبق");
    // the vocabulary: a coach observation is an observation, never a visit; "Coaching" alone is never a name
    const every = collectCopy(SCHOOL_CARD.en).map((c) => c.text);
    // ("Last visit" is the coach's last visit to the school, a different thing)
    expect(every.join(" | ")).not.toMatch(/\d+ visits?\b|Her visits/i);
    expect(every).not.toContain("Coaching");
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
