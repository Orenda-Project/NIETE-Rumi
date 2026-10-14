import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * v10 coaching test (bd-v0toag.8, PR2) — the thing to try, as a strip above a grade 1–5 plan.
 *
 *   GET  /teacher/thing-to-try?lessonId=   → { thing: { text, tag } | null }  (null for all but C and D)
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

  it("a tap opens the full text and logs the tap with the lesson (no step yet)", async () => {
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
});
