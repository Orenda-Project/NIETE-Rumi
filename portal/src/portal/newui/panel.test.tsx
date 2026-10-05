import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Lightbulb, Mic } from "lucide-react";
import { Fold, Panel } from "./Panel";
import { tapProblems } from "./checks/rules";

/**
 * bd-5rz1v.26 — Panel and Fold: a section of CONTENT (a report's feedback, a transcript), with
 * one short heading. Coaching's lesson page is long; its words are the Digital Coach's, not UI
 * copy. Each section gets an icon and 1–3 words; a long one folds.
 *
 *   Panel  the List card (16px corners, 1.5px line) with a heading row: a 42px neutral tile and a
 *          15.5px/800 title. Information: nothing about it looks tappable.
 *   Fold   the same card whose heading row is a 60px button with a ⌄ that turns when open
 *          (only under motion-safe); aria-expanded and aria-controls tie it to its body.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("Panel", () => {
  it("is the list card with a heading: a neutral tile, a short title, then its content", () => {
    render(<Panel icon={Lightbulb} title="Try next time"><p>Ask a child to point on the map.</p></Panel>);
    const panel = screen.getByRole("region", { name: "Try next time" });
    expect(classes(panel)).toEqual(expect.arrayContaining(["rounded-2xl", "border-[1.5px]", "border-nu-surface-line", "bg-nu-surface-card"]));
    expect(within(panel).getByRole("heading", { name: "Try next time" })).toBeInTheDocument();
    expect(classes(within(panel).getByTestId("newui-panel-tile"))).toEqual(expect.arrayContaining(["bg-nu-neutral-tile", "text-nu-neutral-icon", "h-[42px]", "w-[42px]"]));
    expect(within(panel).getByText("Ask a child to point on the map.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button")).toBeNull();
  });
});

describe("Fold", () => {
  it("starts closed: a heading button with ⌄, its body not rendered", () => {
    render(<Fold icon={Mic} title="What was said"><p>Teacher: line 1</p></Fold>);
    const btn = screen.getByRole("button", { name: "What was said" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Teacher: line 1")).toBeNull();
    const chevron = btn.querySelector("[data-fold-chevron]")!;
    expect(classes(chevron)).toEqual(expect.arrayContaining(["motion-safe:transition-transform"]));
    expect(classes(chevron)).not.toContain("transition-transform");
  });

  it("opens and closes on a tap; the body is the region the button controls", () => {
    render(<Fold icon={Mic} title="What was said"><p>Teacher: line 1</p></Fold>);
    const btn = screen.getByRole("button", { name: "What was said" });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const body = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(within(body).getByText("Teacher: line 1")).toBeInTheDocument();
    expect(classes(btn.querySelector("[data-fold-chevron]")!)).toContain("rotate-180");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Teacher: line 1")).toBeNull();
  });

  it("can start open", () => {
    render(<Fold icon={Mic} title="Rubric" defaultOpen><p>Good</p></Fold>);
    expect(screen.getByRole("button", { name: "Rubric" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Good")).toBeInTheDocument();
  });

  it("its heading is a 56px target", () => {
    render(<Fold icon={Mic} title="Rubric"><p>Good</p></Fold>);
    expect(tapProblems(document.body)).toEqual([]);
  });
});
