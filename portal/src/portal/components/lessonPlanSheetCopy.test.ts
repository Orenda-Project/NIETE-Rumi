import { describe, it, expect } from "vitest";
import { untranslated } from "../teacher/i18n";
import { LESSON_PLAN_SHEET_COPY } from "./lessonPlanSheetCopy";

/** bd-kijmb8 — every word of the Lesson plan button and sheet has an Urdu line that is not the English. */
describe("lesson plan sheet copy", () => {
  it("has no empty or English-only Urdu", () => {
    expect(untranslated(LESSON_PLAN_SHEET_COPY)).toEqual([]);
  });
  it("keeps the app's existing words", () => {
    expect(LESSON_PLAN_SHEET_COPY.ur.lessonPlan).toBe("لیسن پلان");
  });
});
