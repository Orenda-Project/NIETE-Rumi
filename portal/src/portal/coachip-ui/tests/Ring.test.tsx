import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Ring } from "../Ring";
import { RING } from "../tokens";

/** bd-sex15q.42 — the ring: the G10 attributes pass through to its root; a zero (or d = 0) draws the track only. */
describe("Ring", () => {
  it("passes data-* attributes through to its root (it can be the count node)", () => {
    const { container } = render(<Ring n={18} d={46} data-num={18} data-den={46} data-win="w1" data-grader="ai">18</Ring>);
    const root = container.firstElementChild as HTMLElement;
    expect([root.dataset.num, root.dataset.den, root.dataset.win, root.dataset.grader]).toEqual(["18", "46", "w1", "ai"]);
    expect(root.textContent).toBe("18");
    expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws an arc of n/d of the circumference from 12 o'clock", () => {
    const { container } = render(<Ring n={23} d={46} size="hero" />);
    const arc = container.querySelector("[data-arc]") as SVGCircleElement;
    const { size, stroke } = RING.hero;
    const c = 2 * Math.PI * ((size - stroke) / 2);
    expect(arc.getAttribute("stroke-dasharray")).toBe(`${(c / 2).toFixed(2)} ${c.toFixed(2)}`);
    expect(arc.getAttribute("transform")).toContain("rotate(-90");
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it.each([[0, 46], [0, 0], [5, 0]])("n=%i d=%i draws the track only: no arc, nothing that reads as a score", (n, d) => {
    const { container } = render(<Ring n={n} d={d} />);
    expect(container.querySelector("[data-arc]")).toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("never overdraws past a full circle", () => {
    const { container } = render(<Ring n={60} d={46} size="row" />);
    const [a, c] = (container.querySelector("[data-arc]") as SVGCircleElement).getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(a).toBeCloseTo(c, 1);
  });
});
