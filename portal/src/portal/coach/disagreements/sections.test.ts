import { describe, it, expect } from "vitest";
import type { Card, Move } from "./api";
import { markOf, stepsOf, mostMissed, moveTotals, indicatorCounts, disputedKeys, lowestKey, halves, isShort, stepWindow, itemsWindow, fitToRecording, problemPart } from "./sections";

/**
 * bd-tbprit.9 — the sums behind Rifat's "Where to look": plan moves as Yes / Partial / No / ? (the grader's own
 * credit: executed or substituted 1, partial ½, not done 0, not adjudicable left out), steps in plan order, the
 * most-missed step, the FICO count line, which sections are lowest and disputed.
 */
const mv = (id: string, phase: string, verdict: string, at: number | null = null, evidence: string | null = null): Move =>
  ({ id, text: `Move ${id}`, phase, mustHappen: false, verdict, evidence, translation: null, why: null, at });
const MOVES = [
  mv("o1", "Opening", "executed", 30, "Salam bachon"), mv("o2", "Opening", "substituted_better", 60),
  mv("w1", "We Do", "not_done"), mv("w2", "We Do", "partial", 900, "aapas mein"), mv("w3", "We Do", "not_done"),
  mv("y1", "You Do", "not_adjudicable"),
];

describe("moves", () => {
  it("the grader's verdicts as Yes / Partial / No / ?", () => {
    expect(["executed", "substituted_equivalent", "substituted_better", "partial", "not_done", "not_adjudicable"].map(markOf))
      .toEqual(["yes", "yes", "yes", "partial", "no", "unknown"]);
  });

  it("steps in plan order, each scored out of its counted moves", () => {
    expect(stepsOf(MOVES).map((s) => [s.name, s.got, s.of])).toEqual([["Opening", 2, 2], ["We Do", 0.5, 3], ["You Do", 0, 0]]);
  });

  it("most missed: the step with most left undone; none when nothing was missed", () => {
    expect(mostMissed(stepsOf(MOVES))?.name).toBe("We Do");
    expect(mostMissed(stepsOf(MOVES.slice(0, 2)))).toBeNull();
  });

  it("totals: in the plan (counted), done with halves, %, and each mark", () => {
    expect(moveTotals(MOVES)).toEqual({ total: 5, done: 2.5, pct: 50, yes: 2, partial: 1, no: 2, unknown: 1 });
  });

  it("halves read 1½, ½, 2", () => {
    expect([1.5, 0.5, 2, 0].map(halves)).toEqual(["1½", "½", "2", "0"]);
  });

  it("a step's part: from just before its first timed move to just after its last", () => {
    const steps = stepsOf(MOVES);
    expect(stepWindow(steps, 0)).toEqual({ from: 15, to: 105 });
  });

  it("a step with nothing timed: the gap between the step before and the step after", () => {
    const steps = stepsOf([...MOVES.slice(0, 2), mv("w1", "We Do", "not_done"), mv("y1", "You Do", "executed", 1500)]);
    expect(stepWindow(steps, 1)).toEqual({ from: 60, to: 1500 });
  });

  it("nothing timed anywhere: no part to play", () => {
    expect(stepWindow(stepsOf([mv("w1", "We Do", "not_done")]), 0)).toBeNull();
  });

  it("no plan: the DC's own evidence times", () => {
    const it = (at: number | null) => ({ id: "x", name: "x", score: 1, evidence: "q", at, applicable: true });
    expect(itemsWindow([it(200), it(null), it(320)])).toEqual({ from: 185, to: 365 });
    expect(itemsWindow([it(null)])).toBeNull();
  });

  it("the part is fitted to the recording: cut at its end, gone when it starts after it, at most 10 minutes", () => {
    expect(fitToRecording({ from: 600, to: 900 }, 720)).toEqual({ from: 600, to: 720 });
    expect(fitToRecording({ from: 800, to: 900 }, 720)).toBe("notRecorded");
    expect(fitToRecording({ from: 0, to: 2000 }, null)).toEqual({ from: 0, to: 600 });
  });
});

describe("sections", () => {
  const item = (id: string, score: number | null, evidence: string | null = "q") => ({ id, name: id, score, evidence, at: null, applicable: score != null });

  it("the FICO line: how many at each score, and how many with no detail", () => {
    expect(indicatorCounts([item("a", 3), item("b", 3), item("c", 1), item("d", 2), item("e", null, null), item("f", 4)]))
      .toEqual({ n: 6, at: { 4: 1, 3: 2, 2: 1, 1: 1 }, none: 1 });
  });

  const card = (extra: Partial<Card>) => ({
    reasons: ["score"], moves: null,
    indicators: [
      { key: "lesson_plan_fidelity", score: 23, max: 40, counted: true, items: [] },
      { key: "high_leverage_practices", score: 29, max: 48, counted: true, items: [item("C1", 2)] },
      { key: "student_engagement", score: 20, max: 28, counted: true, items: [item("D1", 1)] },
    ],
    evidence: [{ code: "score", items: [item("D1", 1)] }],
    ...extra,
  }) as unknown as Card;

  it("lowest: the counted section with the lowest %; an unchecked plan never is", () => {
    expect(lowestKey(card({}).indicators)).toBe("lesson_plan_fidelity");
    const c = card({});
    c.indicators[0] = { ...c.indicators[0], counted: false };
    expect(lowestKey(c.indicators)).toBe("high_leverage_practices");
  });

  it("disputed: the sections holding what her reasons point at", () => {
    expect([...disputedKeys(card({}))]).toEqual(["student_engagement"]);
    const missed = card({ evidence: [{ code: "missed", noPlan: false, moves: [MOVES[2]], items: [] }] });
    expect([...disputedKeys(missed)]).toEqual(["lesson_plan_fidelity"]);
  });

  it("short: recorded, under 15 minutes", () => {
    expect([null, 0, 899, 900].map(isShort)).toEqual([false, false, true, false]);
  });
});

describe("problemPart", () => {
  const base = { reasons: ["missed"], indicators: [], evidence: [] };
  it("plan: the most-missed step, its part fitted to the recording, its key missed move to listen for", () => {
    const moves = [mv("o1", "Opening", "executed", 30), { ...mv("w1", "We Do", "not_done"), mustHappen: true, text: "Pairs talk" }, mv("w2", "We Do", "partial", 900)];
    expect(problemPart({ ...base, moves, durationSec: 2000 } as unknown as Card)).toEqual({ step: "We Do", listenFor: "Pairs talk", part: { from: 885, to: 945 } });
  });
  it("no plan: the evidence times and the lowest-scored item", () => {
    const item = (id: string, score: number, at: number | null) => ({ id, name: id, score, evidence: "q", at, applicable: true });
    const c = { ...base, moves: null, durationSec: null, evidence: [{ code: "score", items: [item("C1", 2, 100), item("D1", 1, 300)] }] };
    expect(problemPart(c as unknown as Card)).toEqual({ step: null, listenFor: "D1", part: { from: 85, to: 345 } });
  });
  it("nothing timed: no part", () => {
    expect(problemPart({ ...base, moves: null, durationSec: null } as unknown as Card).part).toBeNull();
  });
});
