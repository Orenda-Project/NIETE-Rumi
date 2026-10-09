import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClassPicker } from "./ClassPicker";
import { TEACHER_UI_COPY, TEACHER_UI_UR } from "./copy";

/**
 * bd-fmf24g.14 — ClassPicker (COMPONENTS.md §11, option A, the operator's pick on 9 Oct): ONE control for "one of
 * her classes" and "any grade and subject". Operator: "a list of their classes with a search bar on top but that is
 * too long a list and we don't instinctively know what to search for in the bar."
 *
 *   trigger   a 76px card: the label, or (picked) the subject tile + "Grade 6 · Mathematics" + Change
 *   tray      NO search. "Grade" + the twelve grades, hers starred; then the picked grade's subjects in two
 *             columns, hers first and starred, the rest A–Z. No grade is picked for her ("no last-used memory",
 *             operator 9 Oct) unless she teaches exactly one grade, or a value is already chosen.
 *   allowOther false  only her grades and her subjects; four classes or fewer are plain rows.
 */

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const combo = (grade: number | null, subject: string, extra: Record<string, unknown> = {}) => ({ grade, subject, source: "class", ...extra });

/** The design's heavy teacher: 14 classes, grades 3–8 (as GET /me/grade-subjects?feature=lessons gives them). */
const HEAVY = [
  combo(3, "English", { subjectKey: "english", featureKey: "english" }),
  combo(3, "Urdu", { subjectKey: "urdu", featureKey: "urdu" }),
  combo(3, "Mathematics", { subjectKey: "maths", featureKey: "math" }),
  combo(4, "English", { subjectKey: "english", featureKey: "english" }),
  combo(4, "Mathematics", { subjectKey: "maths", featureKey: "math" }),
  combo(4, "General Science", { subjectKey: "science", featureKey: "general_science" }),
  combo(5, "Mathematics", { subjectKey: "maths", featureKey: "math" }),
  combo(5, "General Science", { subjectKey: "science", featureKey: "general_science" }),
  combo(6, "Mathematics", { subjectKey: "maths", featureKey: "Mathematics" }),
  combo(6, "General Science", { subjectKey: "science", featureKey: "General Science" }),
  combo(7, "Mathematics", { subjectKey: "maths", featureKey: "Mathematics" }),
  combo(7, "General Science", { subjectKey: "science", featureKey: "General Science" }),
  combo(8, "Mathematics", { subjectKey: "maths", featureKey: "Mathematics" }),
  combo(8, "General Science", { subjectKey: "science", featureKey: "General Science" }),
  combo(null, "English", { subjectKey: "english" }), // early years: no grade, never offered
];
const LIGHT = [combo(4, "General Science", { subjectKey: "science" }), combo(5, "Math", { subjectKey: "maths" })];

const openTray = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const tray = (title: string) => screen.getByRole("dialog", { name: title });
const gradeRadios = () => screen.queryAllByRole("radio");
const subjectNames = (title: string) =>
  within(within(tray(title)).getByRole("region")).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("ClassPicker — the trigger", () => {
  it("empty: a 76px card with the label and ⌄, opening a dialog", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={HEAVY} />);
    const trig = screen.getByRole("button", { name: /Select grade and subject/ });
    expect(trig).toHaveAttribute("aria-haspopup", "dialog");
    expect(trig).toHaveClass("min-h-[76px]", "w-full", "rounded-2xl", "bg-white");
    expect(screen.getByText("Select grade and subject")).toHaveClass("text-[17px]", "font-semibold");
  });

  it("picked, one of hers: the subject tile, ★ Your class over \"Grade 6 · Mathematics\", Change", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={HEAVY} value={{ grade: 6, subject: "Mathematics" }} />);
    const trig = screen.getByRole("button", { name: /Grade 6 · Mathematics/ });
    expect(trig.querySelector("[data-icon='calc']")).not.toBeNull();
    expect(within(trig).getByText(TEACHER_UI_COPY.yourClass)).toBeTruthy();
    expect(within(trig).getByText(TEACHER_UI_COPY.change)).toHaveClass("h-[34px]", "rounded-full");
  });

  it("picked, not hers: \"Grade and subject\" over the pair — it is not her class", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={HEAVY} value={{ grade: 9, subject: "Physics" }} />);
    const trig = screen.getByRole("button", { name: /Grade 9 · Physics/ });
    expect(within(trig).getByText(TEACHER_UI_COPY.gradeAndSubject)).toBeTruthy();
    expect(within(trig).queryByText(TEACHER_UI_COPY.yourClass)).toBeNull();
  });

  it("her classes only: the label stays over the pair (Digital Coaching's \"Select your class\")", () => {
    inRouter(<ClassPicker label="Select your class" combos={HEAVY} allowOther={false} value={{ grade: 6, subject: "Mathematics" }} />);
    expect(screen.getByRole("button", { name: /Select your class.*Grade 6 · Mathematics/ })).toBeTruthy();
  });
});

