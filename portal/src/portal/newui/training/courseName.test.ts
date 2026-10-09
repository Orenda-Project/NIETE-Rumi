import { describe, it, expect } from "vitest";
import { courseName } from "./trainingApi";

/** bd-fmf24g.32 — the catalogue stores course titles as "Module 1 - XYZ"; the teacher sees only "XYZ" (Course/Part, never Module). */
describe("courseName", () => {
  it.each([
    ["Module 1 - Classroom Management", "Classroom Management"],
    ["Module 9 - Teacher Leadership", "Teacher Leadership"],
    ["Module 5 - Assessment and Data Use", "Assessment and Data Use"],
    ["module 2: Affective Development", "Affective Development"],
    ["Module 3 – Classroom Management", "Classroom Management"],
    ["Module 4 — Digital Literacy", "Digital Literacy"],
    ["Module 10 Learner Development", "Learner Development"],
    ["ماڈیول 1 - کلاس روم مینجمنٹ", "کلاس روم مینجمنٹ"],
    ["ماڈیول ۲: تدریسی ڈیزائن", "تدریسی ڈیزائن"],
  ])("%s -> %s", (input, out) => {
    expect(courseName(input)).toBe(out);
  });

  it("leaves a title with no prefix alone", () => {
    expect(courseName("Classroom Management")).toBe("Classroom Management");
    expect(courseName("Module Design Basics")).toBe("Module Design Basics");
    expect(courseName("Literacy 1")).toBe("Literacy 1");
  });

  it("never returns an empty name", () => {
    expect(courseName("Module 1")).toBe("Module 1");
    expect(courseName("")).toBe("");
    expect(courseName(null)).toBe("");
    expect(courseName(undefined)).toBe("");
  });
});
