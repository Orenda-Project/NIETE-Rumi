import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { DETAIL_M4, MODULES_C3, QUESTIONS_M4, httpError, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — the quick check, ONE QUESTION PER SCREEN (deep-screens.html, Training 6 and 7).
 *
 * bd-klecr.6 (operator, 2026-10-06) — the same flow as ModuleQuizPanel:
 *   paper   POST …/quiz-attempts/start: the BOT's paper for the attempt (NIETE: one question per
 *           Bloom level, options shuffled), not the whole bank — "1/3" here, from a bank of five.
 *   quiz    the question, big answers; Check once picked → the answer is SAVED and marked:
 *           "Correct" or "Not correct", her pick green or red, the right one never shown, the
 *           answer locked. Next; Submit on the last. Back shows an earlier answer, still locked.
 *   result  the result the last answer saved: the ring, Passed / Not passed, the %, a row per
 *           question, Up next; Continue and Try again (a NEW attempt). No "Practice": only a
 *           PASS completes the part (bd-2450).
 */

// The first render of a file loads the whole page module; give it longer than 1s under a busy run.
configure({ asyncUtilTimeout: 5000 });

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import { useAuth } from "../../hooks/useAuth";
import api, { portal } from "../../services/api";
import PortalTrainingPage from "../../pages/PortalTrainingPage";
import { TRAINING_ROUTES } from "../../lib/trainingRoutes";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={["/portal/training/unit/m-4", path]} initialIndex={1}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const QUIZ = "/portal/training/unit/m-4/quiz";
const UNLOCKED = MODULES_C3.map((m) => ({ ...m, lock: null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(trainingGet({
    "/training/module/m-4": { module: DETAIL_M4 },
    "/training/module/m-4/questions": { questions: QUESTIONS_M4 },
    "/training/modules": { modules: UNLOCKED, exam: null, readings: null },
  }) as never);
  wirePaper();
});

/**
 * The served paper: three of the five (41, 43, 44), and 41's options SHUFFLED — shown
 * C, A, B, D, so the answer at position B is canonical "1". The page must send the canonical value.
 */
const SERVED = [
  { id: 41, question_text: QUESTIONS_M4[0].question_text, multi: false, options: [3, 1, 2, 4].map((v) => ({ value: String(v), text: QUESTIONS_M4[0].options[v - 1] })) },
  { id: 43, question_text: QUESTIONS_M4[2].question_text, multi: false, options: [1, 2, 3].map((v) => ({ value: String(v), text: QUESTIONS_M4[2].options[v - 1] })) },
  { id: 44, question_text: QUESTIONS_M4[3].question_text, multi: true, options: [1, 2, 3, 4].map((v) => ({ value: String(v), text: QUESTIONS_M4[3].options[v - 1] })) },
];
const KEY: Record<number, string> = { 41: "2", 43: "2", 44: "1,3,4" };
type Saved = { score: number; max_score: number; is_passed: boolean };
let posts: Array<[string, unknown]>;
let startData: Record<string, unknown>;
let saved: Saved;

function wirePaper(result: Saved = { score: 2, max_score: 3, is_passed: false }) {
  posts = [];
  saved = result;
  startData = { success: true, attempt: { id: "att-1", total_questions: 3, current_index: 0 }, questions: SERVED, answered: [] };
  vi.mocked(api.post).mockImplementation(((url: string, body: { question_id: number; chosen_option: string }) => {
    posts.push([url, body]);
    if (url.endsWith("/quiz-attempts/start")) return Promise.resolve({ data: startData });
    if (url.endsWith("/answer")) {
      const ok = KEY[body.question_id] === body.chosen_option;
      const last = body.question_id === 44;
      return Promise.resolve({ data: {
        success: true, question_id: body.question_id, is_correct: ok,
        result: last ? {
          attempt: { id: "att-1", completed_at: "2026-10-03T10:00:00Z", pass_pct: 100, ...saved },
          results: [{ question_id: 41, question_index: 0, is_correct: true }, { question_id: 43, question_index: 1, is_correct: false }, { question_id: 44, question_index: 2, is_correct: true }],
        } : null,
      } });
    }
    return Promise.resolve({ data: {} });
  }) as never);
}

const button = (name: string) => screen.getByRole("button", { name });
const choices = () => Array.from(document.querySelectorAll<HTMLElement>("[role=radio], [role=checkbox]"));
const pick = (i: number) => fireEvent.click(choices()[i]);
const answerUrl = "/training/module/m-4/quiz-attempts/att-1/answer";

async function checkAnswer(...positions: number[]) {
  for (const i of positions) pick(i);
  fireEvent.click(button("Check"));
  await screen.findByTestId("training-quiz-verdict");
}

describe("the paper is the attempt's, not the bank", () => {
  it("opens with POST start and shows its three questions, '1/3'", async () => {
    renderAt(QUIZ);
    expect(await screen.findByText("A group is too loud. What first?")).toBeInTheDocument();
    expect(posts[0][0]).toBe("/training/module/m-4/quiz-attempts/start");
    expect(within(screen.getByTestId("newui-inner-bar")).getByText("1/3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Question 1\/3/ })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(api.get).not.toHaveBeenCalledWith("/training/module/m-4/questions", expect.anything());
  });

  it("shows the served option order and sends the canonical value", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    expect(choices().map((c) => c.textContent?.slice(1))).toEqual(["Stop the activity", "Shout louder", "Use the quiet signal", "Ignore it"]);
    await checkAnswer(2);
    expect(posts[1]).toEqual([answerUrl, { question_id: 41, chosen_option: "2" }]);
  });
});

describe("Check", () => {
  it("is off until she picks; then saves, says Correct, colours her pick, and locks", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    expect(button("Check")).toBeDisabled();
    await checkAnswer(2);
    expect(screen.getByTestId("training-quiz-verdict")).toHaveTextContent("Correct");
    expect(choices()[2]).toHaveAttribute("data-verdict", "correct");
    expect(choices().every((c) => (c as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: "Check" })).not.toBeInTheDocument();
    fireEvent.click(button("Next"));
    expect(screen.getByText("Who keeps the noise down?")).toBeInTheDocument();
    expect(within(screen.getByTestId("newui-inner-bar")).getByText("2/3")).toBeInTheDocument();
  });

  it("a wrong answer says Not correct and never shows the right one", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    await checkAnswer(0);
    expect(screen.getByTestId("training-quiz-verdict")).toHaveTextContent("Not correct");
    expect(choices()[0]).toHaveAttribute("data-verdict", "wrong");
    expect(choices().filter((c) => c.hasAttribute("data-verdict"))).toHaveLength(1);
  });

  it("Back shows the earlier answer, still locked", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    await checkAnswer(2);
    fireEvent.click(button("Next"));
    fireEvent.click(button("Back"));
    expect(screen.getByText("A group is too loud. What first?")).toBeInTheDocument();
    expect(choices()[2]).toHaveAttribute("data-verdict", "correct");
    expect(screen.getByTestId("where")).toHaveTextContent(QUIZ);
  });

  it("a pick-all question says 'Pick all' and sends the whole set", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    await checkAnswer(2); fireEvent.click(button("Next"));
    await checkAnswer(1); fireEvent.click(button("Next"));
    expect(screen.getByText("Pick all")).toBeInTheDocument();
    await checkAnswer(3, 0, 2);
    expect(posts[posts.length - 1]).toEqual([answerUrl, { question_id: 44, chosen_option: "1,3,4" }]);
  });

  it("a check that fails is not locked and says so", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    vi.mocked(api.post).mockRejectedValueOnce(httpError(500));
    pick(2);
    fireEvent.click(button("Check"));
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    expect(button("Check")).toBeEnabled();
  });

  it("after a reload she is back where she was, earlier answers locked", async () => {
    startData = { ...startData, attempt: { id: "att-1", total_questions: 3, current_index: 1 }, answered: [{ question_id: 41, chosen_option: "1", is_correct: false }] };
    renderAt(QUIZ);
    expect(await screen.findByText("Who keeps the noise down?")).toBeInTheDocument();
    fireEvent.click(button("Back"));
    expect(choices()[1]).toHaveAttribute("data-verdict", "wrong");
  });
});

