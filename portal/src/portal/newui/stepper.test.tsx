import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Stepper } from "./Stepper";
import { ToggleChips } from "./Chip";
import { tapProblems } from "./checks/rules";

/**
 * bd-5rz1v.13 — two kit pieces the Assessment page needs (deep-screens.html, Assessment):
 *
 *   Stepper      "− 15 +": a number picked with two 56px buttons, never typed. The bounds are
 *                the caller's (the server's), and a button at its bound is disabled.
 *   ToggleChips  any number of chips on at once (question types). An "on" chip is SELECTED, so
 *                it is indigo with a check; off is outlined. Each sits in a 56px target.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("Stepper", () => {
  it("shows the number between a minus and a plus, as a named group", () => {
    render(<Stepper label="Questions" value={15} min={1} max={50} onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Questions" });
    const [minus, plus] = within(group).getAllByRole("button");
    expect(minus).toHaveAccessibleName("Minus");
    expect(plus).toHaveAccessibleName("Plus");
    expect(within(group).getByText("15")).toBeInTheDocument();
  });

  it("minus and plus step by one", () => {
    const onChange = vi.fn();
    render(<Stepper label="Questions" value={15} min={1} max={50} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Plus" }));
    expect(onChange).toHaveBeenLastCalledWith(16);
    fireEvent.click(screen.getByRole("button", { name: "Minus" }));
    expect(onChange).toHaveBeenLastCalledWith(14);
  });

  it("stops at its bounds: minus is disabled at the minimum, plus at the maximum", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper label="Questions" value={1} min={1} max={50} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Minus" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Plus" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Minus" }));
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Stepper label="Questions" value={50} min={1} max={50} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Plus" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Plus" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a value outside the bounds is shown clamped, and steps from the clamped value", () => {
    const onChange = vi.fn();
    render(<Stepper label="Questions" value={60} min={1} max={25} onChange={onChange} />);
    expect(screen.getByText("25")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minus" }));
    expect(onChange).toHaveBeenLastCalledWith(24);
  });

  it("has no text field: the number cannot be typed", () => {
    render(<Stepper label="Questions" value={15} min={1} max={50} onChange={() => {}} />);
    expect(document.querySelector("input")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("announces the number when it changes", () => {
    render(<Stepper label="Questions" value={15} min={1} max={50} onChange={() => {}} />);
    expect(screen.getByText("15").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("buttons are 56px squares with 16px corners; the number is 34px/800 (mockup .stepper)", () => {
    render(<Stepper label="Questions" value={15} min={1} max={50} onChange={() => {}} />);
    for (const name of ["Minus", "Plus"]) {
      expect(classes(screen.getByRole("button", { name }))).toEqual(expect.arrayContaining(["h-14", "w-14", "rounded-2xl"]));
    }
    expect(classes(screen.getByText("15"))).toEqual(expect.arrayContaining(["text-[34px]", "font-extrabold", "tabular-nums"]));
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("takes its button names as props (Urdu, or a screen's own words)", () => {
    render(<Stepper label="Questions" value={15} min={1} max={50} onChange={() => {}} decreaseLabel="Fewer questions" increaseLabel="More questions" />);
    expect(screen.getByRole("button", { name: "Fewer questions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More questions" })).toBeInTheDocument();
  });
});

describe("ToggleChips", () => {
  const options = [
    { key: "mcq", label: "MCQ" },
    { key: "fill", label: "Fill in" },
    { key: "short", label: "Short" },
  ];

  it("is a named group of checkboxes, any number on", () => {
    render(<ToggleChips label="Question types" options={options} value={["mcq", "short"]} onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Question types" });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "true"]);
  });

  it("tapping toggles one chip and keeps the others", () => {
    const onChange = vi.fn();
    render(<ToggleChips label="Question types" options={options} value={["mcq"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Fill in/ }));
    expect(onChange).toHaveBeenLastCalledWith(["mcq", "fill"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /MCQ/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("an on chip is selected indigo with a check; off is outlined white; each is a 56px target", () => {
    render(<ToggleChips label="Question types" options={options} value={["mcq"]} onChange={() => {}} />);
    const on = screen.getByRole("checkbox", { name: /MCQ/ }).querySelector("[data-pill]")!;
    const off = screen.getByRole("checkbox", { name: /Short/ }).querySelector("[data-pill]")!;
    expect(classes(on)).toEqual(expect.arrayContaining(["border-nu-select", "bg-nu-chip-selected-bg", "text-nu-chip-selected"]));
    expect(on.querySelector("svg")).not.toBeNull();
    expect(classes(off)).toEqual(expect.arrayContaining(["border-nu-surface-line", "bg-nu-surface-card", "text-nu-surface-text"]));
    expect(off.querySelector("svg")).toBeNull();
    expect(tapProblems(document.body)).toEqual([]);
  });
});
