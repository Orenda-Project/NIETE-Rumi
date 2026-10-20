import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * v10 coaching test (bd-v0toag.8, PR2) — the thing to try, as a strip above a grade 1–5 plan.
 *
 *   GET  /teacher/thing-to-try?lessonId=   → { thing: { text, tag, step } | null }  (null for all but C and D;
 *                                            step = { name, index } of the plan step the move belongs to, or null)
 *   POST /teacher/thing-to-try/tap         { lessonId, step }  — fire-and-forget
 *
 * No thing, a failed read or an odd answer: no strip, nothing else on the page changes. A tap opens
 * the full text and is logged; it never waits on the post or shows an error.
 */

vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { ThingToTryStrip } from "./ThingToTryStrip";
import { LESSONS_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const TEXT = "Ask one child to explain to a neighbour.";

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: { success: true, thing: { text: TEXT, tag: "hlp_peer_talk" } } });
  http.post.mockResolvedValue({ status: 204 });
});

describe("ThingToTryStrip", () => {
  it("C and D: the label and the text, read for this lesson", async () => {
    render(<ThingToTryStrip lessonId="grade_1_english_ch8_seg6" />);
    const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
    expect(strip.textContent).toContain(TEXT);
    expect(http.get).toHaveBeenCalledWith("/teacher/thing-to-try", { params: { lessonId: "grade_1_english_ch8_seg6" } });
  });

  it.each([
    ["thing null (A, B, outside the draw, switch off)", { data: { success: true, thing: null } }],
    ["an odd answer", { data: {} }],
    ["no text", { data: { success: true, thing: { text: "" } } }],
  ])("%s: no strip", async (_label, answer) => {
    http.get.mockResolvedValue(answer);
    const { container } = render(<ThingToTryStrip lessonId="a" />);
    await waitFor(() => expect(http.get).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
  });

  it("a failed read: no strip, no error", async () => {
    http.get.mockRejectedValue(new Error("502"));
    const { container } = render(<ThingToTryStrip lessonId="a" />);
    await waitFor(() => expect(http.get).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
  });

  it("a tap with no step logs step null", async () => {
    render(<ThingToTryStrip lessonId="grade_1_english_ch8_seg6" />);
    const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
    expect(strip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(strip);
    expect(strip.getAttribute("aria-expanded")).toBe("true");
    expect(http.post).toHaveBeenCalledWith("/teacher/thing-to-try/tap", { lessonId: "grade_1_english_ch8_seg6", step: null });
  });

  it("a tap whose post fails changes nothing she sees", async () => {
    http.post.mockRejectedValue(new Error("x"));
    render(<ThingToTryStrip lessonId="a" />);
    const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
    fireEvent.click(strip);
    expect(strip.getAttribute("aria-expanded")).toBe("true");
    expect(strip.textContent).toContain(TEXT);
  });

  it("a target of 56px or more", async () => {
    render(<ThingToTryStrip lessonId="a" />);
    const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
    expect(strip.className).toMatch(/min-h-\[(5[6-9]|[6-9]\d)px\]/);
  });

  // bd-v0toag.77 (Amena, 16 Oct): "neither does the yellow box". A solid amber block with a thick edge and a
  // shadow, not a pale cream one; the star sits in a dark badge, bigger; the label is bold.
  it("loud: solid amber, thick edge, shadow, a big star in a badge", async () => {
    render(<ThingToTryStrip lessonId="a" />);
    const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
    expect(strip.className).toMatch(/bg-\[#fbbf24\]/);
    expect(strip.className).not.toMatch(/#fffbeb/);
    expect(Number(/border-\[(\d+)px\]/.exec(strip.className)?.[1] ?? 0)).toBeGreaterThanOrEqual(3);
    expect(strip.className).toMatch(/shadow-/);
    const badge = strip.querySelector("[data-testid='strip-star']") as HTMLElement;
    expect(badge.className).toMatch(/bg-\[#b45309\]/);
    expect(badge.querySelector("svg")!.getAttribute("class")).toMatch(/h-(6|7|8)\b/);
    expect(strip.querySelector("span.font-bold")?.textContent).toContain(C.thingToTry);
  });

  describe("the step (PR3)", () => {
    const STEP = { name: "We Do", index: 3 };
    beforeEach(() => {
      http.get.mockResolvedValue({ data: { success: true, thing: { text: TEXT, tag: "hlp_peer_talk", step: STEP } } });
    });

    it("shows the step's name beside the label", async () => {
      render(<ThingToTryStrip lessonId="a" />);
      const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
      expect(strip.textContent).toContain("We Do");
    });

    it("tells the page the step once the thing is read", async () => {
      const onStep = vi.fn();
      render(<ThingToTryStrip lessonId="a" onStep={onStep} />);
      await waitFor(() => expect(onStep).toHaveBeenCalledWith(3));
    });

    it("no thing: tells the page there is no step", async () => {
      http.get.mockResolvedValue({ data: { success: true, thing: null } });
      const onStep = vi.fn();
      render(<ThingToTryStrip lessonId="a" onStep={onStep} />);
      await waitFor(() => expect(onStep).toHaveBeenCalledWith(null));
    });

    it("an odd step is no step", async () => {
      http.get.mockResolvedValue({ data: { success: true, thing: { text: TEXT, tag: null, step: { name: "x", index: "3" } } } });
      const onStep = vi.fn();
      render(<ThingToTryStrip lessonId="a" onStep={onStep} />);
      await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
      expect(onStep).toHaveBeenLastCalledWith(null);
    });

    it("a tap logs the step's number and takes her to it; closing does not", async () => {
      const onShowStep = vi.fn();
      render(<ThingToTryStrip lessonId="a" onShowStep={onShowStep} />);
      const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
      fireEvent.click(strip);
      expect(http.post).toHaveBeenCalledWith("/teacher/thing-to-try/tap", { lessonId: "a", step: 3 });
      expect(onShowStep).toHaveBeenCalledTimes(1);
      fireEvent.click(strip);
      expect(onShowStep).toHaveBeenCalledTimes(1);
    });
  });

  it("no step: a tap does not ask to take her anywhere", async () => {
    const onShowStep = vi.fn();
    render(<ThingToTryStrip lessonId="a" onShowStep={onShowStep} />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.thingToTry) }));
    expect(onShowStep).not.toHaveBeenCalled();
  });
});
