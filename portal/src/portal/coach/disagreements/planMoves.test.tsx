import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { Move } from "./api";
import { PlanMoves } from "./planMoves";

/** bd-tbprit.9 — the plan's moves on their own: nothing missed opens nothing; a why falls back to the quote; toggling. */
const mv = (id: string, phase: string, verdict: string, extra: Partial<Move> = {}): Move =>
  ({ id, text: `Move ${id}`, phase, mustHappen: false, verdict, evidence: null, translation: null, why: null, at: null, ...extra });

describe("PlanMoves", () => {
  it("every move done: 100%, no step marked most missed, all closed", () => {
    render(<PlanMoves moves={[mv("a", "Opening", "executed"), mv("b", "Explain", "substituted_equivalent")]} />);
    expect(screen.getByTestId("mv-pct")).toHaveTextContent("100%");
    expect(screen.queryByText("most missed")).toBeNull();
    expect(screen.queryAllByTestId("move-mark")).toHaveLength(0);
  });

  it("no why on a missed move: the grader's quote stands in; a done move shows none", () => {
    render(<PlanMoves moves={[mv("a", "We Do", "not_done", { evidence: "She asked the whole class" }), mv("b", "We Do", "executed", { evidence: "Fine" })]} />);
    const step = screen.getByTestId("step-We Do");
    expect(step).toHaveTextContent("She asked the whole class");
    expect(step).not.toHaveTextContent("Fine");
  });

  it("only unrecorded moves: — for the numbers, the step closes and opens", () => {
    render(<PlanMoves moves={[mv("a", "Check", "not_adjudicable")]} />);
    expect(screen.getByTestId("mv-total")).toHaveTextContent("0");
    expect(screen.getByTestId("mv-pct")).toHaveTextContent("—");
    const step = screen.getByTestId("step-Check");
    fireEvent.click(within(step).getByRole("button"));
    expect(within(step).getByTestId("move-mark")).toHaveAttribute("data-mark", "unknown");
    fireEvent.click(within(step).getByRole("button"));
    expect(within(step).queryByTestId("move-mark")).toBeNull();
  });
});
