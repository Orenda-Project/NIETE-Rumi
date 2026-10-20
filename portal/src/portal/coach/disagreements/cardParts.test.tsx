import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClipProvider, ItemRow, ReasonBlock } from "./cardParts";

/** bd-tbprit.3 — a grader item and a reason block on their own: missing data reads —, one clip open at a time. */
const item = (id: string, at: number | null, score: number | null = 2) => ({ id, name: `Ind ${id}`, score, evidence: null, at, applicable: true });

describe("card parts", () => {
  it("an item without a score reads —, without a quote shows none", () => {
    render(<ClipProvider id="r"><ul><ItemRow item={item("X", null, null)} k="x" /></ul></ClipProvider>);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(document.querySelector("q")).toBeNull();
  });

  it("opening a second Listen closes the first", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "missed", noPlan: false, moves: [], items: [item("A", 65), item("B", 125)] }} /></ClipProvider>);
    const [a, b] = screen.getAllByRole("button", { name: /Listen/ });
    expect(a).toHaveTextContent("1:05");
    fireEvent.click(a);
    fireEvent.click(b);
    const clips = document.querySelectorAll('audio[src*="/clip"]');
    expect(clips).toHaveLength(1);
    expect(clips[0].getAttribute("src")).toMatch(/clip\?at=125$/);
  });

  const sec = (key: string, name: string, pct: number | null, notAssessed = false) =>
    ({ key, name, score: null, max: null, pct, colour: "amber", notAssessed, why: null });
  const view = (sections: ReturnType<typeof sec>[], pct: number | null = 64, marks: number | null = 90, max: number | null = 140) =>
    ({ language: "en", header: { name: null, meta: null, date: null, pct, marks, max }, wells: [], thing: null, sections, journey: null, quizMessage: null, voice: null, report: null });

  it("bd-tbprit.14 — the score line names the lowest checked section", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "score", items: [item("A", 65)] }}
      view={view([sec("a", "Lesson Plan Fidelity", 58), sec("b", "Student Engagement", 71), sec("c", "Not seen", null, true)])} /></ClipProvider>);
    const r = screen.getByTestId("reason-score");
    expect(r).toHaveTextContent("64% 90 / 140 · lowest: Lesson Plan Fidelity (58%). Details in B.");
    expect(r).not.toHaveTextContent("Ind A");
  });

  it("bd-tbprit.14 — no plan linked: the score line says the plan was left out of the score", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "score", items: [] }}
      view={view([sec("lesson_plan_fidelity", "Lesson Plan Fidelity", null, true), sec("b", "Student Engagement", 58)], 58, 58, 100)} /></ClipProvider>);
    expect(screen.getByTestId("reason-score")).toHaveTextContent(
      "58% 58 / 100 · Lesson Plan Fidelity not checked (no plan linked), so it is left out of the score. Details in B.");
  });

  it("bd-tbprit.14 — no score on record reads —, never a made-up number", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "score", items: [] }} view={view([], null, null, null)} /></ClipProvider>);
    expect(screen.getByTestId("reason-score")).toHaveTextContent("— · Details in B.");
  });

  it("a missed move reads ✗ No, never the raw verdict", () => {
    const move = { id: "m", text: "Pairs", phase: "We Do", mustHappen: true, verdict: "not_done", evidence: null, translation: null, why: null, at: null };
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "missed", noPlan: false, moves: [move], items: [] }} /></ClipProvider>);
    expect(screen.getByTestId("reason-missed")).toHaveTextContent("✗ No");
    expect(screen.getByTestId("reason-missed")).not.toHaveTextContent("not_done");
  });

  it("won't work with no thing on record reads —", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "wont_work", thing: null }} /></ClipProvider>);
    expect(screen.getByTestId("reason-wont_work")).toHaveTextContent("—");
  });
});
