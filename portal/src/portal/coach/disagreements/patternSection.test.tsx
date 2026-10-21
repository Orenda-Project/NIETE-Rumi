import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import type { Pattern } from "./api";
import { PatternSection } from "./patternSection";

/**
 * bd-tbprit.10 — Rifat's "3. Is this a pattern?": the line of her last lessons (average dashed, best green, now gold),
 * then four facts — average · best, recordings a week against the ICT average, the step missed here over her last 5
 * checked lessons, and her earlier "don't agree" taps. What the server does not have is said, never guessed.
 */
const day = (d: number) => new Date(Date.UTC(2026, 7, 21) + d * 86400000 + 5 * 3600000).toISOString();
const P = (extra: Partial<Pattern> = {}): Pattern => ({
  points: [72, 69, 75, 65, 58].map((pct, i) => ({ pct, date: day([0, 13, 26, 39, 53][i]) })),
  avg: 68, best: { pct: 75, date: day(26) }, now: 58, count: 12,
  perWeek: 1.6, level: "steady", ictAvg: 1.52, firstDate: day(0), lastDate: day(53),
  missed: { step: "Collaborative Structures", n: 5, of: 5 }, earlier: 0,
  ...extra,
});
const fact = (i: number) => screen.getAllByTestId("pattern-fact")[i];

beforeEach(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("PatternSection", () => {
  it("the title, the lesson count and the chart: average, best and now", () => {
    render(<PatternSection p={P()} />);
    const s = screen.getByTestId("pattern");
    expect(s).toHaveTextContent("3. Is this a pattern?");
    expect(s).toHaveTextContent("last 12 lessons");
    const svg = within(s).getByRole("img");
    expect(svg).toHaveTextContent("her average 68%");
    expect(svg).toHaveTextContent("58 now");
    expect(svg).toHaveTextContent("75");
    expect(svg).toHaveTextContent("21 Aug");
    expect(svg).toHaveTextContent("13 Oct");
    expect(svg.querySelectorAll("circle")).toHaveLength(2);
  });

  it("average · best: this lesson her lowest", () => {
    render(<PatternSection p={P()} />);
    expect(fact(0)).toHaveTextContent("Average score · best");
    expect(fact(0)).toHaveTextContent("68% · 75%");
    expect(fact(0)).toHaveTextContent("This lesson (58%) is her lowest in 12 lessons. Best was 16 Sep.");
  });

  it("average · best: just below her average", () => {
    render(<PatternSection p={P({ now: 64, points: [72, 69, 75, 60, 64].map((pct, i) => ({ pct, date: day(i) })) })} />);
    expect(fact(0)).toHaveTextContent("This lesson (64%) is just below her average. Best was 16 Sep.");
  });

  it("recordings a week: steady, with the span; active, low risk; recording less, at risk", () => {
    const { unmount } = render(<PatternSection p={P()} />);
    expect(fact(1)).toHaveTextContent("Recordings per week");
    expect(within(fact(1)).getByTestId("pattern-pill")).toHaveTextContent("1.6 · steady");
    expect(fact(1)).toHaveTextContent("12 lessons from 21 Aug to 13 Oct. ICT average is 1.52.");
    unmount();
    const r = render(<PatternSection p={P({ perWeek: 3, level: "active" })} />);
    expect(within(fact(1)).getByTestId("pattern-pill")).toHaveTextContent("3.0 · active");
    expect(fact(1)).toHaveTextContent("ICT average is 1.52. Low risk of her dropping off.");
    r.unmount();
    render(<PatternSection p={P({ perWeek: 0.5, level: "atRisk" })} />);
    expect(within(fact(1)).getByTestId("pattern-pill")).toHaveTextContent("0.5 · recording less");
  });

  it("the missed step: n of 5, a repeated gap", () => {
    render(<PatternSection p={P()} />);
    expect(fact(2)).toHaveTextContent("Collaborative Structures missed in last 5 lessons");
    expect(within(fact(2)).getByTestId("pattern-pill")).toHaveTextContent("5 of 5");
    expect(fact(2)).toHaveTextContent("Repeated gap, not a one-off.");
  });

  it("plan not checked says so; nothing missed says none", () => {
    const { unmount } = render(<PatternSection p={P({ missed: null })} />);
    expect(fact(2)).toHaveTextContent("Plan not checked");
    unmount();
    render(<PatternSection p={P({ missed: { step: null, n: 0, of: 4 } })} />);
    expect(fact(2)).toHaveTextContent("Steps missed in last 4 lessons");
    expect(fact(2)).toHaveTextContent("None");
  });

  it("earlier taps: none is her first time; some are counted", () => {
    const { unmount } = render(<PatternSection p={P()} />);
    expect(fact(3)).toHaveTextContent("Earlier “don’t agree” taps");
    expect(fact(3)).toHaveTextContent("None");
    expect(fact(3)).toHaveTextContent("First time she has disagreed, so take it seriously.");
    unmount();
    render(<PatternSection p={P({ earlier: 2 })} />);
    expect(fact(3)).toHaveTextContent("2");
  });

  it("fewer than 2 scored lessons: no chart, never a made-up line; one lesson, no rate", () => {
    render(<PatternSection p={P({ points: [{ pct: 58, date: day(0) }], count: 1, perWeek: null, level: null })} />);
    expect(screen.getByTestId("pattern").querySelector("svg")).toBeNull();
    expect(screen.getByTestId("pattern")).toHaveTextContent("Not enough AI scores for a line yet");
    expect(within(fact(1)).queryByTestId("pattern-pill")).toBeNull();
  });

  it("in Urdu: Rifat's words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<PatternSection p={P()} />);
    expect(screen.getByTestId("pattern")).toHaveTextContent("3. کیا یہ بار بار ہو رہا ہے؟");
    expect(fact(1)).toHaveTextContent("ہفتے میں ریکارڈنگز");
    expect(fact(2)).toHaveTextContent("5 میں سے 5");
    expect(fact(3)).toHaveTextContent("یہ پہلی بار ہے، اس لیے سنجیدگی سے لیں۔");
    expect(screen.getByRole("img")).toHaveTextContent("21 اگست");
  });
});
