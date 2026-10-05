import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { DETAIL_M4, MODULES_C3, QUESTIONS_M4, httpError, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — the quick check, ONE QUESTION PER SCREEN (deep-screens.html, Training 6 and 7).
 *
 *   quiz    progress dots, the question, big A–D answers (the picked one indigo); "Pick all" on a
 *           multi-select question; Next once answered, Back to the previous question, Submit on
 *           the last. The data is unchanged: the same questions endpoint and the same answer set
 *           ModuleQuizPanel posts (chosen_option 1-based, '1,3' for pick all).
 *   result  a green score ring, the "80%" chip, an Up next row; Continue and Try again. No
 *           "Practice" chip: since bd-2450 only a PASS completes the part (and opens the next).
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
  vi.mocked(api.post).mockResolvedValue({ data: { attempt: { id: "att-1", score: 4, max_score: 5, is_passed: true, completed_at: "2026-10-03T10:00:00Z" } } } as never);
});

const next = () => screen.getByRole("button", { name: "Next" });
const choices = () => Array.from(document.querySelectorAll<HTMLElement>("[role=radio], [role=checkbox]"));
const pick = (i: number) => fireEvent.click(choices()[i]);

describe("one question per screen", () => {
  it("the light bar (crumb 'Training · Noise and rules', title 'Quick check', '1/5'), dots, the question, A–D", async () => {
    renderAt(QUIZ);
    expect(await screen.findByRole("heading", { level: 1, name: "Quick check" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Training · Noise and rules"));
    expect(await within(screen.getByTestId("newui-inner-bar")).findByText("1/5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Question 1\/5/ })).toBeInTheDocument();
    expect(screen.getByText("A group is too loud. What first?")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.queryByText("When do you agree the rules?")).not.toBeInTheDocument();
  });

  it("Next waits for an answer; the picked answer is indigo; Next shows the next question", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    expect(next()).toBeDisabled();
    pick(1);
    expect(screen.getAllByRole("radio")[1]).toHaveAttribute("aria-checked", "true");
    expect(next()).toBeEnabled();
    fireEvent.click(next());
    expect(screen.getByText("When do you agree the rules?")).toBeInTheDocument();
    expect(within(screen.getByTestId("newui-inner-bar")).getByText("2/5")).toBeInTheDocument();
  });

  it("Back goes to the previous question, with its answer kept", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    pick(1);
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("A group is too loud. What first?")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")[1]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("where")).toHaveTextContent(QUIZ);
  });

  it("a pick-all question says 'Pick all' and takes several", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    for (const i of [1, 0, 1]) { pick(i); fireEvent.click(next()); }
    expect(screen.getByText("Which are good quiet signals?")).toBeInTheDocument();
    expect(screen.getByText("Pick all")).toBeInTheDocument();
    pick(2);
    pick(0);
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false", "true", "false"]);
  });

  it("the last question's button is Submit, and it sends ModuleQuizPanel's exact answer set", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    pick(1); fireEvent.click(next());
    pick(0); fireEvent.click(next());
    pick(1); fireEvent.click(next());
    pick(2); pick(0); fireEvent.click(next());
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    pick(0);
    fireEvent.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/module/m-4/quiz-attempts", {
      answers: [
        { question_id: 41, chosen_option: "2" },
        { question_id: 42, chosen_option: "1" },
        { question_id: 43, chosen_option: "2" },
        { question_id: 44, chosen_option: "1,3" },
        { question_id: 45, chosen_option: "1" },
      ],
    }));
  });
});

async function answerAll() {
  renderAt(QUIZ);
  await screen.findByText("A group is too loud. What first?");
  for (let q = 0; q < 5; q += 1) {
    pick(0);
    fireEvent.click(screen.getByRole("button", { name: q < 4 ? "Next" : "Submit" }));
  }
}

describe("the result", () => {
  it("a green ring with 4/5, Passed, the 80% chip — no 'Practice': a pass is what completes the part", async () => {
    await answerAll();
    const hero = await screen.findByTestId("newui-hero");
    expect(within(hero).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "4/5");
    expect(within(hero).getByText("Passed")).toBeInTheDocument();
    expect(within(hero).getByText("80%")).toBeInTheDocument();
    expect(within(hero).queryByText("Practice")).not.toBeInTheDocument();
  });

  it("an Up next row and Continue go to the next part; Try again starts over", async () => {
    await answerAll();
    const up = await screen.findByTestId("training-up-next");
    expect(within(up).getByText("Checking work")).toBeInTheDocument();
    expect(within(up).getByText("Up next")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/portal/training/unit/m-5");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("A group is too loud. What first?")).toBeInTheDocument();
    expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("not passed: says so; the ring is still the score; the next part stays shut (only a pass completes)", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { attempt: { id: "att-2", score: 2, max_score: 5, is_passed: false, completed_at: "2026-10-03T10:00:00Z" } } } as never);
    await answerAll();
    const hero = await screen.findByTestId("newui-hero");
    expect(within(hero).getByText("Not passed")).toBeInTheDocument();
    expect(within(hero).getByText("40%")).toBeInTheDocument();
    // A sequential course: the part after is still locked, so Continue goes back to the course.
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/module/m-4": { module: DETAIL_M4 },
      "/training/module/m-4/questions": { questions: QUESTIONS_M4 },
    }) as never);
  });

  it("not passed in a sequential course: no Up next, Continue returns to the course", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/module/m-4": { module: DETAIL_M4 },
      "/training/module/m-4/questions": { questions: QUESTIONS_M4 },
    }) as never);
    vi.mocked(api.post).mockResolvedValue({ data: { attempt: { id: "att-3", score: 1, max_score: 5, is_passed: false, completed_at: "2026-10-03T10:00:00Z" } } } as never);
    await answerAll();
    await screen.findByTestId("newui-hero");
    await waitFor(() => expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/portal/training/provider/TALEEMABAD/level/2/course/c-3"));
    expect(screen.queryByTestId("training-up-next")).not.toBeInTheDocument();
  });

  it("a send that fails keeps her answers and says so", async () => {
    vi.mocked(api.post).mockRejectedValue(httpError(500));
    await answerAll();
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt(QUIZ);
    await screen.findByText("A group is too loud. What first?");
    pick(0);
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
