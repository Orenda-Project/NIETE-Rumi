import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GradeSubjectPicker } from "./GradeSubjectPicker";

/**
 * bd-fmf24g.2.2 — GradeSubjectPicker (COMPONENTS.md §5), THE grade·subject picker. Operator: "a button that you
 * click that opens a popup showing your grade subjects to select"; "show these are your classes vs these are
 * other classes"; "order them in a way that makes it easier to find". Her combinations come from
 * GET /api/portal/me/grade-subjects (bd-fmf24g.3): `{ grade, subject, subjectKey, source, … }`.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
/** What a reader gets: the text without the decorative (aria-hidden) parts, such as a SubjectTile's "Aa". */
const shown = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (c.textContent || "").trim();
};
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const COMBOS = [
  { grade: 5, subject: "Math", subjectKey: "math", source: "class" as const },
  { grade: 4, subject: "General Science", subjectKey: "general_science", source: "class" as const },
  { grade: 3, subject: "English", subjectKey: "english", source: "class" as const },
  { grade: 4, subject: "general science", subjectKey: "general_science", source: "history" as const },
  { grade: null, subject: "English", subjectKey: "english", source: "class" as const },
];
const open = (label = "Select lesson plan") => fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));

describe("GradeSubjectPicker — the trigger", () => {
  it("empty: a 76px card with the stack tile, the label and ⌄", () => {
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} />);
    const trig = screen.getByRole("button", { name: /Select lesson plan/ });
    expect(trig).toHaveAttribute("aria-haspopup", "dialog");
    expect(classes(trig)).toEqual(expect.arrayContaining(["min-h-[76px]", "w-full", "rounded-2xl", "bg-white", "border-[#e5e7eb]"]));
    expect(screen.getByText("Select lesson plan")).toHaveClass("text-[17px]", "font-semibold");
  });

  it("picked: the subject tile, the label small over \"Grade 4 · General Science\", and a Change pill", () => {
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} value={{ grade: 4, subject: "General Science" }} />);
    const trig = screen.getByRole("button", { name: /Grade 4 · General Science/ });
    expect(trig.querySelector("[data-icon='flask']")).not.toBeNull();
    expect(within(trig).getByText("Select lesson plan")).toHaveClass("text-[13px]", "text-[#6b7280]");
    expect(within(trig).getByText("Change")).toHaveClass("h-[34px]", "rounded-full", "font-bold");
  });
});

describe("GradeSubjectPicker — the sheet", () => {
  it("titled with the label; Your classes first: tinted card, star, count; grade then subject A–Z, one pair once, no grade-less pair", () => {
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} />);
    open();
    const sheet = screen.getByRole("dialog", { name: "Select lesson plan" });
    const mine = within(sheet).getByRole("region", { name: /Your classes/ });
    expect(within(mine).getByRole("heading", { name: /Your classes/ })).toHaveTextContent("Your classes3");
    const rows = within(mine).getAllByRole("button");
    expect(rows.map(shown)).toEqual(["Grade 3 · English", "Grade 4 · General Science", "Grade 5 · Math"]);
    expect(classes(mine.querySelector("[data-card]")!)).toEqual(expect.arrayContaining(["bg-[#eef0f7]", "border-[1.5px]", "border-[#c9cde0]"]));
  });

  it("recentFirst keeps the order given", () => {
    inRouter(<GradeSubjectPicker label="Pick" combos={COMBOS} recentFirst allowOther={false} />);
    open("Pick");
    const rows = within(screen.getByRole("region", { name: /Your classes/ })).getAllByRole("button");
    expect(rows.map(shown)).toEqual(["Grade 5 · Math", "Grade 4 · General Science", "Grade 3 · English"]);
  });

  it("Other classes: everything else the feature offers, under a sticky heading per grade, subjects A–Z, subject only", () => {
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} />);
    open();
    const other = screen.getByRole("region", { name: "Other classes" });
    const heads = within(other).getAllByTestId("grade-heading");
    expect(heads.map((h) => h.textContent)).toEqual(["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"]);
    expect(classes(heads[0])).toEqual(expect.arrayContaining(["sticky", "-top-2", "bg-[#f3f4f6]", "text-[13px]", "font-extrabold"]));
    const g3 = within(other).getByRole("group", { name: "Grade 3" });
    expect(within(g3).getAllByRole("button").map(shown)).toEqual(["Math", "Urdu"]);
    const g4 = within(other).getByRole("group", { name: "Grade 4" });
    expect(within(g4).getAllByRole("button").map(shown)).toEqual(["English", "Math", "Urdu"]);
  });

  it("allowOther off: only her classes", () => {
    inRouter(<GradeSubjectPicker label="Choose class" combos={COMBOS} allowOther={false} />);
    open("Choose class");
    expect(screen.queryByRole("region", { name: "Other classes" })).toBeNull();
  });

  it("search: a number is the grade exactly, words match the subject, both together narrow; nothing left says No match", () => {
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} />);
    open();
    const search = screen.getByRole("searchbox", { name: "Search grade or subject" });
    expect(search).toHaveClass("h-14");
    fireEvent.change(search, { target: { value: "physics" } });
    expect(screen.queryByRole("region", { name: /Your classes/ })).toBeNull();
    const heads = within(screen.getByRole("region", { name: "Other classes" })).getAllByTestId("grade-heading").map((h) => h.textContent);
    expect(heads).toEqual(["Grade 9", "Grade 10", "Grade 11", "Grade 12"]);
    fireEvent.change(search, { target: { value: "4 sci" } });
    expect(within(screen.getByRole("region", { name: /Your classes/ })).getAllByRole("button").map(shown)).toEqual(["Grade 4 · General Science"]);
    expect(screen.queryByRole("region", { name: "Other classes" })).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No match")).toBeInTheDocument();
  });

  it("the current value is selected wherever it is; picking closes the sheet and reports it", () => {
    const onChange = vi.fn();
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} value={{ grade: 9, subject: "Physics" }} onChange={onChange} />);
    open("Grade 9 · Physics");
    expect(within(screen.getByRole("group", { name: "Grade 9" })).getByRole("button", { name: /Physics/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(screen.getByRole("region", { name: /Your classes/ })).getByRole("button", { name: /Grade 5 · Math/ }));
    expect(onChange).toHaveBeenCalledWith({ grade: 5, subject: "Math" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("to(value) makes every row a link to that pair", () => {
    inRouter(<GradeSubjectPicker label="Select lesson plan" combos={COMBOS} allowOther={false} to={(v) => `/portal/teacher/lessons/${v.grade}/${encodeURIComponent(v.subject)}`} />);
    open();
    expect(screen.getByRole("link", { name: /Grade 4 · General Science/ })).toHaveAttribute("href", "/portal/teacher/lessons/4/General%20Science");
  });

  it("its words come from props (copy)", () => {
    inRouter(<GradeSubjectPicker label="سبق" combos={COMBOS} value={{ grade: 3, subject: "English" }} copy={{ change: "بدلیں", yourClasses: "آپ کی کلاسیں", otherClasses: "دوسری کلاسیں", search: "تلاش", noMatch: "کچھ نہیں" }} />);
    expect(screen.getByText("بدلیں")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /سبق/ }));
    expect(screen.getByRole("region", { name: /آپ کی کلاسیں/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "دوسری کلاسیں" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "تلاش" })).toBeInTheDocument();
  });
});
