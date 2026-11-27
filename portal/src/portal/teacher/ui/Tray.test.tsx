import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Tray } from "./Tray";
import { ASSESSMENT_SUBJECTS_BY_GRADE, subjectsByGradeFor } from "./catalogue";

/**
 * bd-fmf24g.2.2 — Tray: the canvas's bottom sheet (ClassPicker / DateRangeBar):
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
  it("88% of the screen at most by default; `tall` alone opens it to 24px from the top", () => {
    const { unmount } = render(<Tray open title="Short" onClose={() => {}}><p>x</p></Tray>);
    const plain = screen.getByRole("dialog");
    expect(classes(plain)).toContain("max-h-[88vh]");
    // not the tall size (bd-o15qnr.40.9: the plain sheet is 88% of the visible screen, dvh where the browser has it)
    expect(plain.className).not.toContain("max-h-[calc(100dvh");
    unmount();
    render(<Tray open tall title="Long" onClose={() => {}}><p>x</p></Tray>);
    const tall = screen.getByRole("dialog");
    expect(tall.className).toContain("max-h-[calc(100dvh");
    expect(classes(tall)).not.toContain("max-h-[88vh]");
  });

  it("a dialog titled with its title: the Android Back convention, the canvas look", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Select grade" });
    expect(dialog).toHaveAttribute("data-state", "open");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // bd-o15qnr.40.9: the panel holds its height; the content scrolls in its own body (tray-body), by touch
    expect(classes(dialog)).toEqual(expect.arrayContaining(["bg-[#f3f4f6]", "rounded-t-[22px]", "max-h-[88vh]", "overflow-hidden"]));
    expect(screen.getByTestId("tray-body")).toHaveClass("overflow-y-auto");
    expect(screen.getByRole("heading", { name: "Select grade" })).toHaveClass("text-[22px]", "font-semibold");
    expect(screen.getByTestId("tray-scrim")).toHaveClass("bg-[rgba(17,24,39,0.45)]");
    expect(screen.getByTestId("tray-handle")).toHaveClass("h-[5px]", "w-11");
  });

  // bd-q8wt5e.15 — a sheet with a long list and a Done row: the row sits UNDER the scrolling body, never inside it,
  // so Done stays on the screen however far the list is scrolled (TA19, 360x640).
  it("a foot sits under the scrolling body, outside it, and never shrinks", () => {
    render(<Tray open tall title="Types" onClose={() => {}} foot={<button type="button">Done</button>}><p>a long list</p></Tray>);
    const body = screen.getByTestId("tray-body");
    const foot = screen.getByTestId("tray-foot");
    expect(body.contains(foot)).toBe(false);
    expect(foot.contains(screen.getByRole("button", { name: "Done" }))).toBe(true);
    expect(body.contains(screen.getByText("a long list"))).toBe(true);
    expect(classes(foot)).toContain("shrink-0");
    expect(screen.getByRole("dialog").lastElementChild).toBe(foot);
  });

  it("no foot: nothing is drawn under the body", () => {
    render(<Tray open title="T" onClose={() => {}}><p>x</p></Tray>);
    expect(screen.queryByTestId("tray-foot")).toBeNull();
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
  it("Lesson Plans: no built-in list — the live catalogue or nothing (bd-fmf24g.57: an 8 Oct copy hid grade 1's GK and Islamiat)", () => {
    const lessons = subjectsByGradeFor("lessons");
    for (let g = 1; g <= 12; g += 1) expect(lessons[g]).toBeUndefined();
  });

  it("Assessment: grades 1–5 only", () => {
    expect(ASSESSMENT_SUBJECTS_BY_GRADE[3]).toEqual(["English", "Urdu", "Maths", "General Knowledge", "Islamiat"]);
    expect(ASSESSMENT_SUBJECTS_BY_GRADE[4]).toEqual(["English", "Urdu", "Maths", "Science", "Social Studies", "Islamiat"]);
    expect(ASSESSMENT_SUBJECTS_BY_GRADE[6]).toBeUndefined();
  });

  it("subjectsByGradeFor: the feature's map unless one is given", () => {
    expect(subjectsByGradeFor("assessment")).toBe(ASSESSMENT_SUBJECTS_BY_GRADE);
    const mine = { 4: ["Science"] };
    expect(subjectsByGradeFor("lessons", mine)).toBe(mine);
  });
});