async function answerAll() {
  renderAt(QUIZ);
  await screen.findByText("A group is too loud. What first?");
  await checkAnswer(2); fireEvent.click(button("Next"));
  await checkAnswer(0); fireEvent.click(button("Next"));
  await checkAnswer(0, 2, 3);
  fireEvent.click(button("Submit"));
}

describe("the result", () => {
  it("the ring with the saved score, Passed, the % chip, a row per question — no 'Practice'", async () => {
    wirePaper({ score: 3, max_score: 3, is_passed: true });
    await answerAll();
    const hero = await screen.findByTestId("newui-hero");
    expect(within(hero).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "3/3");
    expect(within(hero).getByText("Passed")).toBeInTheDocument();
    expect(within(hero).getByText("100%")).toBeInTheDocument();
    expect(within(hero).queryByText("Practice")).not.toBeInTheDocument();
    const rows = screen.getAllByTestId(/training-quiz-result-q-/);
    expect(rows.map((r) => r.textContent)).toEqual(["Question 1Correct", "Question 2Not correct", "Question 3Correct"]);
    expect(posts.filter(([u]) => u.endsWith("/finish"))).toHaveLength(0);
  });

  it("an Up next row and Continue go to the next part; Try again opens a new attempt", async () => {
    wirePaper({ score: 3, max_score: 3, is_passed: true });
    await answerAll();
    const up = await screen.findByTestId("training-up-next");
    expect(within(up).getByText("Checking work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/portal/training/unit/m-5");
    fireEvent.click(button("Try again"));
    await waitFor(() => expect(posts.filter(([u]) => u.endsWith("/start"))).toHaveLength(2));
    expect(await screen.findByText("A group is too loud. What first?")).toBeInTheDocument();
  });

  it("not passed: says so, with the score", async () => {
    await answerAll();
    const hero = await screen.findByTestId("newui-hero");
    expect(within(hero).getByText("Not passed")).toBeInTheDocument();
    expect(within(hero).getByText("67%")).toBeInTheDocument();
  });

  it("not passed in a sequential course: no Up next, Continue returns to the course", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/module/m-4": { module: DETAIL_M4 },
    }) as never);
    await answerAll();
    await screen.findByTestId("newui-hero");
    await waitFor(() => expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/portal/training/provider/TALEEMABAD/level/2/course/c-3"));
    expect(screen.queryByTestId("training-up-next")).not.toBeInTheDocument();
  });

  it("asks the server to finish when the last answer could not close the quiz", async () => {
    const base = vi.mocked(api.post).getMockImplementation()!;
    vi.mocked(api.post).mockImplementation(((url: string, b: unknown) => {
      if (url.endsWith("/answer")) return (base(url, b) as Promise<{ data: Record<string, unknown> }>).then((r) => ({ data: { ...r.data, result: null } }));
      if (url.endsWith("/finish")) {
        posts.push([url, b]);
        return Promise.resolve({ data: { success: true, attempt: { id: "att-1", score: 2, max_score: 3, is_passed: false, completed_at: "" }, results: [] } });
      }
      return base(url, b);
    }) as never);
    await answerAll();
    expect(await screen.findByTestId("newui-hero")).toBeInTheDocument();
    expect(posts.map(([u]) => u)).toContain("/training/module/m-4/quiz-attempts/att-1/finish");
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    await checkAnswer(0);
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
