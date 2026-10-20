import { describe, it, expect } from "vitest";
import { libraryKeyFor, sameSubjectName } from "./classKey";

/**
 * bd-1p5nkt — ICT DC rows 146, 147 (20 Oct): for an Urdu-preferring teacher the lesson-plan library opened the wrong
 * subject — an Urdu class showed General Knowledge, a Maths class Islamiat. Her class names come in her language
 * («ریاضی», «اردو»), and the screen compared names with an English-only cleaner that turned every Urdu name into "",
 * so her class matched the FIRST Urdu-named subject in the grade's catalogue. The catalogues below are production's.
 */
const G2 = [
  { key: "english", name: "English" }, { key: "urdu", name: "Urdu" }, { key: "math", name: "Math" },
  { key: "general_knowledge_ur", name: "واقفیتِ عامہ" }, { key: "general_knowledge", name: "General Knowledge" },
  { key: "islamiat", name: "اسلامیات" },
];
const G4 = [
  { key: "english", name: "English" }, { key: "urdu", name: "Urdu" }, { key: "math", name: "Math" },
  { key: "general_science", name: "General Science" }, { key: "social_studies_en", name: "Social Studies (English)" },
  { key: "social_studies_ur", name: "Social Studies (Urdu)" }, { key: "islamiat", name: "اسلامیات" },
];

describe("the library key for her class (bd-1p5nkt)", () => {
  it("row 147: Grade 2 Maths named «ریاضی», with her class's catalogue key → math, never General Knowledge or Islamiat", () => {
    expect(libraryKeyFor({ grade: 2, subject: "ریاضی", featureKey: "math" }, G2)).toBe("math");
    expect(libraryKeyFor({ grade: 4, subject: "ریاضی", featureKey: "math" }, G4)).toBe("math");
  });
  it("row 146: an Urdu class named «اردو» → urdu, never General Knowledge", () => {
    expect(libraryKeyFor({ grade: 2, subject: "اردو", featureKey: "urdu" }, G2)).toBe("urdu");
  });
  it("no key and a name the catalogue does not have: no key (Lesson Plans), never the first Urdu-named subject", () => {
    expect(libraryKeyFor({ grade: 2, subject: "ریاضی", featureKey: null }, G2)).toBeNull();
    expect(libraryKeyFor({ grade: 4, subject: "ریاضی" }, G4)).toBeNull();
  });
  it("a subject picked from the catalogue itself (Urdu-named) finds its own key by its exact name", () => {
    expect(libraryKeyFor({ grade: 2, subject: "اسلامیات" }, G2)).toBe("islamiat");
    expect(libraryKeyFor({ grade: 2, subject: "واقفیتِ عامہ" }, G2)).toBe("general_knowledge_ur");
  });
  it("English names still match as before (case and spacing aside)", () => {
    expect(libraryKeyFor({ grade: 4, subject: "general science" }, G4)).toBe("general_science");
  });
});

describe("comparing subject names (bd-1p5nkt)", () => {
  it("two different Urdu names are not the same; two empty names are never the same", () => {
    expect(sameSubjectName("ریاضی", "اسلامیات")).toBe(false);
    expect(sameSubjectName("", "")).toBe(false);
    expect(sameSubjectName("—", "واقفیتِ عامہ")).toBe(false);
  });
  it("the same Urdu name matches; English ignores case and punctuation", () => {
    expect(sameSubjectName("اسلامیات", "اسلامیات")).toBe(true);
    expect(sameSubjectName("General-Science", "general science")).toBe(true);
  });
});
