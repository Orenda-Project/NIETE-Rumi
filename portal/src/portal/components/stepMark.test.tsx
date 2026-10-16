import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";

/**
 * v10 coaching test (bd-v0toag.8, PR3) — the step her thing to try belongs to, outlined on the plan, and the
 * tap that takes her there. The heading is looked for after the plan is drawn, never before; not found is
 * nothing (no outline, no move). The page only moves when she taps (a new `jump`), never on its own.
 */

vi.mock("../lib/planSteps", () => ({ locateStep: vi.fn() }));

import { locateStep } from "../lib/planSteps";
import { StepOutline, jumpToMark, useStepJump, useStepMark } from "./stepMark";

const locate = locateStep as unknown as ReturnType<typeof vi.fn>;
const MARK = { page: 2, top: 0.25, height: 0.02 };
const doc = { numPages: 3, getPage: vi.fn() };

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  locate.mockResolvedValue(MARK);
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as never;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
});
afterEach(() => { document.body.innerHTML = ""; });

/** A pages box whose page 2 starts 1,000px down the page and is 800px tall. */
function pages() {
  const root = document.createElement("div");
  const p = document.createElement("div");
  p.setAttribute("data-page", "2");
  p.getBoundingClientRect = () => ({ top: 1000 - window.scrollY, height: 800 } as DOMRect);
  root.appendChild(p);
  document.body.appendChild(root);
  return root;
}

describe("useStepMark", () => {
  it("finds the step's heading in the drawn plan", async () => {
    const { result } = renderHook(() => useStepMark(doc, 3));
    await waitFor(() => expect(result.current).toEqual(MARK));
    expect(locate).toHaveBeenCalledWith(doc, 3);
  });

  it.each([[null], [undefined]])("no step (%p): nothing is looked for", async (step) => {
    const { result } = renderHook(() => useStepMark(doc, step));
    await new Promise((r) => setTimeout(r, 5));
    expect(result.current).toBeNull();
    expect(locate).not.toHaveBeenCalled();
  });

  it("no plan yet: nothing is looked for", async () => {
    const { result } = renderHook(() => useStepMark(null, 3));
    await new Promise((r) => setTimeout(r, 5));
    expect(result.current).toBeNull();
    expect(locate).not.toHaveBeenCalled();
  });

  it("not found: null", async () => {
    locate.mockResolvedValue(null);
    const { result } = renderHook(() => useStepMark(doc, 3));
    await waitFor(() => expect(locate).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("the step goes away: the outline goes too", async () => {
    const { result, rerender } = renderHook(({ s }) => useStepMark(doc, s), { initialProps: { s: 3 as number | null } });
    await waitFor(() => expect(result.current).toEqual(MARK));
    rerender({ s: null });
    expect(result.current).toBeNull();
  });
});

describe("jumpToMark", () => {
  it("scrolls the window to the heading, a little above it", () => {
    expect(jumpToMark(pages(), MARK)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 0.25 * 800 - 24, behavior: "smooth" });
  });

  it("reduced motion: no smooth scroll", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    jumpToMark(pages(), MARK);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("the page is not there: no move", () => {
    expect(jumpToMark(pages(), { ...MARK, page: 9 })).toBe(false);
    expect(jumpToMark(null, MARK)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("useStepJump", () => {
  it("moves once per tap, never on its own", () => {
    const root = { current: pages() };
    const { rerender } = renderHook(({ j, m }) => useStepJump(root, m, j), { initialProps: { j: 0, m: MARK as typeof MARK | null } });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ j: 1, m: MARK });
    rerender({ j: 1, m: { ...MARK } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    rerender({ j: 2, m: MARK });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("a tap before the heading is found moves once it is", () => {
    const root = { current: pages() };
    const { rerender } = renderHook(({ j, m }) => useStepJump(root, m, j), { initialProps: { j: 1, m: null as typeof MARK | null } });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ j: 1, m: MARK });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe("StepOutline", () => {
  it("a box over the heading's band, out of the way of taps and screen readers", () => {
    const { container } = render(<StepOutline mark={MARK} />);
    const box = container.firstChild as HTMLElement;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.className).toMatch(/pointer-events-none/);
    expect(box.className).toMatch(/absolute/);
    expect(box.style.top).toMatch(/^calc\(25%/);
  });

  // bd-v0toag.77 (Amena, 16 Oct): "the highlight doesnt stand out". Loud: a thick solid amber frame, a highlighter
  // fill that keeps the heading readable, a star on the corner, and a few pulses (none under reduced motion).
  it("loud: a thick amber frame, a highlighter fill and a star badge", () => {
    const { container } = render(<StepOutline mark={MARK} />);
    const box = container.firstChild as HTMLElement;
    const width = Number(/border-\[(\d+)px\]/.exec(box.className)?.[1] ?? 0);
    expect(width).toBeGreaterThanOrEqual(5);
    expect(box.className).toMatch(/border-\[#f59e0b\]/);
    expect(box.className).toMatch(/mix-blend-multiply/);
    expect(box.className).not.toMatch(/\/25\b/);
    expect(box.querySelector("[data-testid='step-star'] svg")).not.toBeNull();
  });

  it("pulses only when motion is welcome, and never forever", () => {
    const { container } = render(<StepOutline mark={MARK} />);
    const box = container.firstChild as HTMLElement;
    expect(box.className).toMatch(/motion-safe:animate-\[/);
    expect(box.className).not.toMatch(/(^|\s)animate-pulse/);
    expect(box.className).not.toMatch(/infinite/);
  });
});
