import { describe, it, expect } from "vitest";
import { gradeOf, inClass, planClassOf, recentForClass, subjectKeyOf } from "./observePlanClass";

/**
 * bd-o15qnr.33 — Check and send's class answer (Grade 1-5 = "primary", or a grade 6-12 and, for 6-8, a subject key) as a
 * filter for the observed teacher's recent plans and the library. The plans carry their own grade and subject spelling
 * (a download: "Mathematics", "Maths"; a K-5 plan: "math", "general_science"; her own plan: "english"), so a subject is
 * folded to the class question's keys before it is compared.
 */
describe("the class answer as a filter", () => {
  it("nothing chosen: no filter", () => {
    expect(planClassOf(null, null)).toBeNull();
  });
  it("Grade 1-5 is grades 1 to 5, any subject", () => {
    expect(planClassOf("primary", null)).toEqual({ grades: [1, 2, 3, 4, 5], subject: null });
  });
  it("a grade 6-12 alone, or with its subject", () => {
    expect(planClassOf("10", null)).toEqual({ grades: [10], subject: null });
    expect(planClassOf("7", "maths")).toEqual({ grades: [7], subject: "maths" });
  });
  it("'Other' subject is the grade alone (no list to match it against)", () => {
    expect(planClassOf("7", "other")).toEqual({ grades: [7], subject: null });
  });
});

describe("a plan's grade and subject, however spelled", () => {
  it.each([[4, 4], ["7", 7], ["grade_7", 7], ["Grade 8", 8], [null, null], ["", null], ["early_years", null]])("grade %j → %j", (raw, out) => {
    expect(gradeOf(raw as string | number | null)).toBe(out);
  });
  it.each([
    ["Mathematics", "maths"], ["Maths", "maths"], ["math", "maths"], ["ریاضی", "maths"],
    ["English", "english"], ["Reading Hour English", "english"], ["Urdu", "urdu"], ["اردو", "urdu"],
    ["General Science", "science"], ["general_science", "science"], ["Science", "science"],
    ["Computer Science", "computer"], ["Computer Studies", "computer"],
    ["Islamiyat", "islamiat"], ["Islamic Studies", "islamiat"],
    ["Social Studies", "social_studies"], ["social_studies_en", "social_studies"], ["Pakistan Studies", "social_studies"],
    ["General Knowledge", null], [null, null], ["", null],
  ])("%j → %j", (raw, out) => {
    expect(subjectKeyOf(raw)).toBe(out);
  });
});

describe("which plans are that class's", () => {
  const p = (grade: string | number | null, subject: string | null, id = "x") => ({ id, grade, subject });
  it("grade and subject both have to match", () => {
    const cls = { grades: [7], subject: "maths" };
    expect(inClass(p(7, "Mathematics"), cls)).toBe(true);
    expect(inClass(p("7", "maths"), cls)).toBe(true);
    expect(inClass(p(7, "English"), cls)).toBe(false);
    expect(inClass(p(8, "Mathematics"), cls)).toBe(false);
    expect(inClass(p(null, "Mathematics"), cls)).toBe(false);
  });
  it("no subject in the answer: the grade alone", () => {
    expect(inClass(p(3, "english"), { grades: [1, 2, 3, 4, 5], subject: null })).toBe(true);
    expect(inClass(p(6, "english"), { grades: [1, 2, 3, 4, 5], subject: null })).toBe(false);
  });
  it("the newest three of that class, in the order given (newest first); no class: the newest three", () => {
    const plans = [p(7, "Maths", "a"), p(7, "English", "b"), p(7, "Mathematics", "c"), p(8, "Maths", "d"), p(7, "math", "e"), p(7, "Maths", "f")];
    expect(recentForClass(plans, { grades: [7], subject: "maths" }).map((x) => x.id)).toEqual(["a", "c", "e"]);
    expect(recentForClass(plans, null).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(recentForClass([], { grades: [7], subject: "maths" })).toEqual([]);
  });
});
