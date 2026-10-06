/**
 * bd-klecr.6 — drive ModuleQuizPanel's one-question-per-page flow in a test:
 * a one-question paper, Check, Submit quiz, with the server returning
 * `attempt` as the saved result of the last answer.
 */
import type { Mock } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export function mockOneQuestionQuiz(post: Mock, attempt: Record<string, unknown>) {
  const saved = { id: "a1", completed_at: "2026-10-05T10:00:00Z", ...attempt };
  post.mockImplementation((url: string) => {
    if (url.endsWith("/quiz-attempts/start")) {
      return Promise.resolve({ data: {
        success: true,
        attempt: { id: "a1", total_questions: 1, current_index: 0 },
        questions: [{ id: 1, question_text: "Q1", multi: false, options: [{ value: "1", text: "a" }, { value: "2", text: "b" }] }],
        answered: [],
      } });
    }
    if (url.endsWith("/answer")) {
      return Promise.resolve({ data: {
        success: true, question_id: 1, is_correct: Boolean(attempt.is_passed),
        result: { attempt: saved, results: [{ question_id: 1, question_index: 0, is_correct: Boolean(attempt.is_passed) }] },
      } });
    }
    if (url.endsWith("/finish")) return Promise.resolve({ data: { success: true, attempt: saved, results: [] } });
    return Promise.resolve({ data: {} });
  });
}

/** Take → pick A → Check → Submit quiz → the result panel. */
export async function takeOneQuestionQuiz() {
  await userEvent.click(await screen.findByTestId("quiz-take-button"));
  await userEvent.click(await screen.findByRole("button", { name: /^A\s*a$/ }));
  await userEvent.click(screen.getByTestId("quiz-check-button"));
  await userEvent.click(await screen.findByTestId("quiz-submit-button"));
  return screen.findByTestId("quiz-panel-result");
}
