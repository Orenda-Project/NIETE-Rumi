/**
 * bd-2489 / bd-2475 — the exam card must state the REAL bar, not a literal.
 *
 * The card told every teacher "100% required to pass". The bar is per vendor
 * (training_vendors.passing_pct) and the API already sends it as
 * `pass_mark_pct`; the SPA simply ignored the field. The same sentence also
 * asserted a cooldown unconditionally, which is false for capstones — those
 * never write a cooldown_until, so there is nothing to serve.
 *
 * These render the component directly rather than asserting on file contents.
 * The 'ready' / form / result screens are currently unreachable in production
 * (bd-2490 replaces state 'ready' with 'whatsapp_only' and the questions
 * endpoint 409s), so a route-driven test cannot reach this copy at all — but
 * the component is still the thing that will be wrong the day the surface is
 * switched back on. Driving it with a gate payload is the only honest way to
 * pin the copy today.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";
import LevelExamCard from "./LevelExamCard";

const GATE_URL = "/training/level/7/grand-quiz";
const QUESTIONS_URL = "/training/level/7/grand-quiz/questions";

function gate(over: Record<string, unknown> = {}) {
  return {
    state: "ready",
    exam_kind: "grand_quiz",
    question_count: 10,
    pass_mark_pct: 80,
    cooldown_hours: 24,
    cooldown_until: null,
    courses_total: 2,
    courses_started: 2,
    passed_at: null,
    certificate: null,
    ...over,
  };
}

/** Route the component's two GETs; anything else rejects loudly. */
function mockApi(gateBody: Record<string, unknown>, questions: unknown[] = []) {
  (api.get as any).mockImplementation((url: string) => {
    if (url === GATE_URL) return Promise.resolve({ data: { grand_quiz: gateBody } });
    if (url === QUESTIONS_URL) return Promise.resolve({ data: { questions } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderCard() {
  render(<LevelExamCard levelId={7} levelName="English" levelOrderIndex={0} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bd-2489 — the ready card shows the vendor's pass mark", () => {
  it("says 80% for an 80% vendor, and never says 100%", async () => {
    mockApi(gate({ pass_mark_pct: 80 }));
    renderCard();
    const card = await screen.findByTestId("level-exam-ready");
    expect(card.textContent).toContain("80% required to pass");
    expect(card.textContent).not.toContain("100%");
  });

  it("says 70% for a 70% vendor — the number tracks the data, not a literal", async () => {
    mockApi(gate({ pass_mark_pct: 70 }));
    renderCard();
    const card = await screen.findByTestId("level-exam-ready");
    expect(card.textContent).toContain("70% required to pass");
    expect(card.textContent).not.toContain("100%");
  });

  it("still says 100% when the vendor bar genuinely IS 100", async () => {
    // Guards an over-correction that hides the bar whenever it equals 100.
    mockApi(gate({ pass_mark_pct: 100 }));
    renderCard();
    const card = await screen.findByTestId("level-exam-ready");
    expect(card.textContent).toContain("100% required to pass");
  });

  it("omits the pass-mark clause entirely when the bot could not supply one", async () => {
    // gate.passPct is null when the bot is unreachable. Inventing 100 there is
    // exactly the bug; so is rendering "null%".
    mockApi(gate({ pass_mark_pct: null }));
    renderCard();
    const card = await screen.findByTestId("level-exam-ready");
    expect(card.textContent).not.toMatch(/null|undefined|NaN/);
    expect(card.textContent).not.toContain("required to pass");
  });
});

describe("bd-2475 — the cooldown clause only appears when a cooldown exists", () => {
  // bd-2673 — these cases used exam_kind 'capstone' as a convenient carrier for
  // cooldown_hours: 0. A ready capstone now renders CapstoneExamForm instead of
  // this card, so the vehicle changed; the RULE under test did not, and it is
  // the rule that matters — a zero cooldown must never be described as one. A
  // grand quiz configured without a cooldown exercises it directly.
  it("a zero cooldown is not described as a cooldown", async () => {
    mockApi(gate({ exam_kind: "grand_quiz", cooldown_hours: 0 }));
    renderCard();
    const card = await screen.findByTestId("level-exam-ready");
    expect(card.textContent).not.toContain("cooldown");
    expect(card.textContent).not.toContain("0h");
  });

  it("a grand quiz still states its 24h cooldown", async () => {
    mockApi(gate({ exam_kind: "grand_quiz", cooldown_hours: 24 }));
    renderCard();
    const card = await screen.findByTestId("level-exam-ready");
    expect(card.textContent).toContain("24h cooldown");
  });
});

describe("bd-2489 — the exam form caption carries the same real numbers", () => {
  const QUESTIONS = [
    { id: 1, question_text: "Q1", question_urdu: null, options: ["a", "b"], order_index: 0 },
  ];

  it("shows the vendor bar, not 100%", async () => {
    mockApi(gate({ pass_mark_pct: 70 }), QUESTIONS);
    renderCard();
    await userEvent.click(await screen.findByTestId("exam-start"));
    const form = await screen.findByTestId("level-exam-form");
    expect(form.textContent).toContain("70% required to pass");
    expect(form.textContent).not.toContain("100% required to pass");
  });

  it("drops the cooldown clause when there is no cooldown", async () => {
    mockApi(gate({ exam_kind: "grand_quiz", cooldown_hours: 0, pass_mark_pct: 70 }), QUESTIONS);
    renderCard();
    await userEvent.click(await screen.findByTestId("exam-start"));
    const form = await screen.findByTestId("level-exam-form");
    expect(form.textContent).not.toContain("cooldown");
  });
});

describe("bd-2489 — the result screens do not invent a bar either", () => {
  const QUESTIONS = [
    { id: 1, question_text: "Q1", question_urdu: null, options: ["a", "b"], order_index: 0 },
  ];

  async function submitWith(attempt: Record<string, unknown>, gateOver: Record<string, unknown> = {}) {
    mockApi(gate(gateOver), QUESTIONS);
    (api.post as any).mockResolvedValue({ data: { attempt, certificate: null } });
    renderCard();
    await userEvent.click(await screen.findByTestId("exam-start"));
    await screen.findByTestId("level-exam-form");
    await userEvent.click(screen.getByRole("radio", { name: /A\./ }));
    await userEvent.click(screen.getByTestId("exam-submit"));
  }

  it("a failed attempt quotes the vendor bar, not 100%", async () => {
    await submitWith(
      { id: "a1", score: 6, max_score: 10, is_passed: false, status: "failed", cooldown_until: null, completed_at: "" },
      { pass_mark_pct: 80 },
    );
    const card = await screen.findByTestId("level-exam-result-fail");
    expect(card.textContent).toContain("80%");
    expect(card.textContent).not.toContain("requires 100%");
  });

  it("a failed exam with no cooldown is not told to wait one out", async () => {
    await submitWith(
      { id: "a1", score: 6, max_score: 10, is_passed: false, status: "failed", cooldown_until: null, completed_at: "" },
      { exam_kind: "grand_quiz", cooldown_hours: 0, pass_mark_pct: 70 },
    );
    const card = await screen.findByTestId("level-exam-result-fail");
    expect(card.textContent).not.toMatch(/Try again in about/);
  });

  it("a pass below 100% is not announced as 'a perfect score'", async () => {
    await submitWith(
      { id: "a1", score: 8, max_score: 10, is_passed: true, status: "passed", cooldown_until: null, completed_at: "" },
      { pass_mark_pct: 80 },
    );
    const card = await screen.findByTestId("level-exam-result-pass");
    expect(card.textContent).not.toContain("perfect score");
    expect(card.textContent).toContain("8/10");
  });

  it("a genuine 100% pass may still be called perfect", async () => {
    await submitWith(
      { id: "a1", score: 10, max_score: 10, is_passed: true, status: "passed", cooldown_until: null, completed_at: "" },
      { pass_mark_pct: 100 },
    );
    const card = await screen.findByTestId("level-exam-result-pass");
    expect(card.textContent).toContain("perfect score");
  });
});

describe("bd-2673 — a written exam gets the written form, never the MCQ one", () => {
  // This replaces the bd-2490 'whatsapp_only' redirect-card case. That state is
  // gone: the portal runs both exam kinds now. What has to be true instead is
  // that a capstone does NOT reach the multiple-choice form — sending it there
  // is the original bug (questions with no options, radios with nothing to
  // pick, a Submit that can never enable).
  it("renders the capstone form and not the multiple-choice card", async () => {
    mockApi(gate({ exam_kind: "capstone" }));
    renderCard();
    await screen.findByTestId("capstone-entry");
    expect(screen.queryByTestId("level-exam-ready")).toBeNull();
    expect(screen.queryByTestId("exam-start")).toBeNull();
  });

  it("still renders the multiple-choice card for a grand quiz", async () => {
    mockApi(gate({ exam_kind: "grand_quiz" }));
    renderCard();
    await screen.findByTestId("level-exam-ready");
    expect(screen.queryByTestId("capstone-entry")).toBeNull();
  });

  it("does not offer a capstone that the gate has locked", async () => {
    // Eligibility outranks exam kind: a locked level shows the locked card, not
    // a written exam it is not yet allowed to sit.
    mockApi(gate({ exam_kind: "capstone", state: "courses_incomplete" }));
    renderCard();
    await screen.findByTestId("level-exam-locked");
    expect(screen.queryByTestId("capstone-entry")).toBeNull();
  });
});
