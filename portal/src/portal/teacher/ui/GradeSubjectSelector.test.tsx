import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { GradeSubjectSelector, type GradeSubjectValue } from "./GradeSubjectSelector";

/**
 * bd-fmf24g.2.2 — GradeSubjectSelector (COMPONENTS.md §4), trays mode (operator, 8 Oct: "Select Grade and then a
 * popover tray kind of thing opens to show the same component on grade selector as shown, same for subject").
 * Two 68px field buttons; Grade opens a tray of all twelve grade pills (4 across); Subject (off until a grade)
 * opens a tray of that grade's subjects. Picking closes the tray; a new grade clears a subject it does not have.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
/** What a reader gets: the text without the decorative (aria-hidden) parts, such as a SubjectTile's "Aa". */
const shown = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (c.textContent || "").trim();
};

function Controlled({ feature = "lessons", initial = null, spy = vi.fn() }: { feature?: "lessons" | "assessment"; initial?: GradeSubjectValue | null; spy?: (v: GradeSubjectValue) => void }) {
  const [v, setV] = useState<GradeSubjectValue | null>(initial);
  return <GradeSubjectSelector feature={feature} value={v} onChange={(n) => { setV(n); spy(n); }} />;
}

describe("GradeSubjectSelector — the two fields", () => {
  it("empty: Grade says Select grade; Subject says Select subject and is off until a grade", () => {
    render(<Controlled />);
    const grade = screen.getByRole("button", { name: /Grade.*Select grade/ });
    const subject = screen.getByRole("button", { name: /Subject.*Select subject/ });
    expect(grade).toHaveAttribute("aria-haspopup", "dialog");
    expect(grade).toHaveAttribute("aria-expanded", "false");
    expect(classes(grade)).toEqual(expect.arrayContaining(["min-h-[68px]", "w-full", "rounded-2xl", "bg-white", "border", "border-[#e5e7eb]"]));
    expect(subject).toBeDisabled();
    expect(classes(subject)).toContain("opacity-50");
  });

  it("picked: Grade 9 and the subject with its tile", () => {
    render(<Controlled initial={{ grade: 9, subject: "Physics" }} />);
    expect(screen.getByRole("button", { name: /Grade.*Grade 9/ })).toBeInTheDocument();
    const subject = screen.getByRole("button", { name: /Subject.*Physics/ });
    expect(subject).toBeEnabled();
    expect(subject.querySelector("[data-icon='atom']")).not.toBeNull();
  });
});

describe("GradeSubjectSelector — the grade tray", () => {
  it("all twelve grades as pills, four across, 64px; a grade with nothing for the feature is flat grey and can't be picked", () => {
    render(<Controlled feature="assessment" />);
    fireEvent.click(screen.getByRole("button", { name: /Select grade/ }));
    const tray = screen.getByRole("dialog", { name: "Select grade" });
    const group = within(tray).getByRole("radiogroup", { name: "Grade" });
    expect(classes(group)).toEqual(expect.arrayContaining(["[display:grid]", "grid-cols-4", "gap-2"]));
    const pills = within(group).getAllByRole("radio");
    expect(pills.map((p) => p.textContent)).toEqual(["Grade1", "Grade2", "Grade3", "Grade4", "Grade5", "Grade6", "Grade7", "Grade8", "Grade9", "Grade10", "Grade11", "Grade12"]);
    expect(classes(pills[0])).toEqual(expect.arrayContaining(["h-16", "rounded-[14px]", "bg-white"]));
    expect(pills[5]).toBeDisabled();
    expect(classes(pills[5])).toEqual(expect.arrayContaining(["bg-[#eceef1]", "text-[#9ca3af]", "shadow-none"]));
    expect(screen.getByRole("button", { name: /Select grade/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("picking a grade closes the tray, shows it, opens the Subject field; the picked pill is indigo next time", () => {
    const spy = vi.fn();
    render(<Controlled spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: /Select grade/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Grade\s*4/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spy).toHaveBeenLastCalledWith({ grade: 4, subject: null });
    expect(screen.getByRole("button", { name: /Subject.*Select subject/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Grade 4/ }));
    const on = screen.getByRole("radio", { name: /Grade\s*4/ });
    expect(on).toHaveAttribute("aria-checked", "true");
    expect(classes(on)).toEqual(expect.arrayContaining(["bg-[#33374a]", "text-white"]));
  });

  it("arrow keys move the focus (a row is 4 grades) over the grades that can be picked; Enter/Space picks — an arrow never closes the tray", () => {
    render(<Controlled feature="assessment" initial={{ grade: 5, subject: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /Grade 5/ }));
    const five = screen.getByRole("radio", { name: /Grade\s*5/ });
    expect(five).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /Grade\s*4/ })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(five, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Grade\s*4/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Grade\s*4/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    // 6 has nothing for Assessment: the focus stays on 5, the last grade that can be picked
    expect(document.activeElement).toBe(five);
    fireEvent.keyDown(five, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Grade\s*1$/ }));
    fireEvent.click(document.activeElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Grade 1/ })).toBeInTheDocument();
  });
});

