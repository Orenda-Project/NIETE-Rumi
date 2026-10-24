import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { bandShape, titleWidth, useViewportWidth } from "./bandShape";

/**
 * The look's band picks its shape from an ESTIMATE of the greeting's width: two rows when "Salaam, <name>!" fits on
 * one line beside nothing, one row when it would wrap or the phone is narrower than 344 px. The estimate is
 * 10.5 px per code point in English; in Urdu 8 px per Urdu code point and 7 px per Latin one (the name at 0.7em).
 */
const LP = "Salaam, Lp Testwala!"; // 20 cp → 210 px
const COACH = "Salaam, Coach Testwala!"; // 23 cp → 241.5 px
const LONG = "Salaam, Muhammad Abdul Rehman Testwala!"; // 39 cp → 409.5 px
const UR_LP = "السلام علیکم، Lp Testwala!"; // 14 Urdu-side cp (the space after «،» included) + 12 Latin

describe("bandShape", () => {
  it.each([
    [LP, "en", 360, "two"],
    [COACH, "en", 360, "two"],
    [LONG, "en", 360, "one"],
    [LP, "en", 320, "one"],
    [UR_LP, "ur", 360, "two"],
    [UR_LP, "ur", 320, "one"],
    [LONG, "en", 390, "one"],
    [LONG, "en", 443, "one"],
    [LONG, "en", 444, "two"],
  ] as const)("%s (%s) at %i px → %s", (title, lang, vw, shape) => {
    expect(bandShape(title, lang, vw)).toBe(shape);
  });

  it("under 344 px every greeting is one row, however short", () => {
    expect(bandShape("Salaam!", "en", 343)).toBe("one");
    expect(bandShape("Salaam!", "en", 344)).toBe("two");
  });

  it("counts code points, not UTF-16 units, and weighs Urdu and Latin runs apart", () => {
    expect(titleWidth(LP, "en")).toBeCloseTo(210);
    expect(titleWidth(LONG, "en")).toBeCloseTo(409.5);
    expect(titleWidth(UR_LP, "ur")).toBe(14 * 8 + 12 * 7);
    expect(titleWidth("السلام علیکم، عائشہ!", "ur")).toBe(20 * 8);
  });
});

describe("useViewportWidth", () => {
  it("reads the page width and re-reads it on resize (a rotation re-decides)", () => {
    const el = document.documentElement;
    const spy = { w: 360 };
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => spy.w });
    const { result } = renderHook(() => useViewportWidth());
    expect(result.current).toBe(360);
    act(() => { spy.w = 640; window.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(640);
    delete (el as unknown as { clientWidth?: number }).clientWidth;
  });

  it("falls back to the window's width when the page reports 0 (a test DOM)", () => {
    const el = document.documentElement;
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 0 });
    const { result } = renderHook(() => useViewportWidth());
    expect(result.current).toBe(window.innerWidth);
    delete (el as unknown as { clientWidth?: number }).clientWidth;
  });
});
