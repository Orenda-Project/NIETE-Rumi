import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ProgressSteps, type ProgressStep } from "./ProgressSteps";

/**
 * bd-fmf24g.2.3 — ProgressSteps (COMPONENTS.md §6): where a report is up to. Steps come from the real stages
 * (DC: coaching_sessions.status; coach visit: review → debrief → delivery), passed by the page.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const STEPS: ProgressStep[] = [
  { label: "Lesson received", sub: "28 min · 2 Oct", state: "done" },
  { label: "Listening to your lesson", sub: "About 10 minutes", state: "done" },
  { label: "Reflection question", sub: "Answer by voice or text", state: "current", nowText: "Your turn" },
  { label: "Report ready", state: "later" },
];

describe("ProgressSteps", () => {
  it("a white card: heading + \"2 of 4\"; an ordered list with the current step marked", () => {
    render(<ProgressSteps heading="Progress" steps={STEPS} />);
    const card = screen.getByRole("region", { name: "Progress" });
    expect(classes(card)).toEqual(expect.arrayContaining(["rounded-2xl", "bg-white", "border-[#e5e7eb]"]));
    expect(within(card).getByText("2 of 4")).toHaveClass("bg-[#e8e9f0]", "text-[#33374a]");
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });

  it("dots: done green with a tick, current an indigo ring with a dot, later a grey ring with its number; the line is green under done", () => {
    render(<ProgressSteps heading="Progress" steps={STEPS} />);
    const dots = screen.getAllByTestId("step-dot");
    expect(classes(dots[0])).toEqual(expect.arrayContaining(["h-7", "w-7", "bg-[#2f7a52]"]));
    expect(dots[0].querySelector("svg")).not.toBeNull();
    expect(classes(dots[2])).toEqual(expect.arrayContaining(["border-[2.5px]", "border-[#33374a]"]));
    expect(dots[3]).toHaveTextContent("4");
    const lines = screen.getAllByTestId("step-line");
    expect(lines).toHaveLength(3);
    expect(classes(lines[0])).toContain("bg-[#2f7a52]");
    expect(classes(lines[2])).toContain("bg-[#e5e7eb]");
  });

  it("labels: current 700, done 600, later 500 grey; the current step's chip (its nowText, else Now)", () => {
    render(<ProgressSteps heading="Progress" steps={STEPS} />);
    expect(screen.getByText("Reflection question")).toHaveClass("font-bold");
    expect(screen.getByText("Lesson received")).toHaveClass("font-semibold");
    expect(screen.getByText("Report ready")).toHaveClass("font-medium", "text-[#6b7280]");
    expect(screen.getByText("Your turn")).toHaveClass("bg-[#fef3c7]", "text-[#b45309]");
    render(<ProgressSteps heading="Two" steps={[{ label: "A", state: "current" }]} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("done: one 56px green \"Done · …\" line; a tap shows the steps again", () => {
    render(<ProgressSteps heading="Progress" steps={STEPS} done doneLabel="Report ready" />);
    expect(screen.queryByRole("region")).toBeNull();
    const line = screen.getByRole("button", { name: /Done.*Report ready/ });
    expect(line).toHaveAttribute("aria-expanded", "false");
    expect(classes(line)).toEqual(expect.arrayContaining(["min-h-[56px]", "w-full", "bg-[#eaf6ef]", "text-[#2f7a52]"]));
    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Progress" })).toBeInTheDocument();
  });

  it("its words come from props (copy)", () => {
    render(<ProgressSteps heading="پیش رفت" steps={STEPS} copy={{ stepsCount: (d, n) => `${d} / ${n}`, now: "ابھی" }} />);
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
  });
});