describe("GradeSubjectSelector — the subject tray", () => {
  it("that grade's subjects as rows; picking one closes the tray and reports both", () => {
    const spy = vi.fn();
    render(<Controlled spy={spy} initial={{ grade: 9, subject: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /Select subject/ }));
    const tray = screen.getByRole("dialog", { name: "Select subject" });
    const rows = within(tray).getAllByRole("button", { pressed: false });
    expect(rows.map(shown)).toEqual(["English", "Urdu", "Mathematics", "Pakistan Studies", "Physics", "Chemistry", "Biology", "Computer Science"]);
    fireEvent.click(within(tray).getByRole("button", { name: "Physics" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spy).toHaveBeenLastCalledWith({ grade: 9, subject: "Physics" });
  });

  it("the picked subject shows selected in the tray", () => {
    render(<Controlled initial={{ grade: 4, subject: "Math" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Subject.*Math/ }));
    expect(screen.getByRole("button", { name: /^Math/, pressed: true })).toBeInTheDocument();
  });

  it("a new grade keeps a subject it has, and clears one it does not", () => {
    const spy = vi.fn();
    render(<Controlled spy={spy} initial={{ grade: 4, subject: "English" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Grade 4/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Grade\s*9/ }));
    expect(spy).toHaveBeenLastCalledWith({ grade: 9, subject: "English" });
    fireEvent.click(screen.getByRole("button", { name: /Subject.*English/ }));
    fireEvent.click(screen.getByRole("button", { name: "Physics" }));
    fireEvent.click(screen.getByRole("button", { name: /Grade 9/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Grade\s*3/ }));
    expect(spy).toHaveBeenLastCalledWith({ grade: 3, subject: null });
  });
});

describe("GradeSubjectSelector — data and words", () => {
  it("subjectsByGrade replaces the built-in map; grades limits what can be picked", () => {
    render(<GradeSubjectSelector subjectsByGrade={{ 2: ["Urdu"], 7: ["Science"] }} grades={[2]} defaultValue={{ grade: 2, subject: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /Grade 2/ }));
    expect(screen.getByRole("radio", { name: /Grade\s*7/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Grade\s*1$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /Select subject/ }));
    expect(within(screen.getByRole("dialog")).getAllByRole("button", { pressed: false }).map(shown)).toEqual(["Urdu"]);
  });

  it("uncontrolled (defaultValue) works on its own", () => {
    render(<GradeSubjectSelector />);
    fireEvent.click(screen.getByRole("button", { name: /Select grade/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Grade\s*2/ }));
    expect(screen.getByRole("button", { name: /Grade 2/ })).toBeInTheDocument();
  });

  it("its words come from props (copy)", () => {
    render(<GradeSubjectSelector copy={{ gradeField: "جماعت", selectGrade: "جماعت چنیں" }} />);
    expect(screen.getByRole("button", { name: /جماعت.*جماعت چنیں/ })).toBeInTheDocument();
  });
});
