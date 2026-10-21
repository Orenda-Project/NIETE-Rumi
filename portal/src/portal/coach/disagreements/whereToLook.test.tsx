import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import i18n from "i18next";
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { clipUrl: (id: string, at: number, to?: number) => `/clip/${id}?at=${at}${to == null ? "" : `&to=${to}`}` },
}));
import type { Card, Move } from "./api";
import { ClipProvider } from "./cardParts";
import { WhereToLook } from "./whereToLook";

/**
 * bd-tbprit.9 — Rifat's "B. Where to look": the recording, one Listen for the problem part only (start to end)
 * with what to listen for, then the four sections. Lesson Plan Fidelity is the plan's moves only — three numbers,
 * steps with their own counts, ✓ / ½ / ✗, a why under each Partial or No, ★ key moves, the most-missed step open.
 * The other three keep their indicators with the AI's score out of 4.
 */
const mv = (id: string, phase: string, verdict: string, at: number | null, extra: Partial<Move> = {}): Move =>
  ({ id, text: `Move ${id}`, phase, mustHappen: false, verdict, evidence: null, translation: null, why: null, at, ...extra });
const MOVES = [
  mv("o1", "Opening", "executed", 30), mv("o2", "Opening", "executed", 90),
  mv("e1", "Explain", "executed", 400), mv("e2", "Explain", "substituted_better", 700),
  mv("w1", "We Do", "executed", 860), mv("w2", "We Do", "partial", 1000, { mustHappen: true, why: "Only two pairs talked" }),
  mv("w3", "We Do", "not_done", null, { mustHappen: true, text: "Children practise with a partner", why: "Children answered her, not each other" }),
  mv("y1", "You Do", "executed", 1300), mv("c1", "Check", "not_adjudicable", null),
];
const item = (id: string, name: string, score: number | null, at: number | null = null) => ({ id, name, score, evidence: `Quote ${name}`, at, applicable: score != null });

function card(extra: Partial<Card> = {}): Card {
  return {
    id: "c1", teacher: "Sadia Bibi", reasons: ["missed"], durationSec: 2300, moves: MOVES,
    evidence: [{ code: "missed", noPlan: false, moves: [MOVES[6]], items: [] }],
    indicators: [
      { key: "lesson_plan_fidelity", score: 23, max: 40, counted: true, items: [item("B1", "Instructional Clarity", 2)] },
      { key: "high_leverage_practices", score: 29, max: 48, counted: true, items: [item("C1", "Questioning", 3, 500), item("C2", "Feedback", null)] },
      { key: "student_engagement", score: 20, max: 28, counted: true, items: [] },
    ],
    ...extra,
  } as unknown as Card;
}
const renderIt = (c: Card) => render(<ClipProvider id={c.id}><WhereToLook card={c} /></ClipProvider>);

