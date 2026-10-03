import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CheckCircle2, Clock } from "lucide-react";
import { NumberGrid } from "./NumberGrid";
import { ToggleList } from "./ToggleList";
import { Hero } from "./Hero";
import { Chip } from "./Chip";
import { PROGRESS } from "./tokens";

/**
 * bd-5rz1v.19 — the pickers and the status screen (deep-screens.html `.grid4 .num`, `.toggles
 * .tog`, `.hero`). A picked number, a toggle that is on: indigo. A finished state: green.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("NumberGrid — e.g. Grade 1–12", () => {
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("is one choice laid out four across, 8px apart", () => {
    render(<NumberGrid label="Grade" numbers={numbers} value={4} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Grade" });
    expect(classes(group)).toEqual(expect.arrayContaining(["[display:grid]", "grid-cols-4", "gap-2"]));
    expect(classes(group)).not.toContain("grid");
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(numbers.map(String));
  });

  it("each number is a 58px tile; the picked one is filled indigo", () => {
    render(<NumberGrid label="Grade" numbers={numbers} value={4} onChange={() => {}} />);
    const four = screen.getByRole("radio", { name: "4" });
    const five = screen.getByRole("radio", { name: "5" });
    expect(four).toHaveAttribute("aria-checked", "true");
    expect(classes(four)).toEqual(expect.arrayContaining(["h-[58px]", "min-h-[56px]", "bg-nu-select", "border-nu-select", "text-white", "text-[22px]", "font-extrabold"]));
    expect(classes(five)).toEqual(expect.arrayContaining(["bg-nu-surface-card", "border-nu-surface-line", "text-nu-surface-text"]));
  });

  it("a number still to be done has a dashed border", () => {
    render(<NumberGrid label="Grade" numbers={numbers} value={null} required={[6]} onChange={() => {}} />);
    expect(classes(screen.getByRole("radio", { name: "6" }))).toContain("border-dashed");
  });

  it("tapping picks; arrow keys move the pick", () => {
    const onChange = vi.fn();
    render(<NumberGrid label="Grade" numbers={numbers} value={4} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "9" }));
    expect(onChange).toHaveBeenLastCalledWith(9);
    fireEvent.keyDown(screen.getByRole("radio", { name: "4" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(5);
  });
});

describe("ToggleList", () => {
  const options = [
    { key: "primary", label: "Primary", aside: <Chip>1–5</Chip> },
    { key: "middle", label: "Middle", aside: <Chip>6–8</Chip> },
    { key: "high", label: "High", aside: <Chip>9–10</Chip> },
  ];

  it("single: a radio group; the picked row is outlined indigo on the indigo tint, its box filled with a check", () => {
    render(<ToggleList label="Grades" options={options} value="primary" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Grades" });
    const on = within(group).getByRole("radio", { name: /Primary/ });
    const off = within(group).getByRole("radio", { name: /Middle/ });
    expect(on).toHaveAttribute("aria-checked", "true");
    expect(classes(on)).toEqual(expect.arrayContaining(["min-h-[64px]", "rounded-2xl", "border-2", "border-nu-select", "bg-nu-select-tint", "font-extrabold"]));
    expect(classes(off)).toEqual(expect.arrayContaining(["border-nu-surface-line", "bg-nu-surface-card"]));
    const box = on.querySelector("[data-box]")!;
    expect(classes(box)).toEqual(expect.arrayContaining(["h-7", "w-7", "rounded-[8px]", "bg-nu-select", "border-nu-select", "text-white"]));
    expect(box.querySelector("svg")).not.toBeNull();
    expect(classes(off.querySelector("[data-box]")!)).toContain("border-nu-surface-box");
    expect(on).toHaveTextContent("1–5");
  });

  it("multi: checkboxes, each toggles on its own", () => {
    const onChange = vi.fn();
    render(<ToggleList mode="multi" label="Grades" options={options} value={["primary"]} onChange={onChange} />);
    const middle = screen.getByRole("checkbox", { name: /Middle/ });
    expect(middle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(middle);
    expect(onChange).toHaveBeenLastCalledWith(["primary", "middle"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Primary/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("compact rows are still 56px", () => {
    render(<ToggleList compact label="Grades" options={options} value="primary" onChange={() => {}} />);
    for (const r of screen.getAllByRole("radio")) expect(classes(r)).toContain("min-h-[56px]");
  });
});

describe("Hero — the status screen", () => {
  it("a ring: green arc on the indigo-light track, the count in the middle, read as a progress bar", () => {
    render(<Hero title="Preparing…" ring={{ value: 140 / 360, text: "1:10" }} chips={<Chip tone="waiting" icon={Clock}>~2 min</Chip>} />);
    const ring = screen.getByRole("progressbar", { name: "Preparing…" });
    expect(ring).toHaveAttribute("aria-valuenow", "39");
    expect(ring).toHaveAttribute("aria-valuetext", "1:10");
    expect(classes(ring)).toEqual(expect.arrayContaining(["h-[116px]", "w-[116px]", "rounded-full"]));
    // The arc's colours come from the theme (tokens), only its angle from the value. (jsdom
    // drops a conic-gradient written as an inline style, and a raw hex would dodge the tokens.)
    expect(classes(ring)).toContain(
      "bg-[conic-gradient(theme(colors.nu.progress.DEFAULT)_var(--nu-ring),theme(colors.nu.progress.track)_0)]",
    );
    expect((ring as HTMLElement).style.getPropertyValue("--nu-ring")).toBe("140deg");
    expect(PROGRESS.bar).toBe("#48b078");
    expect(screen.getByText("1:10")).toBeInTheDocument();
    expect(screen.getByText("~2 min")).toBeInTheDocument();
  });

  it("an icon: done is a green circle; the title is 22px/800", () => {
    render(<Hero title="Ready" icon={CheckCircle2} tone="done" />);
    const circle = screen.getByTestId("newui-hero-icon");
    expect(classes(circle)).toEqual(expect.arrayContaining(["h-[84px]", "w-[84px]", "rounded-full", "bg-nu-done-bg", "text-nu-done"]));
    expect(classes(screen.getByText("Ready"))).toEqual(expect.arrayContaining(["text-[22px]", "font-extrabold"]));
  });

  it("waiting is amber; a spinner turns only when motion is allowed", () => {
    render(<Hero title="Writing…" icon={Clock} tone="waiting" spinning />);
    const circle = screen.getByTestId("newui-hero-icon");
    expect(classes(circle)).toEqual(expect.arrayContaining(["bg-nu-chip-warning-bg", "text-nu-chip-warning"]));
    expect(classes(circle.querySelector("svg")!)).toContain("motion-safe:animate-spin");
    expect(circle.querySelector("svg")!.getAttribute("class")).not.toMatch(/(^|\s)animate-spin/);
  });

  it("error is red (bd-5rz1v.17: a list that did not load)", () => {
    render(<Hero title="Not loaded" icon={Clock} tone="error" />);
    expect(classes(screen.getByTestId("newui-hero-icon"))).toEqual(expect.arrayContaining(["bg-nu-chip-error-bg", "text-nu-chip-error"]));
  });

  it("announces itself when its state changes (live)", () => {
    render(<Hero title="Ready" icon={CheckCircle2} tone="done" live />);
    expect(screen.getByTestId("newui-hero")).toHaveAttribute("aria-live", "polite");
  });
});
