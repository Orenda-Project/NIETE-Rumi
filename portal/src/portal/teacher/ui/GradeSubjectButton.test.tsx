import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GradeSubjectButton } from "./GradeSubjectButton";

/**
 * bd-fmf24g.2.1 — GradeSubjectButton (COMPONENTS.md §1): a tappable grade + subject (or class). Tile + "Grade 4 ·
 * General Science" (16px/600) + optional second line + optional chip + chevron. Card or flat row; default,
 * selected (2px indigo edge, tint, check circle instead of the chevron) or disabled (45%, not tappable).
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("GradeSubjectButton", () => {
  it("names the grade and subject; a class adds its section; no grade shows the subject alone", () => {
    inRouter(<>
      <GradeSubjectButton grade={4} subject="General Science" />
      <GradeSubjectButton grade="4" section="A" subject="General Science" />
      <GradeSubjectButton grade="" subject="Physics" />
    </>);
    const [a, b, c] = screen.getAllByRole("button");
    expect(a).toHaveTextContent("Grade 4 · General Science");
    expect(b).toHaveTextContent("Grade 4-A · General Science");
    expect(c).toHaveTextContent(/^Physics$/);
  });

  it("with `to` it is a link that goes there; without, a button that calls onPress", () => {
    const onPress = vi.fn();
    inRouter(<>
      <GradeSubjectButton grade={5} subject="Math" to="/portal/teacher/lessons" />
      <GradeSubjectButton grade={3} subject="English" onPress={onPress} />
    </>);
    expect(screen.getByRole("link", { name: /Grade 5 · Math/ })).toHaveAttribute("href", "/portal/teacher/lessons");
    fireEvent.click(screen.getByRole("button", { name: /Grade 3 · English/ }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("card: 76px tall, white, 1px #e5e7eb edge, 16px corners, the soft shadow; tile + chevron that turns in RTL", () => {
    inRouter(<GradeSubjectButton grade={4} subject="General Science" sub="32 students" />);
    const btn = screen.getByRole("button");
    expect(classes(btn)).toEqual(expect.arrayContaining([
      "min-h-[76px]", "w-full", "rounded-2xl", "border", "border-[#e5e7eb]", "bg-white", "text-start",
      "shadow-[0_1px_3px_rgba(16,24,40,0.08)]",
    ]));
    expect(btn.querySelector("[data-icon='flask']")).not.toBeNull();
    expect(classes(btn.querySelector("[data-chevron]")!)).toEqual(expect.arrayContaining(["text-[#9ca3af]", "rtl:rotate-180"]));
    expect(screen.getByText("32 students")).toHaveClass("text-[13px]", "text-[#6b7280]");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("a chip shows its tone", () => {
    inRouter(<GradeSubjectButton grade={4} subject="Science" chip={{ text: "Not marked", tone: "waiting" }} />);
    expect(screen.getByText("Not marked")).toHaveClass("bg-[#fef3c7]", "text-[#b45309]", "h-[26px]", "rounded-full");
  });

  it("selected: 2px indigo edge on the tint, the tile tinted, a check circle instead of the chevron", () => {
    inRouter(<GradeSubjectButton grade={4} subject="Science" state="selected" />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(classes(btn)).toEqual(expect.arrayContaining(["border-2", "border-[#33374a]", "bg-[#f4f5f8]", "shadow-[0_4px_12px_rgba(51,55,74,0.14)]"]));
    expect(btn.querySelector("[data-chevron]")).toBeNull();
    expect(screen.getByRole("img", { name: "Selected" })).toHaveClass("h-7", "w-7", "rounded-full", "bg-[#33374a]");
    expect(classes(btn.querySelector("[data-icon]")!)).toContain("bg-[#e8e9f0]");
  });

  it("disabled: 45% opacity, no chevron, not tappable — even with `to` it is no link", () => {
    const onPress = vi.fn();
    inRouter(<>
      <GradeSubjectButton grade={6} subject="Urdu" state="disabled" onPress={onPress} />
      <GradeSubjectButton grade={7} subject="Urdu" state="disabled" to="/x" />
    </>);
    expect(screen.queryByRole("link")).toBeNull();
    const [a] = screen.getAllByRole("button");
    expect(a).toBeDisabled();
    expect(classes(a)).toContain("opacity-[.45]");
    expect(a.querySelector("[data-chevron]")).toBeNull();
    fireEvent.click(a);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("row variant: flat, divided by a 1px line except the first; selected = tint + a 3px indigo bar on the start edge", () => {
    inRouter(<>
      <GradeSubjectButton grade={4} subject="English" variant="row" first />
      <GradeSubjectButton grade={4} subject="Urdu" variant="row" state="selected" />
    </>);
    const [first, picked] = screen.getAllByRole("button");
    expect(classes(first)).not.toContain("border-t");
    expect(classes(first)).not.toContain("rounded-2xl");
    expect(classes(picked)).toEqual(expect.arrayContaining([
      "border-t", "border-[#f0f1f3]", "bg-[#f4f5f8]",
      "shadow-[inset_3px_0_0_#33374a]", "rtl:shadow-[inset_-3px_0_0_#33374a]",
    ]));
  });

  it("its words come from props (copy)", () => {
    inRouter(<GradeSubjectButton grade={2} subject="Urdu" state="selected" copy={{ grade: (g) => `جماعت ${g}`, selected: "منتخب" }} />);
    expect(screen.getByRole("button")).toHaveTextContent("جماعت 2 · Urdu");
    expect(screen.getByRole("img", { name: "منتخب" })).toBeInTheDocument();
  });
});
