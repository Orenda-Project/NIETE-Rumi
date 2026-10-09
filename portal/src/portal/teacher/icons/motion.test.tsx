import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { FeatureArt, FeatureGlyph, FeatureMotionProvider, TEACHER_FEATURES, type TeacherFeature } from "./index";

/**
 * bd-fmf24g.18 — the feature icons' small movements. Operator (2026-10-09): they all move TOGETHER, on ONE shared
 * timer — once when the screen opens, then together again after one random 30–60 s gap, re-drawn after each play.
 * "If they move separately from each other it might give the info that it wants you to click it."
 * Nothing moves under reduced motion or while the app is hidden; the menu glyphs never move.
 */

const mount = (features: readonly TeacherFeature[] = TEACHER_FEATURES) =>
  render(
    <FeatureMotionProvider>
      {features.map((f) => <FeatureArt key={f} feature={f} size={80} motion />)}
      <FeatureGlyph name="lessons" />
    </FeatureMotionProvider>,
  );

const arts = (c: HTMLElement) => Array.from(c.querySelectorAll<SVGElement>("svg[data-feature-art]"));

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"), media: q,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
}

describe("feature icon motion", () => {
  beforeEach(() => { vi.useFakeTimers(); stubReducedMotion(false); setHidden(false); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); setHidden(false); });

  it("every icon plays its arrival movement together on mount", () => {
    const { container } = mount();
    const all = arts(container);
    expect(all).toHaveLength(7);
    expect(all.map((s) => s.getAttribute("data-motion"))).toEqual(Array(7).fill("arrive"));
    all.forEach((s) => expect(s.getAttribute("class")).toMatch(/\bfm-on\b/));
  });

  it("the seven movements are drawn: page, sound bars, sparkles, bubble, tick, tassel, badge, pupils", () => {
    const { container } = mount();
    const has = (f: string, part: string) => container.querySelector(`svg[data-feature-art="${f}"] .${part}`);
    expect(has("lessons", "fm-pg")).not.toBeNull();
    expect(has("coaching", "fm-wv")).not.toBeNull();
    expect(has("coaching", "fm-tw")).not.toBeNull();
    expect(has("observations", "fm-bub")).not.toBeNull();
    expect(has("observations", "fm-dr")).not.toBeNull();
    expect(has("training", "fm-tas")).not.toBeNull();
    expect(has("assessment", "fm-dr")).not.toBeNull();
    expect(has("assessment", "fm-bdg")).not.toBeNull();
    expect(has("attendance", "fm-dr")).not.toBeNull();
    expect(container.querySelectorAll('svg[data-feature-art="classes"] .fm-hop')).toHaveLength(3);
  });

  it("ONE shared timer for all seven icons, set between 30 and 60 s", () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    mount();
    expect(vi.getTimerCount()).toBe(1);
    const gaps = spy.mock.calls.map((c) => Number(c[1])).filter((n) => n >= 1000);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeGreaterThanOrEqual(30_000);
    expect(gaps[0]).toBeLessThanOrEqual(60_000);
  });

  it("the gap is random: 30 s at the low end, 60 s at the high end", () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    vi.spyOn(Math, "random").mockReturnValue(0);
    mount();
    expect(spy.mock.calls.map((c) => Number(c[1])).filter((n) => n >= 1000)).toEqual([30_000]);
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    mount();
    const last = spy.mock.calls.map((c) => Number(c[1])).filter((n) => n >= 1000).pop()!;
    expect(last).toBeGreaterThan(59_990);
    expect(last).toBeLessThanOrEqual(60_000);
  });

  it("when it fires, all seven replay at the same moment (restarted together), and a new gap is drawn", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // 45 s
    const { container } = mount();
    const before = arts(container);
    act(() => { vi.advanceTimersByTime(44_999); });
    expect(arts(container)).toEqual(before); // nothing moved early
    act(() => { vi.advanceTimersByTime(1); });
    const after = arts(container);
    expect(after.map((s) => s.getAttribute("data-motion"))).toEqual(Array(7).fill("again"));
    after.forEach((s, i) => expect(s).not.toBe(before[i])); // every svg restarted, in the same commit
    expect(vi.getTimerCount()).toBe(1); // re-drawn: exactly one pending timer again
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(arts(container).every((s) => s.getAttribute("data-motion") === "again")).toBe(true);
    expect(arts(container)[0]).not.toBe(after[0]);
  });

  it("never moves under reduced motion: no class, no timer", () => {
    stubReducedMotion(true);
    const { container } = mount();
    arts(container).forEach((s) => {
      expect(s.hasAttribute("data-motion")).toBe(false);
      expect(s.getAttribute("class") || "").not.toMatch(/fm-on/);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while the app is hidden, and starts counting again when it is back", () => {
    const { container } = mount();
    expect(vi.getTimerCount()).toBe(1);
    act(() => setHidden(true));
    expect(vi.getTimerCount()).toBe(0);
    const before = arts(container);
    act(() => { vi.advanceTimersByTime(180_000); });
    expect(arts(container)).toEqual(before);
    act(() => setHidden(false));
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(arts(container).every((s) => s.getAttribute("data-motion") === "again")).toBe(true);
  });

  it("the timer goes with the screen: unmount leaves nothing scheduled", () => {
    const { unmount } = mount();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the menu glyphs never move, even inside the provider", () => {
    const { container } = mount();
    const glyph = container.querySelector<SVGElement>("svg[data-glyph]")!;
    expect(glyph.hasAttribute("data-motion")).toBe(false);
    expect(glyph.innerHTML).not.toMatch(/fm-/);
    expect(glyph.getAttribute("class") || "").not.toMatch(/fm-/);
  });

  it("art that did not opt in stays still, inside the provider too", () => {
    const { container } = render(<FeatureMotionProvider><FeatureArt feature="lessons" /></FeatureMotionProvider>);
    const svg = container.querySelector("svg")!;
    expect(svg.hasAttribute("data-motion")).toBe(false);
    expect(svg.getAttribute("data-still")).toBe("true");
  });

  it("opting in without a provider does nothing (no timer, no class)", () => {
    const { container } = render(<FeatureArt feature="training" motion />);
    expect(container.querySelector("svg")!.hasAttribute("data-motion")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
