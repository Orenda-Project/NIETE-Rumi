import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { FeatureArt, FeatureMotionProvider, FEATURE_HUE } from "./index";

/**
 * The Quizzes tile's picture (operator, 30 Oct 2026: "design a better quiz icon, animated as well"): a question bubble
 * over three answers, the right one ticked, drawn in the feature art's idiom and Lesson Plans' green (a quiz follows a
 * lesson), moving with the motion set's own keyframes.
 */
describe("the quiz picture", () => {
  it("a 48-unit ink-outlined drawing in Lesson Plans' green, decorative by default", () => {
    const { container } = render(<FeatureArt feature="quiz" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 48 48");
    expect(svg).toHaveAttribute("data-feature-art", "quiz");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelector("g")).toHaveAttribute("stroke", "#33374a");
    expect(svg.innerHTML).toContain(FEATURE_HUE.lessons.fg);
    expect(svg.innerHTML).toContain(FEATURE_HUE.lessons.bg);
  });
});

describe("the quiz picture's movement", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the bubble pulses, the three answers hop in turn, the right one's tick draws in, a sparkle twinkles", () => {
    const { container } = render(<FeatureMotionProvider><FeatureArt feature="quiz" size={44} motion /></FeatureMotionProvider>);
    const svg = container.querySelector('svg[data-feature-art="quiz"]')!;
    expect(svg.getAttribute("data-motion")).toBe("arrive");
    expect(svg.querySelector(".fm-bub")).not.toBeNull();
    const hops = Array.from(svg.querySelectorAll(".fm-hop"));
    expect(hops).toHaveLength(3);
    expect(hops.map((h) => (h.getAttribute("class") || "").match(/fm-t\d/)?.[0])).toEqual(["fm-t1", "fm-t2", "fm-t3"]);
    expect(svg.querySelectorAll(".fm-dr")).toHaveLength(1);
    expect(svg.querySelectorAll(".fm-tw").length).toBeGreaterThan(0);
  });

  it("without motion it is still", () => {
    const { container } = render(<FeatureArt feature="quiz" />);
    expect(container.querySelector("svg")).toHaveAttribute("data-still", "true");
  });
});
