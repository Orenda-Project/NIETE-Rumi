/**
 * bd-2673 — the written exam form.
 *
 * The bug this component exists to prevent (bd-2490): a Beacon House teacher
 * opened her level exam and got eight questions, no inputs, a counter stuck on
 * 0/8 and a Submit button that could never enable, because a free-text capstone
 * was being rendered through the multiple-choice path.
 *
 * So the cases below are mostly about the things that were broken: there IS an
 * input per question, the counter tracks it, Submit enables only when the work
 * would actually be accepted, and every number shown comes from the server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import api from "../services/api";
import CapstoneExamForm from "./CapstoneExamForm";

// Typed handles on the mocked axios wrapper — avoids `as any` at each call site.
const apiGet = api.get as unknown as Mock;
const apiPost = api.post as unknown as Mock;

const FLOOR = 400;

const PAPER = {
  questions: [
    { id: 1, question_text: "Describe a lesson that did not go to plan.", order_index: 0 },
    { id: 2, question_text: "How did you adapt it?", order_index: 1 },
  ],
  min_answer_chars: FLOOR,
  points_per_question: 5,
  pass_mark_pct: 70,
};

function renderForm() {
  return render(<CapstoneExamForm levelId={7} levelName="Level 3" />);
}

/** An answer that clears the server's floor. */
const long = (n = FLOOR) => "x".repeat(n);

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({ data: { success: true, ...PAPER } });
});

describe("bd-2673 — starting the written exam", () => {
  it("shows an entry card before the paper is loaded, and fetches nothing yet", () => {
    renderForm();
    expect(screen.getByTestId("capstone-entry")).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("renders one textarea per question — the bug was having none", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    await screen.findByTestId("capstone-form");
    expect(screen.getByTestId("capstone-answer-1")).toBeTruthy();
    expect(screen.getByTestId("capstone-answer-2")).toBeTruthy();
  });

  it("quotes the pass mark and the floor from the server, not from literals", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    const form = await screen.findByTestId("capstone-form");
    expect(form.textContent).toContain("70%");
    expect(form.textContent).toContain(String(FLOOR));
  });
});

describe("bd-2673 — the character floor is enforced before submit", () => {
  it("keeps Submit disabled until every answer clears the floor", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    await screen.findByTestId("capstone-form");

    const submit = () => screen.getByTestId("capstone-submit") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    // One long answer is not enough — the other is still short.
    await userEvent.type(screen.getByTestId("capstone-answer-1"), long(FLOOR));
    expect(submit().disabled).toBe(true);

    await userEvent.type(screen.getByTestId("capstone-answer-2"), long(FLOOR));
    expect(submit().disabled).toBe(false);
  }, 20000);

  it("counts progress by answers that would actually be accepted", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    await screen.findByTestId("capstone-form");

    expect(screen.getByTestId("capstone-progress").textContent).toContain("0 of 2");
    await userEvent.type(screen.getByTestId("capstone-answer-1"), long(FLOOR));
    expect(screen.getByTestId("capstone-progress").textContent).toContain("1 of 2");
  }, 20000);

  it("tells the teacher how much more is needed rather than just refusing", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    await screen.findByTestId("capstone-form");
    await userEvent.type(screen.getByTestId("capstone-answer-1"), "too short");
    expect(screen.getByTestId("capstone-count-1").textContent).toContain("more to go");
  });
});

describe("bd-2673 — the result", () => {
  it("reports the score, the bar, and the per-answer feedback the grader gave", async () => {
    apiPost.mockResolvedValue({
      data: {
        success: true,
        attempt: {
          id: "att-1", score: 8, total_score: 10, pass_bar: 7,
          pass_mark_pct: 70, is_passed: true, completed_at: "2026-08-13T00:00:00Z",
        },
        answers: [
          {
            question_index: 0, question_text: "Q1", answer_text: "a",
            answer_score: 4, feedback_text: "Grounded in real practice.",
          },
        ],
        certificate: null,
      },
    });

    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    await screen.findByTestId("capstone-form");
    await userEvent.type(screen.getByTestId("capstone-answer-1"), long(FLOOR));
    await userEvent.type(screen.getByTestId("capstone-answer-2"), long(FLOOR));
    await userEvent.click(screen.getByTestId("capstone-submit"));

    const card = await screen.findByTestId("capstone-result");
    expect(card.textContent).toContain("8 / 10");
    expect(card.textContent).toContain("70%");
    expect(card.textContent).toContain("Grounded in real practice.");
  }, 30000);

  it("surfaces the certificate when the pass earns one", async () => {
    apiPost.mockResolvedValue({
      data: {
        success: true,
        attempt: {
          id: "att-1", score: 10, total_score: 10, pass_bar: 7,
          pass_mark_pct: 70, is_passed: true, completed_at: "2026-08-13T00:00:00Z",
        },
        answers: [],
        certificate: { certificate_code: "NIETE-20260813-AB12CD", level_name: "Level 3", teacher_name: "A" },
      },
    });

    renderForm();
    await userEvent.click(screen.getByTestId("capstone-start"));
    await screen.findByTestId("capstone-form");
    await userEvent.type(screen.getByTestId("capstone-answer-1"), long(FLOOR));
    await userEvent.type(screen.getByTestId("capstone-answer-2"), long(FLOOR));
    await userEvent.click(screen.getByTestId("capstone-submit"));

    const cert = await screen.findByTestId("capstone-certificate");
    expect(cert.textContent).toContain("NIETE-20260813-AB12CD");
  }, 30000);
});