describe("ClassPicker — the tray (any grade and subject)", () => {
  it("no search; Grade 1–12, her grades starred; no grade picked for her, so it asks for one", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={HEAVY} />);
    openTray(/Select grade and subject/);
    const t = tray("Select grade and subject");
    expect(within(t).queryByRole("searchbox")).toBeNull();
    expect(within(t).queryByRole("textbox")).toBeNull();
    const radios = within(t).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`));
    const yours = radios.filter((r) => /Your class/.test(r.getAttribute("aria-label") || "")).map((r) => r.textContent);
    expect(yours).toEqual(["Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8"]);
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(within(t).getByText(TEACHER_UI_COPY.selectGrade)).toBeTruthy();
    expect(within(t).queryByRole("region")).toBeNull();
    // the legend that says what the star means
    expect(within(t).getByText(TEACHER_UI_COPY.yourClass)).toBeTruthy();
  });

  it("a grade shows its subjects: hers first (starred), then the rest A–Z; one subject once however it is spelled", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={HEAVY} />);
    openTray(/Select grade and subject/);
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 4/ }));
    expect(screen.getByRole("radio", { name: /^Grade 4/ })).toHaveAttribute("aria-checked", "true");
    const t = tray("Select grade and subject");
    expect(within(t).getByRole("heading", { name: TEACHER_UI_COPY.gradeSubjects(4) })).toBeTruthy();
    // Her "Mathematics" (featureKey math) IS the catalogue's "Math": no second row for it.
    expect(subjectNames("Select grade and subject")).toEqual([
      "Grade 4 · English · Your class",
      "Grade 4 · General Science · Your class",
      "Grade 4 · Mathematics · Your class",
      "Grade 4 · Urdu",
    ]);
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 9/ }));
    expect(subjectNames("Select grade and subject")).toEqual([
      "Grade 9 · Biology", "Grade 9 · Chemistry", "Grade 9 · Computer Science", "Grade 9 · English",
      "Grade 9 · Mathematics", "Grade 9 · Pakistan Studies", "Grade 9 · Physics", "Grade 9 · Urdu",
    ]);
  });

  it("picking reports the pair and whether it is hers (with her combo), and closes", () => {
    const onChange = vi.fn();
    inRouter(<ClassPicker label="Select grade and subject" combos={HEAVY} onChange={onChange} />);
    openTray(/Select grade and subject/);
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 6/ }));
    fireEvent.click(screen.getByRole("button", { name: "Grade 6 · Mathematics · Your class" }));
    expect(onChange).toHaveBeenLastCalledWith(
      { grade: 6, subject: "Mathematics" },
      expect.objectContaining({ mine: true, combo: expect.objectContaining({ featureKey: "Mathematics" }) }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Grade 6 · Mathematics/ })).toBeTruthy();
    openTray(/Grade 6 · Mathematics/);
    // reopening shows what is chosen: its grade picked, its subject pressed
    expect(screen.getByRole("radio", { name: /^Grade 6/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Grade 6 · Mathematics · Your class" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 10/ }));
    fireEvent.click(screen.getByRole("button", { name: "Grade 10 · Physics" }));
    expect(onChange).toHaveBeenLastCalledWith({ grade: 10, subject: "Physics" }, expect.objectContaining({ mine: false, combo: null }));
  });

  it("she teaches one grade: that grade is already picked", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={[combo(4, "General Science", { subjectKey: "science", featureKey: "general_science" })]} />);
    openTray(/Select grade and subject/);
    expect(screen.getByRole("radio", { name: /^Grade 4/ })).toHaveAttribute("aria-checked", "true");
    expect(subjectNames("Select grade and subject")[0]).toBe("Grade 4 · General Science · Your class");
  });

  it("two grades (the light teacher): nothing picked for her", () => {
    inRouter(<ClassPicker label="Select grade and subject" combos={LIGHT} />);
    openTray(/Select grade and subject/);
    expect(gradeRadios().some((r) => r.getAttribute("aria-checked") === "true")).toBe(false);
  });

  it("a grade the feature has nothing for is off; `grades` limits the rest", () => {
    inRouter(<ClassPicker label="Pick" feature="assessment" grades={[1, 2, 3, 4, 5]} combos={[]} />);
    openTray(/Pick/);
    expect(screen.getByRole("radio", { name: /^Grade 5/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /^Grade 6/ })).toBeDisabled();
  });

  it("a class of hers the feature cannot open is shown, starred and off", () => {
    inRouter(<ClassPicker label="Pick" feature="assessment" combos={[combo(4, "Maths", { featureKey: "maths", available: true }), combo(4, "Computer", { featureKey: null, available: false })]} />);
    openTray(/Pick/);
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 4/ }));
    expect(screen.getByRole("button", { name: "Grade 4 · Computer · Your class" })).toBeDisabled();
  });

  it("to(value, pick) makes a subject a link", () => {
    inRouter(<ClassPicker label="Pick" combos={HEAVY} to={(v, p) => (p.mine ? `/lessons/${v.grade}/${String(p.combo?.featureKey)}` : undefined)} />);
    openTray(/Pick/);
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 6/ }));
    expect(screen.getByRole("link", { name: "Grade 6 · Mathematics · Your class" })).toHaveAttribute("href", "/lessons/6/Mathematics");
    expect(screen.getByRole("button", { name: "Grade 6 · Urdu" })).toBeTruthy();
  });
});

describe("ClassPicker — her classes only (allowOther false)", () => {
  it("only her grades and her subjects, no star legend", () => {
    inRouter(<ClassPicker label="Select your class" combos={HEAVY} allowOther={false} />);
    openTray(/Select your class/);
    expect(gradeRadios().map((r) => r.textContent)).toEqual(["Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8"]);
    expect(within(tray("Select your class")).queryByText(TEACHER_UI_COPY.yourClass)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^Grade 4/ }));
    expect(subjectNames("Select your class")).toEqual(["Grade 4 · English", "Grade 4 · General Science", "Grade 4 · Mathematics"]);
  });

  it("four classes or fewer: plain rows, one tap", () => {
    const onChange = vi.fn();
    inRouter(<ClassPicker label="Select your class" combos={LIGHT} allowOther={false} onChange={onChange} />);
    openTray(/Select your class/);
    expect(gradeRadios()).toHaveLength(0);
    const t = tray("Select your class");
    fireEvent.click(within(t).getByRole("button", { name: /Grade 5 · Math/ }));
    expect(onChange).toHaveBeenCalledWith({ grade: 5, subject: "Math" }, expect.objectContaining({ mine: true }));
  });

  it("more than four classes in ONE grade: no grade step, the subjects straight away", () => {
    const one = ["English", "Urdu", "Mathematics", "General Science", "Islamiat"].map((s) => combo(2, s));
    inRouter(<ClassPicker label="Select your class" combos={one} allowOther={false} />);
    openTray(/Select your class/);
    expect(gradeRadios()).toHaveLength(0);
    expect(subjectNames("Select your class")).toHaveLength(5);
  });
});

describe("ClassPicker — words", () => {
  it("the kit's new words exist in both languages", () => {
    for (const C of [TEACHER_UI_COPY, TEACHER_UI_UR]) {
      expect(C.yourClass).toBeTruthy();
      expect(C.gradeAndSubject).toBeTruthy();
      expect(C.gradeSubjects(4)).toContain("4");
    }
    expect(TEACHER_UI_UR.yourClass).not.toBe(TEACHER_UI_COPY.yourClass);
  });
});
