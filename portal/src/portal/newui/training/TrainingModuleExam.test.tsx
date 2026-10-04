import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, act, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { MODULE_EXAM_GATE, MODULE_EXAM_PAPER, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — the I-SAPS module exam (/portal/training/exam/:courseId), one question per screen
 * like the level exam, keeping everything ModuleExamPanel does:
 *
 *   the paper     GET /exam/questions opens (or resumes) the attempt; her draft is restored from
 *                 GET /exam/draft, so a returning teacher sees her own answers
 *   autosave      each answer saved on its own, 800ms after she stops (PUT /exam/draft), shown as
 *                 a quiet chip: Saving…, Saved, Not saved
 *   submit        POST /exam/attempts with the attempt id; a written answer still being graded
 *                 comes back as "Being graded" from her record
 *   her sittings  the latest as a Hero, her answers in a sheet, earlier ones as rows; Try again
 *                 only after a failed sitting
 */

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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
    </MemoryRouter>,
  );
}

const EXAM = "/portal/training/exam/c-9";
const attempt = (status: string, over: Record<string, unknown> = {}) => ({
  id: `s-${status}`, status, started_at: "2026-10-02T09:00:00Z", completed_at: "2026-10-02T09:20:00Z",
  mcq_correct: 2, mcq_served: 2, mcq_needed: 2, crq: { held: true, score: null, max: 4, feedback: null },
  answers: [
    { index: 0, question_text: "A pupil disrupts the lesson. Best first step?", is_open_ended: false, options: ["Send them out", "Quietly redirect", "Ignore"], chosen_option: "2", answer_text: null },
    { index: 2, question_text: "Describe a lesson plan you taught this week.", is_open_ended: true, options: [], chosen_option: null, answer_text: "Fractions with paper strips." },
  ],
  ...over,
});
const routes = (over: Record<string, unknown> = {}) => trainingGet({
  "/training/modules": { modules: [], exam: MODULE_EXAM_GATE, readings: null },
  "/training/module/c-9/exam/attempts": { attempts: [] },
  "/training/module/c-9/exam/questions": MODULE_EXAM_PAPER,
  "/training/module/c-9/exam/draft": { answers: [] },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(routes() as never);
  vi.mocked(api.put).mockResolvedValue({ data: { saved: true } } as never);
});
afterEach(() => vi.useRealTimers());

/** The Hero whose title is `text` (not the loading Hero that comes before it). */
async function heroWith(text: string): Promise<HTMLElement> {
  const found = await screen.findAllByText(text);
  const hero = found.map((el) => el.closest("[data-testid=newui-hero]")).find(Boolean);
  if (!hero) throw new Error(`no Hero titled ${text}`);
  return hero as HTMLElement;
}

const choices = () => Array.from(document.querySelectorAll<HTMLElement>("[role=radio], [role=checkbox]"));

describe("a first sitting", () => {
  it("the light bar 'Module 1 exam'; a Ready Hero and Start exam", async () => {
    renderAt(EXAM);
    expect(await screen.findByRole("heading", { level: 1, name: "Module 1 exam" })).toBeInTheDocument();
    const hero = await heroWith("Ready");
    expect(screen.getByRole("button", { name: "Start exam" })).toBeInTheDocument();
  });

  it("Start opens the paper one question per screen, with the written answer as a text box", async () => {
    renderAt(EXAM);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    await screen.findByText("A pupil disrupts the lesson. Best first step?");
    expect(choices()).toHaveLength(3);
    fireEvent.click(choices()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(choices()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("Describe a lesson plan you taught this week.")).toBeInTheDocument();
  });

  it("restores her draft when the attempt is resumed", async () => {
    vi.mocked(api.get).mockImplementation(routes({
      "/training/module/c-9/exam/draft": { answers: [{ question_id: 501, chosen_option: "2", answer_text: null }, { question_id: 503, chosen_option: null, answer_text: "Started before." }] },
    }) as never);
    renderAt(EXAM);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    await screen.findByText("A pupil disrupts the lesson. Best first step?");
    expect(choices()[1]).toHaveAttribute("aria-checked", "true");
    expect(api.get).toHaveBeenCalledWith("/training/module/c-9/exam/draft", { params: { attempt_id: "mx-1" } });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("saves each answer on its own, 800ms after the last change (PUT /exam/draft)", async () => {
    renderAt(EXAM);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    await screen.findByText("A pupil disrupts the lesson. Best first step?");
    vi.useFakeTimers();
    fireEvent.click(choices()[1]);
    expect(api.put).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(api.put).toHaveBeenCalledWith("/training/module/c-9/exam/draft", {
      attempt_id: "mx-1", question_id: 501, question_index: 0, chosen_option: "2", answer_text: null,
    });
    vi.useRealTimers();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("Submit posts the attempt; a written answer being graded comes back from her record", async () => {
    let submitted = false;
    vi.mocked(api.get).mockImplementation(routes({
      "/training/module/c-9/exam/attempts": () => ({ attempts: submitted ? [attempt("pending_review")] : [] }),
    }) as never);
    vi.mocked(api.post).mockImplementation((async () => { submitted = true; return { data: { crq_pending: true } }; }) as never);
    renderAt(EXAM);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    await screen.findByText("A pupil disrupts the lesson. Best first step?");
    fireEvent.click(choices()[1]); fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(choices()[1]); fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Fractions with paper strips." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await heroWith("Being graded")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/training/module/c-9/exam/attempts", {
      attempt_id: "mx-1",
      answers: [
        { question_id: 501, chosen_option: "2" },
        { question_id: 502, chosen_option: "2" },
        { question_id: 503, answer_text: "Fractions with paper strips." },
      ],
    });
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("her sittings", () => {
  it("failed: Not passed with the MCQ tally; Try again; her answers in a sheet; earlier sittings as rows", async () => {
    vi.mocked(api.get).mockImplementation(routes({
      "/training/module/c-9/exam/attempts": { attempts: [attempt("failed", { mcq_correct: 1 }), attempt("failed", { id: "s-old", mcq_correct: 0, completed_at: "2026-09-28T09:00:00Z" })] },
    }) as never);
    renderAt(EXAM);
    const hero = await heroWith("Not passed");
    expect(within(hero).getByText("MCQ 1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("training-exam-answers"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Fractions with paper strips.")).toBeInTheDocument();
    expect(within(sheet).getByText("Quietly redirect")).toBeInTheDocument();
    expect(screen.getByTestId("training-exam-earlier")).toHaveTextContent("28 Sep");
  });

  it("passed: a green Passed, no Try again", async () => {
    vi.mocked(api.get).mockImplementation(routes({
      "/training/modules": { modules: [], exam: { ...MODULE_EXAM_GATE, available: false, cta: "✓ Passed" }, readings: null },
      "/training/module/c-9/exam/attempts": { attempts: [attempt("passed")] },
    }) as never);
    renderAt(EXAM);
    const hero = await heroWith("Passed");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("closed with no sitting: Locked, with the gate's own word", async () => {
    vi.mocked(api.get).mockImplementation(routes({
      "/training/modules": { modules: [], exam: { ...MODULE_EXAM_GATE, available: false, cta: "🔒 Locked", body: "Finish the units first." }, readings: null },
    }) as never);
    renderAt(EXAM);
    const hero = await heroWith("Locked");
    expect(screen.queryByText("Finish the units first.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt(EXAM);
    await screen.findByRole("button", { name: "Start exam" });
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
