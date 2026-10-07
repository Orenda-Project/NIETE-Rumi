/**
 * bd-2489 — "Perfect score — great work!" is a pass-threshold claim, and since
 * bd-2483 it is often false.
 *
 * Module quizzes are graded against training_vendors.module_passing_pct — 100
 * for NIETE, 70 for Beacon House and Oxbridge. `is_passed` therefore means
 * "cleared the vendor's bar", not "got everything right", so a 7/10 pass was
 * congratulated as perfect.
 *
 * The result phase is unreachable in production today (bd-2490 returns the
 * WhatsApp redirect before questions are consulted), so this mocks the interim
 * constant off to reach the screen underneath — the copy is still what a
 * teacher will see the day the surface comes back.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/assessments", () => ({
  ASSESSMENTS_ON_WHATSAPP_ONLY: false,
  WHATSAPP_TRAINING_URL: "https://example.invalid/chat",
}));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";
import ModuleQuizPanel from "./ModuleQuizPanel";
import { mockOneQuestionQuiz, takeOneQuestionQuiz } from "./__testing__/oneQuestionQuiz";

const mockedApi = api as unknown as { get: Mock; post: Mock };

const QUESTIONS = [
  { id: 1, question_text: "Q1", options: ["a", "b"], order_index: 0 },
];

async function submitScoring(score: number, maxScore: number, isPassed: boolean, passPct?: number) {
  mockedApi.get.mockResolvedValue({ data: { questions: QUESTIONS } });
  mockOneQuestionQuiz(mockedApi.post, {
    score, max_score: maxScore, is_passed: isPassed, completed_at: "",
    ...(passPct === undefined ? {} : { pass_pct: passPct }),
  });
  render(<ModuleQuizPanel moduleId="m1" hasAttempts={false} hasQuestions />);
  return takeOneQuestionQuiz();
}

beforeEach(() => vi.clearAllMocks());

describe("bd-2489 — the module-quiz result does not call every pass perfect", () => {
  it("a 7/10 pass (vendor bar 70%) is not announced as a perfect score", async () => {
    const panel = await submitScoring(7, 10, true);
    expect(panel.textContent).not.toContain("Perfect score");
    expect(panel.textContent).toContain("7 / 10");
  });

  it("a genuine 10/10 may still be called perfect", async () => {
    const panel = await submitScoring(10, 10, true);
    expect(panel.textContent).toContain("Perfect score");
  });

});

/**
 * bd-zgme6 — the panel told a teacher her module counted when it did not.
 *
 * The server writes module progress ONLY on a pass (bd-2450), against the
 * vendor's module_passing_pct: 100 for NIETE, 70 for Beacon House and
 * Oxbridge, and no bar at all for I-SAPS (ungated, bd-60163). The panel said
 * "self-check, not graded" before the quiz and "your module still counts as
 * complete" after a fail, so a NIETE teacher who missed one answer was told
 * she was done. The bar comes from the submit response's `pass_pct`; the panel
 * must never invent one.
 */
describe("bd-zgme6 — the quiz copy tells the truth about completion", () => {
  it("before the quiz: says it must be passed, not that it is an ungraded self-check", async () => {
    mockedApi.get.mockResolvedValue({ data: { questions: QUESTIONS } });
    render(<ModuleQuizPanel moduleId="m1" hasAttempts={false} hasQuestions />);
    const idle = await screen.findByTestId("quiz-panel-idle");
    expect(idle.textContent).not.toMatch(/self-check/i);
    expect(idle.textContent).not.toMatch(/not graded/i);
    expect(idle.textContent).toContain("Pass this quiz to complete this module");
    // bd-klecr.6 — no question count: the bank is not the paper the attempt serves.
    expect(idle.textContent).not.toMatch(/\d+ questions?/);
  });

  it("a NIETE fail (bar 100%) says not passed and asks for every answer right", async () => {
    const panel = await submitScoring(4, 5, false, 100);
    expect(panel.textContent).not.toContain("still counts as complete");
    expect(panel.textContent).not.toMatch(/self-check/i);
    expect(panel.textContent).toContain("Not passed yet. You need to get every answer right to complete this module.");
    expect(panel.textContent).not.toMatch(/\u2014/); // no em-dash in the new copy
  });

  it("a Beacon House / Oxbridge fail (bar 70%) quotes the bar the server sent", async () => {
    const panel = await submitScoring(6, 10, false, 70);
    expect(panel.textContent).toContain("Not passed yet. You need 70% or more to complete this module.");
    expect(panel.textContent).not.toContain("every answer right");
  });

  it("a fail with no bar in the response names no number rather than inventing one", async () => {
    const panel = await submitScoring(3, 10, false);
    expect(panel.textContent).toContain("Not passed yet.");
    expect(panel.textContent).not.toMatch(/undefined|null|NaN/);
    expect(panel.textContent).not.toMatch(/You need \d+%/);
    expect(panel.textContent).not.toContain("still counts as complete");
  });

  it("a fail never wears the pass tick, even at 80%", async () => {
    const panel = await submitScoring(4, 5, false, 100);
    const score = screen.getByTestId("quiz-result-score");
    expect(score.querySelector(".lucide-circle-check")).toBeNull();
    expect(score.className).not.toContain("text-green-700");
    expect(panel.textContent).toContain("4 / 5");
  });

  it("an I-SAPS pass below the old ladder (ungated) still reads as a pass", async () => {
    const panel = await submitScoring(1, 4, true, 100);
    expect(panel.textContent).toContain("Passed");
    expect(panel.textContent).not.toContain("Not passed");
    expect(screen.getByTestId("quiz-result-score").querySelector(".lucide-circle-check")).not.toBeNull();
  });
});
