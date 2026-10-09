import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { FeatureArt, FeatureGlyph, FeatureMotionProvider, FEATURE_HUE, COACH_FEATURES } from "./index";

/** bd-4404s7.1 (PR 1) — the coach's Schedule (rose) and Schools (teal): art, glyph, hue, motion on the shared timer. */
describe("coach feature colours and art", () => {
  it("Schedule rose, Schools teal (Coach_TileOptions B)", () => {
    expect(FEATURE_HUE.schedule).toEqual({ fg: "#be185d", bg: "#fce7f3" });
    expect(FEATURE_HUE.schools).toEqual({ fg: "#0f766e", bg: "#ccfbf1" });
  });
  it("Reports olive #4d7c0f on #ecfccb (ReportsIcon board)", () => {
    expect(FEATURE_HUE.reports).toEqual({ fg: "#4d7c0f", bg: "#ecfccb" });
  });
  it("the coach's four, in Home's order", () => {
    expect(COACH_FEATURES).toEqual(["schedule", "observations", "schools", "training"]);
  });
  it.each(["schedule", "schools", "reports"] as const)("%s: a 48-unit ink-outlined drawing", (f) => {
    const { container } = render(<FeatureArt feature={f} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 48 48");
    expect(svg).toHaveAttribute("data-feature-art", f);
    expect(svg.querySelector("g")).toHaveAttribute("stroke", "#33374a");
    expect(svg.innerHTML).toContain(FEATURE_HUE[f].fg);
  });
  it.each(["schedule", "schools", "reports"] as const)("%s: a still menu glyph in currentColor", (f) => {
    const { container } = render(<FeatureGlyph name={f} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("data-glyph", f);
    expect(svg).toHaveAttribute("data-still", "true");
    expect(svg.innerHTML).toMatch(/currentColor/);
  });
});

describe("coach art motion", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const mount = () => render(
    <FeatureMotionProvider>
      <FeatureArt feature="schedule" size={80} motion />
      <FeatureArt feature="schools" size={80} motion />
      <FeatureArt feature="observations" size={80} motion />
    </FeatureMotionProvider>,
  );
  it("the clock badge pops and its hand swings; the dots twinkle", () => {
    const { container } = mount();
    const q = (s: string) => container.querySelector(`svg[data-feature-art="schedule"] ${s}`);
    expect(q(".fm-bdg")).not.toBeNull();
    expect(q(".fm-hnd")).not.toBeNull();
    expect(container.querySelectorAll('svg[data-feature-art="schedule"] .fm-tw').length).toBeGreaterThan(0);
  });
  it("the flag swings; the windows twinkle", () => {
    const { container } = mount();
    expect(container.querySelector('svg[data-feature-art="schools"] .fm-flg')).not.toBeNull();
    expect(container.querySelectorAll('svg[data-feature-art="schools"] .fm-tw').length).toBeGreaterThan(0);
  });
  it("Reports: the three bars rise in turn from their foot, the % badge pops after the first bar", () => {
    const { container } = render(<FeatureMotionProvider><FeatureArt feature="reports" size={80} motion /></FeatureMotionProvider>);
    const bars = container.querySelectorAll('svg[data-feature-art="reports"] .fm-brs');
    expect(bars).toHaveLength(3);
    expect(Array.from(bars).map((b) => (b.getAttribute("class") || "").match(/fm-t\d/)?.[0] ?? "")).toEqual(["", "fm-t1", "fm-t2"]);
    expect(container.querySelector('svg[data-feature-art="reports"] .fm-bdg.fm-t3')).not.toBeNull();
  });
  it("they play together with the others on ONE shared timer, then all replay together", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = mount();
    expect(vi.getTimerCount()).toBe(1);
    const motion = () => Array.from(container.querySelectorAll("svg[data-feature-art]")).map((s) => s.getAttribute("data-motion"));
    expect(motion()).toEqual(["arrive", "arrive", "arrive"]);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(motion()).toEqual(["again", "again", "again"]);
  });
  it("nothing under reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
    const { container } = mount();
    container.querySelectorAll("svg[data-feature-art]").forEach((s) => expect(s.getAttribute("class")).not.toMatch(/fm-on/));
    expect(vi.getTimerCount()).toBe(0);
  });
});
