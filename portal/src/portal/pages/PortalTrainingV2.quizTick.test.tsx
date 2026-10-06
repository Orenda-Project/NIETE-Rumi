/**
 * bd-zgme6 — a failed module quiz ticked the module "Completed" on the page.
 *
 * The server writes teacher_training_progress ONLY on a pass (bd-2450,
 * dashboard/routes/portal.routes.js), against the vendor's module bar: 100%
 * for NIETE. But handleQuizSubmitted stamped `completed_at` onto the open
 * module whatever the score, so a NIETE teacher who scored 4/5 saw a green
 * "Completed" until the list was read again, and the database said otherwise.
 *
 * The tick has to follow the verdict the server returned: `is_passed`.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";

const mockedApi = api as unknown as { get: Mock; post: Mock };

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTrainingV2 from "./PortalTrainingV2";
import { mockOneQuestionQuiz, takeOneQuestionQuiz } from "../components/__testing__/oneQuestionQuiz";
import { TRAINING_V2_PATHS } from "../lib/trainingRoutes";

const VENDORS = [
  { vendor_key: "TALEEMABAD", vendor_name: "NIETE", level_count: 1, course_count: 1, module_count: 2, completed_module_count: 0, certificate_count: 0, avg_score_pct: null },
];
const LEVELS = [{
  id: 1, name: "Aspiring Teacher", order_index: 0, cpd_level: null, vendor_key: "TALEEMABAD", unlock_logic: "chain",
  state: "in_progress", module_count: 2, completed_count: 0, courses_total: 1, courses_completed: 0,
  passed_at: null, cooldown_until: null, previous_level_order: null,
}];
const COURSES = [{ id: "c-1", title: "Planning a lesson", level_id: 1, module_count: 2, completed_count: 0 }];
const MODULES = [
  { id: "m-1", title: "Learning objectives", course_id: "c-1", duration_seconds: 0, completed_at: null, has_questions: true },
  { id: "m-2", title: "I Do, We Do, You Do", course_id: "c-1", duration_seconds: 0, completed_at: null, has_questions: true },
];
const QUESTIONS = [{ id: 1, question_text: "Q1", options: ["a", "b"], order_index: 0 }];

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    if (url === "/training/courses") return Promise.resolve({ data: { courses: COURSES } });
    if (url === "/training/modules") return Promise.resolve({ data: { modules: MODULES, exam: null } });
    if (url === "/training/module/m-2")
      return Promise.resolve({ data: { module: { ...MODULES[1], course: { id: "c-1", title: "Planning a lesson" }, level: { id: 1, name: "Aspiring Teacher" } } } });
    if (url === "/training/module/m-2/questions") return Promise.resolve({ data: { questions: QUESTIONS } });
    if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
    return Promise.resolve({ data: {} });
  });
});

function renderUnit() {
  return render(
    <MemoryRouter initialEntries={["/portal/training/unit/m-2"]}>
      <Routes>
        {TRAINING_V2_PATHS.map(p => <Route key={p} path={p} element={<PortalTrainingV2 />} />)}
      </Routes>
    </MemoryRouter>,
  );
}

async function submitQuiz(attempt: Record<string, unknown>) {
  mockOneQuestionQuiz(mockedApi.post, attempt);
  renderUnit();
  const detail = await screen.findByTestId("module-detail");
  expect(detail).toHaveTextContent("Not yet");
  await takeOneQuestionQuiz();
  return detail;
}

describe("bd-zgme6 — the Completed tick follows the server's verdict", () => {
  it("a failed attempt (NIETE, 4/5 against a 100% bar) leaves the module Not yet", async () => {
    const detail = await submitQuiz({ score: 4, max_score: 5, is_passed: false, pass_pct: 100 });
    // Give any stray state update a chance to land before asserting absence.
    await new Promise(r => setTimeout(r, 30));
    const header = within(detail).getByRole("heading", { name: "I Do, We Do, You Do" }).parentElement as HTMLElement;
    expect(header).toHaveTextContent("Not yet");
    expect(header).not.toHaveTextContent("Completed");
  });

  it("a passed attempt ticks the module Completed straight away", async () => {
    const detail = await submitQuiz({ score: 5, max_score: 5, is_passed: true, pass_pct: 100 });
    const header = within(detail).getByRole("heading", { name: "I Do, We Do, You Do" }).parentElement as HTMLElement;
    await waitFor(() => expect(header).toHaveTextContent("Completed"));
    expect(header).not.toHaveTextContent("Not yet");
  });
});
