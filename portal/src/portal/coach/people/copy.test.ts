import { describe, it, expect } from "vitest";
import { collectCopy, copyProblem } from "../../newui/checks/rules";
import { untranslated } from "../../teacher/i18n";
import { COPY_ENTRY, PEOPLE } from "./copy";

/** bd-4404s7.6 — the Schools and Teachers words: Urdu complete, every value a label (language-protocol §6.3). */
describe("coach · schools and teachers copy", () => {
  it("every English word has an Urdu one, none empty or still English", () => {
    expect(untranslated(PEOPLE, COPY_ENTRY.same ?? [])).toEqual([]);
  });

  it("every value is a label (4 words at most, no sentence), in both languages", () => {
    for (const lang of ["en", "ur"] as const) {
      const bad = collectCopy(PEOPLE[lang]).filter((c) => copyProblem(c.text)).filter((c) => !(COPY_ENTRY.longOk ?? []).some((p) => c.path.startsWith(p))).map((c) => `${lang} ${c.path}: ${c.text}`);
      expect(bad).toEqual([]);
    }
  });

  it("the locked words: Courses done, Papers made, Teaching level, Principal, Teacher", () => {
    expect(PEOPLE.en.coursesDone).toBe("Courses done");
    expect(PEOPLE.ur.coursesDone).toBe("مکمل کورسز");
    expect(PEOPLE.en.papersMade).toBe("Papers made");
    expect(PEOPLE.ur.rolePrincipal).toBe("ہیڈ ٹیچر");
    expect(PEOPLE.ur.roleTeacher).toBe("ٹیچر");
    expect(PEOPLE.ur.teachingLevel).toBe("تدریسی سطح");
  });
});
