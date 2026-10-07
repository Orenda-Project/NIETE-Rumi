/**
 * bd-klecr.6 — the module quiz, one question per page, with a verdict after
 * each answer (operator, 2026-10-06; design versions/v4_quiz-one-per-page).
 *
 *   one question      "Question N of M"; Check stays off until she picks
 *   Check             saves the answer (POST …/answer) and shows Correct or
 *                     Not correct; her pick is coloured, the right option is
 *                     NEVER shown; the answer is locked
 *   Next              the next question; on the last one the button is
 *                     "Submit quiz", which shows the saved result
 *   result            score, passed or not, ✓/✗ per question, Retake
 *   reload            the open attempt comes back where she left it, her
 *                     checked answers still locked
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";
import ModuleQuizPanel from "./ModuleQuizPanel";

const mockedApi = api as unknown as { get: Mock; post: Mock };

const QUESTIONS = [
  { id: 11, question_text: "First step?", multi: false, options: [{ value: "1", text: "Send out" }, { value: "2", text: "Ask what happened" }] },
  { id: 12, question_text: "Repair harm?", multi: false, options: [{ value: "1", text: "Why did you?" }, { value: "2", text: "Make it right?" }] },
  { id: 13, question_text: "Pick all that end a circle", multi: true, options: [{ value: "1", text: "Agreement" }, { value: "2", text: "Warning" }, { value: "3", text: "Plan" }] },
];
const RESULT = {
  success: true,
  attempt: { id: "att-1", score: 2, max_score: 3, is_passed: false, pass_pct: 100, completed_at: "2026-10-06T10:00:00Z" },
  results: [
    { question_id: 11, question_index: 0, is_correct: true },
    { question_id: 12, question_index: 1, is_correct: false },
    { question_id: 13, question_index: 2, is_correct: true },
  ],
  certificate: null,
};

type Verdicts = Record<number, boolean>;
let startPayload: unknown;
let verdicts: Verdicts;
let posts: Array<{ url: string; body: unknown }>;

function wire() {
  mockedApi.post.mockImplementation((url: string, body: unknown) => {
    posts.push({ url, body });
    if (url.endsWith("/quiz-attempts/start")) return Promise.resolve({ data: startPayload });
    if (url.endsWith("/answer")) {
      const b = body as { question_id: number };
      const last = b.question_id === 13;
      return Promise.resolve({ data: { success: true, question_id: b.question_id, is_correct: verdicts[b.question_id], result: last ? RESULT : null } });
    }
    if (url.endsWith("/finish")) return Promise.resolve({ data: RESULT });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  posts = [];
  verdicts = { 11: true, 12: false, 13: true };
  startPayload = { success: true, attempt: { id: "att-1", total_questions: 3, current_index: 0 }, questions: QUESTIONS, answered: [] };
  mockedApi.get.mockResolvedValue({ data: { questions: QUESTIONS.map((q, i) => ({ ...q, options: q.options.map((o) => o.text), order_index: i })) } });
  wire();
});

async function open(onSubmitted = vi.fn()) {
  render(<ModuleQuizPanel moduleId="42" hasAttempts={false} hasQuestions onSubmitted={onSubmitted} />);
  await userEvent.click(await screen.findByTestId("quiz-take-button"));
  return onSubmitted;
}
const option = (text: string) => screen.getByRole("button", { name: new RegExp(text) });

describe("one question per page", () => {
  it("shows one question and keeps Check off until she picks", async () => {
    await open();
    expect(await screen.findByText("Question 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("First step?")).toBeInTheDocument();
    expect(screen.queryByText("Repair harm?")).not.toBeInTheDocument();
    expect(screen.getByTestId("quiz-check-button")).toBeDisabled();
    await userEvent.click(option("Ask what happened"));
    expect(screen.getByTestId("quiz-check-button")).toBeEnabled();
    expect(posts.map((p) => p.url)).toEqual(["/training/module/42/quiz-attempts/start"]);
  });
});

describe("Check", () => {
  it("saves the answer, says Correct, and locks it", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: /Ask what happened/ }));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    expect(posts[1]).toEqual({ url: "/training/module/42/quiz-attempts/att-1/answer", body: { question_id: 11, chosen_option: "2" } });
    expect(await screen.findByTestId("quiz-verdict")).toHaveTextContent("Correct");
    expect(option("Ask what happened")).toHaveAttribute("data-verdict", "correct");
    expect(option("Send out")).toBeDisabled();
    expect(screen.queryByTestId("quiz-check-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("quiz-next-button")).toHaveTextContent("Next question");
  });

  it("says Not correct and never shows which option was right", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: /Ask what happened/ }));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    await userEvent.click(await screen.findByTestId("quiz-next-button"));
    expect(await screen.findByText("Question 2 of 3")).toBeInTheDocument();
    await userEvent.click(option("Why did you"));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    expect(await screen.findByTestId("quiz-verdict")).toHaveTextContent("Not correct");
    expect(option("Why did you")).toHaveAttribute("data-verdict", "wrong");
    expect(option("Make it right")).not.toHaveAttribute("data-verdict");
  });

  it("a pick-all question sends the whole set", async () => {
    startPayload = { ...(startPayload as object), attempt: { id: "att-1", total_questions: 3, current_index: 2 },
      answered: [{ question_id: 11, chosen_option: "2", is_correct: true }, { question_id: 12, chosen_option: "1", is_correct: false }] };
    await open();
    expect(await screen.findByText("Question 3 of 3")).toBeInTheDocument();
    await userEvent.click(option("Plan"));
    await userEvent.click(option("Agreement"));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    expect(posts[1].body).toEqual({ question_id: 13, chosen_option: "1,3" });
  });
});

describe("the last question and the result", () => {
  it("offers Submit quiz, then shows the score, the verdict per question, and Retake", async () => {
    const onSubmitted = await open();
    for (const [pick] of [["Ask what happened"], ["Why did you"]]) {
      await userEvent.click(await screen.findByRole("button", { name: new RegExp(pick) }));
      await userEvent.click(screen.getByTestId("quiz-check-button"));
      await userEvent.click(await screen.findByTestId("quiz-next-button"));
    }
    await userEvent.click(await screen.findByRole("button", { name: /Agreement/ }));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    const submit = await screen.findByTestId("quiz-submit-button");
    expect(submit).toHaveTextContent("Submit quiz");
    await userEvent.click(submit);

    const result = await screen.findByTestId("quiz-panel-result");
    expect(within(result).getByTestId("quiz-result-score")).toHaveTextContent("2 / 3");
    const rows = within(result).getAllByTestId(/quiz-result-q-/);
    expect(rows.map((r) => r.getAttribute("data-correct"))).toEqual(["true", "false", "true"]);
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ id: "att-1", score: 2 }));
    // The result came with the last answer: nothing more to ask the server.
    expect(posts.filter((p) => p.url.endsWith("/finish"))).toHaveLength(0);

    await userEvent.click(within(result).getByTestId("quiz-retake-button"));
    expect(posts[posts.length - 1].url).toBe("/training/module/42/quiz-attempts/start");
  });

  it("asks the server to finish when the last answer could not close the quiz", async () => {
    startPayload = { ...(startPayload as object), attempt: { id: "att-1", total_questions: 3, current_index: 2 },
      answered: [{ question_id: 11, chosen_option: "2", is_correct: true }, { question_id: 12, chosen_option: "1", is_correct: false }] };
    mockedApi.post.mockImplementation((url: string, body: unknown) => {
      posts.push({ url, body });
      if (url.endsWith("/start")) return Promise.resolve({ data: startPayload });
      if (url.endsWith("/answer")) return Promise.resolve({ data: { success: true, question_id: 13, is_correct: true, result: null } });
      if (url.endsWith("/finish")) return Promise.resolve({ data: RESULT });
      return Promise.reject(new Error(url));
    });
    await open();
    await userEvent.click(await screen.findByRole("button", { name: /Agreement/ }));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    await userEvent.click(await screen.findByTestId("quiz-submit-button"));
    expect(await screen.findByTestId("quiz-panel-result")).toBeInTheDocument();
    expect(posts.map((p) => p.url)).toContain("/training/module/42/quiz-attempts/att-1/finish");
  });
});

describe("after a reload", () => {
  it("returns to the open attempt with her checked answers locked", async () => {
    startPayload = { ...(startPayload as object), attempt: { id: "att-1", total_questions: 3, current_index: 1 },
      answered: [{ question_id: 11, chosen_option: "1", is_correct: false }] };
    await open();
    expect(await screen.findByText("Question 2 of 3")).toBeInTheDocument();
  });

  it("shows the stored verdict when the server says the question was already answered", async () => {
    mockedApi.post.mockImplementation((url: string, body: unknown) => {
      posts.push({ url, body });
      if (url.endsWith("/start")) return Promise.resolve({ data: startPayload });
      if (url.endsWith("/answer")) {
        return Promise.reject({ response: { status: 409, data: { success: false, already_answered: true, chosen_option: "1", is_correct: false } } });
      }
      return Promise.reject(new Error(url));
    });
    await open();
    await userEvent.click(await screen.findByRole("button", { name: /Ask what happened/ }));
    await userEvent.click(screen.getByTestId("quiz-check-button"));
    expect(await screen.findByTestId("quiz-verdict")).toHaveTextContent("Not correct");
    expect(option("Send out")).toHaveAttribute("data-verdict", "wrong");
  });
});