beforeEach(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("WhereToLook — the problem part", () => {
  it("the recording's length; one Listen for the most-missed step, start to end, and what to listen for", () => {
    renderIt(card());
    const where = screen.getByTestId("where-to-look");
    expect(where).toHaveTextContent("B. Where to look");
    expect(where).toHaveTextContent("Recording · 38:20");
    const listen = within(where).getByRole("button", { name: "▶ Listen to We Do · 14:05 – 17:25" });
    expect(where).toHaveTextContent("Listen for: Children practise with a partner");
    expect(document.querySelector("audio")).toBeNull();
    fireEvent.click(listen);
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("/clip/c1?at=845&to=1045");
  });

  it("the part starts after the recording stopped: no player, the line instead", () => {
    renderIt(card({ durationSec: 720 }));
    const where = screen.getByTestId("where-to-look");
    expect(where).toHaveTextContent("This part is not in the recording. The recording stopped at 12:00.");
    expect(within(where).queryByRole("button", { name: /Listen to/ })).toBeNull();
    expect(where).toHaveTextContent("🎙 Short recording: only 12 minutes were recorded (less than 15). Nothing after 12:00 is in the report.");
  });

  it("no plan: the DC's evidence times, labelled by what it heard", () => {
    renderIt(card({ moves: null, evidence: [{ code: "score", items: [item("C1", "Questioning", 1, 500)] }] }));
    fireEvent.click(screen.getByRole("button", { name: "▶ Listen · 8:05 – 9:05" }));
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("/clip/c1?at=485&to=545");
    expect(screen.getByTestId("where-to-look")).toHaveTextContent("Listen for: Questioning");
  });
});

describe("WhereToLook — Lesson Plan Fidelity, moves only", () => {
  it("no B indicators; three numbers: moves in her plan, moves she did, % done", () => {
    renderIt(card());
    const lpf = screen.getByTestId("section-lesson_plan_fidelity");
    fireEvent.click(within(lpf).getByRole("button", { name: /Lesson Plan Fidelity/ }));
    expect(lpf).not.toHaveTextContent("Instructional Clarity");
    expect(within(lpf).getByTestId("mv-total")).toHaveTextContent("8");
    expect(within(lpf).getByTestId("mv-done")).toHaveTextContent("6½");
    expect(within(lpf).getByTestId("mv-pct")).toHaveTextContent("81%");
    expect(lpf).toHaveTextContent("6 Yes");
    expect(lpf).toHaveTextContent("1 Partial");
    expect(lpf).toHaveTextContent("1 No");
  });

  it("steps with their own counts; the most-missed open and marked; ✓ ½ ✗ and ?, never a raw verdict; why under Partial and No; ★", () => {
    renderIt(card());
    const lpf = screen.getByTestId("section-lesson_plan_fidelity");
    fireEvent.click(within(lpf).getByRole("button", { name: /Lesson Plan Fidelity/ }));
    const weDo = within(lpf).getByTestId("step-We Do");
    expect(weDo).toHaveTextContent("most missed");
    expect(weDo).toHaveTextContent("1½ / 3");
    expect(within(lpf).getByTestId("step-Opening")).toHaveTextContent("2 / 2");
    expect(within(lpf).getByTestId("step-Opening")).not.toHaveTextContent("Move o1");
    const marks = within(weDo).getAllByTestId("move-mark").map((m) => m.getAttribute("data-mark"));
    expect(marks).toEqual(["yes", "partial", "no"]);
    expect(weDo).toHaveTextContent("★ Children practise with a partner");
    expect(weDo).toHaveTextContent("Children answered her, not each other");
    expect(weDo).toHaveTextContent("Only two pairs talked");
    expect(lpf).not.toHaveTextContent(/not_done|executed|partial\b/);
    fireEvent.click(within(lpf).getByRole("button", { name: /Check/ }));
    expect(within(lpf).getByTestId("step-Check")).toHaveTextContent("not recorded (not counted)");
  });
});

describe("WhereToLook — the other sections", () => {
  it("score/max · %, lowest and disputed tags; opened, each indicator with the AI's score out of 4", () => {
    renderIt(card());
    expect(screen.getByTestId("section-lesson_plan_fidelity")).toHaveTextContent("23 / 40 · 58%");
    expect(screen.getByTestId("section-lesson_plan_fidelity")).toHaveTextContent("disputed");
    expect(screen.getByTestId("section-lesson_plan_fidelity")).toHaveTextContent("lowest");
    const hlp = screen.getByTestId("section-high_leverage_practices");
    fireEvent.click(within(hlp).getByRole("button", { name: /High Leverage Practices/ }));
    expect(hlp).toHaveTextContent("Questioning");
    expect(hlp).toHaveTextContent("AI score 3/4");
    expect(hlp).toHaveTextContent("2 FICO indicators, scored 1–4");
  });

  it("a plan not checked says so and opens to nothing invented", () => {
    renderIt(card({ moves: null, indicators: [{ key: "lesson_plan_fidelity", score: null, max: null, counted: false, items: [] }] }));
    expect(screen.getByTestId("section-lesson_plan_fidelity")).toHaveTextContent("not checked");
  });

  it("Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderIt(card());
    const where = screen.getByTestId("where-to-look");
    expect(where).toHaveTextContent("B. کہاں دیکھیں");
    expect(where).toHaveTextContent("حصہ وار کارکردگی");
  });
});
