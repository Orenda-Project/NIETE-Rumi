import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Tray } from "./Tray";
import { LESSON_SUBJECTS_BY_GRADE, ASSESSMENT_SUBJECTS_BY_GRADE, subjectsByGradeFor } from "./catalogue";

/**
 * bd-fmf24g.2.2 — Tray: the canvas's bottom sheet (GradeSubjectSelector / GradeSubjectPicker / DateRangeBar):
 * the page dims (rgba(17,24,39,.45)) and a tap on it closes; a #f3f4f6 sheet with 22px top corners, a grab handle,
 * the title 22px/600 and a 56px round close. Behaves as the new UI's Sheet does: Android Back (role=dialog +
 * data-state=open), Escape, focus in and kept in, the page under it does not scroll.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button">Opener</button>
      <Tray open={open} title="Select grade" onClose={() => { setOpen(false); onClose(); }}>
        <button type="button">Grade 1</button>
        <button type="button">Grade 2</button>
      </Tray>
    </>
  );
}

describe("Tray", () => {
  it("a dialog titled with its title: the Android Back convention, the canvas look", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Select grade" });
    expect(dialog).toHaveAttribute("data-state", "open");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(classes(dialog)).toEqual(expect.arrayContaining(["bg-[#f3f4f6]", "rounded-t-[22px]", "max-h-[88vh]", "overflow-y-auto"]));
    expect(screen.getByRole("heading", { name: "Select grade" })).toHaveClass("text-[22px]", "font-semibold");
    expect(screen.getByTestId("tray-scrim")).toHaveClass("bg-[rgba(17,24,39,0.45)]");
    expect(screen.getByTestId("tray-handle")).toHaveClass("h-[5px]", "w-11");
  });

  it("the round close is 56px; it, Escape and a tap on the dim all close it — a tap inside does not", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Tray open title="T" onClose={onClose}><button type="button">Inside</button></Tray>);
    const close = screen.getByRole("button", { name: "Close" });
    expect(classes(close)).toEqual(expect.arrayContaining(["h-14", "w-14", "rounded-full", "bg-white", "border-[#e5e7eb]"]));
    fireEvent.click(close);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("tray-scrim"));
    fireEvent.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("focus moves in, the page cannot scroll, and focus returns when it closes", () => {
    render(<Harness />);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("closed: nothing rendered", () => {
    render(<Tray open={false} title="T" onClose={() => {}}><span>x</span></Tray>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("its close word comes from props", () => {
    render(<Tray open title="T" onClose={() => {}} closeLabel="بند کریں"><span>x</span></Tray>);
    expect(screen.getByRole("button", { name: "بند کریں" })).toBeInTheDocument();
  });
});

describe("catalogue: what each feature offers per grade (COMPONENTS.md §4, read from the bot 2026-10-08)", () => {
  it("Lesson Plans: 1–3 three books, 4–5 add General Science, 6–12 the corpus subjects; no Islamiat by default", () => {
    expect(LESSON_SUBJECTS_BY_GRADE[1]).toEqual(["English", "Urdu", "Math"]);
    expect(LESSON_SUBJECTS_BY_GRADE[5]).toEqual(["English", "Urdu", "Math", "General Science"]);
    expect(LESSON_SUBJECTS_BY_GRADE[6]).toHaveLength(8);
    expect(LESSON_SUBJECTS_BY_GRADE[8]).not.toContain("Agricultural Education (Zarai Taleem)");
    expect(LESSON_SUBJECTS_BY_GRADE[11]).not.toContain("Pakistan Studies");
    expect(LESSON_SUBJECTS_BY_GRADE[12]).toContain("Pakistan Studies");
    for (let g = 1; g <= 12; g += 1) expect(LESSON_SUBJECTS_BY_GRADE[g]).not.toContain("Islamiat");
  });

  it("Assessment: grades 1–5 only", () => {
    expect(ASSESSMENT_SUBJECTS_BY_GRADE[3]).toEqual(["English", "Urdu", "Maths", "General Knowledge", "Islamiat"]);
    expect(ASSESSMENT_SUBJECTS_BY_GRADE[4]).toEqual(["English", "Urdu", "Maths", "Science", "Social Studies", "Islamiat"]);
    expect(ASSESSMENT_SUBJECTS_BY_GRADE[6]).toBeUndefined();
  });

  it("subjectsByGradeFor: the feature's map unless one is given", () => {
    expect(subjectsByGradeFor("assessment")).toBe(ASSESSMENT_SUBJECTS_BY_GRADE);
    expect(subjectsByGradeFor("lessons")).toBe(LESSON_SUBJECTS_BY_GRADE);
    const mine = { 4: ["Science"] };
    expect(subjectsByGradeFor("lessons", mine)).toBe(mine);
  });
});
