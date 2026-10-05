/**
 * bd-66wui — the classic Training page with ids in the shape production sends.
 *
 * /training/courses and /training/modules return training_courses.id and
 * training_modules.id as JSON NUMBERS (bigint through PostgREST;
 * dashboard/routes/portal.routes.js passes `m.id` through unchanged). The page
 * takes the open course and module from the URL, which is always a STRING, and
 * compared the two with ===. So on production:
 *   - moduleIndex was -1: no "Module N of M", both arrows disabled, no UP NEXT;
 *   - handleQuizSubmitted never matched, so a pass left the header "Not yet";
 *   - the course page's crumb read "Course" and "x of y complete" was missing.
 *
 * Every other test of this page uses string ids ('c-1', 'm-1'), where === and a
 * string comparison agree, so none of them could see it. These fixtures are
 * integers on purpose; do not "tidy" them into strings.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";

const mockedApi = api as unknown as { get: Mock; post: Mock };

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTrainingV2 from "./PortalTrainingV2";
import { TRAINING_V2_PATHS } from "../lib/trainingRoutes";

const VENDORS = [
  { vendor_key: "TALEEMABAD", vendor_name: "NIETE", level_count: 1, course_count: 1, module_count: 3, completed_module_count: 1, certificate_count: 0, avg_score_pct: null },
];
const LEVELS = [{
  id: 1, name: "Aspiring Teacher", order_index: 0, cpd_level: null, vendor_key: "TALEEMABAD", unlock_logic: "chain",
  state: "in_progress", module_count: 3, completed_count: 1, courses_total: 1, courses_completed: 0,
  passed_at: null, cooldown_until: null, previous_level_order: null,
}];
// Numeric, exactly as PostgREST returns a bigint primary key.
const COURSES = [{ id: 41, title: "Planning a lesson", course_type: "core", order_index: 0, level_id: 1, module_count: 3, completed_count: 1 }];
const MODULES = [
  { id: 301, title: "Learning objectives", course_id: 41, order_index: 0, duration_seconds: 0, completed_at: "2026-10-01T09:00:00Z", has_questions: true },
  { id: 302, title: "I Do, We Do, You Do", course_id: 41, order_index: 1, duration_seconds: 0, completed_at: null, has_questions: true },
  { id: 303, title: "Checking for understanding", course_id: 41, order_index: 2, duration_seconds: 0, completed_at: null, has_questions: true },
];
const QUESTIONS = [{ id: 9001, question_text: "Q1", options: ["a", "b"], order_index: 0 }];
const EXAM_OPEN = { available: true, body: "Your module exam is ready.", caption: "", cta: "Take the exam", module_no: 1 };

let exam: unknown = null;

beforeEach(() => {
  vi.clearAllMocks();
  exam = null;
  mockedApi.get.mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    if (url === "/training/courses") return Promise.resolve({ data: { courses: COURSES } });
    if (url === "/training/modules") return Promise.resolve({ data: { modules: MODULES, exam } });
    if (url === "/training/module/302")
      return Promise.resolve({ data: { module: { ...MODULES[1], content_html: "", video_url: null, audio_url: null, pdf_url: null, course: { id: 41, title: "Planning a lesson" }, level: { id: 1, name: "Aspiring Teacher" } } } });
    if (url === "/training/module/302/questions") return Promise.resolve({ data: { questions: QUESTIONS } });
    if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
    return Promise.resolve({ data: {} });
  });
  mockedApi.post.mockResolvedValue({ data: {} });
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_V2_PATHS.map(p => <Route key={p} path={p} element={<PortalTrainingV2 />} />)}
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const headerOf = (detail: HTMLElement) =>
  within(detail).getByRole("heading", { name: "I Do, We Do, You Do" }).parentElement as HTMLElement;

describe("bd-66wui — the unit page with numeric module ids", () => {
  it("knows where the unit sits in its course: Module 2 of 3, both arrows live, UP NEXT", async () => {
    renderAt("/portal/training/unit/302");
    await screen.findByTestId("module-detail");

    // The position needs the course's module list, which the page fetches
    // from the course the detail carries, so wait for it rather than the detail.
    expect(await screen.findByTestId("module-position")).toHaveTextContent("Module 2 of 3");
    expect(screen.getByTestId("module-prev")).toBeEnabled();
    expect(screen.getByTestId("module-next")).toBeEnabled();

    const upNext = screen.getByTestId("module-up-next");
    expect(upNext).toHaveTextContent("UP NEXT");
    expect(upNext).toHaveTextContent("Checking for understanding");
    await userEvent.click(within(upNext).getByRole("button", { name: /Continue/ }));
    expect(screen.getByTestId("where").textContent).toBe("/portal/training/unit/303");
  });

  async function submitQuiz(attempt: Record<string, unknown>) {
    mockedApi.post.mockResolvedValue({ data: { attempt: { id: "a1", completed_at: "2026-10-05T10:00:00Z", ...attempt } } });
    renderAt("/portal/training/unit/302");
    const detail = await screen.findByTestId("module-detail");
    expect(headerOf(detail)).toHaveTextContent("Not yet");
    await userEvent.click(await screen.findByTestId("quiz-take-button"));
    await userEvent.click(await screen.findByLabelText(/A\./));
    await userEvent.click(screen.getByTestId("quiz-submit-button"));
    await screen.findByTestId("quiz-panel-result");
    return detail;
  }

  it("a PASSED quiz flips the header to Completed", async () => {
    const detail = await submitQuiz({ score: 5, max_score: 5, is_passed: true, pass_pct: 100 });
    await waitFor(() => expect(headerOf(detail)).toHaveTextContent("Completed"));
    expect(headerOf(detail)).not.toHaveTextContent("Not yet");
  });

  it("a FAILED quiz still leaves it Not yet (bd-zgme6 holds with numeric ids)", async () => {
    const detail = await submitQuiz({ score: 4, max_score: 5, is_passed: false, pass_pct: 100 });
    await new Promise(r => setTimeout(r, 30));
    expect(headerOf(detail)).toHaveTextContent("Not yet");
    expect(headerOf(detail)).not.toHaveTextContent("Completed");
  });
});

describe("bd-66wui — the course page with a numeric course id", () => {
  const COURSE_URL = "/portal/training/provider/TALEEMABAD/level/1/course/41";

  it("names the course in the breadcrumb and says how far through it she is", async () => {
    renderAt(COURSE_URL);
    await screen.findByTestId("module-item-302");
    const crumb = screen.getByTestId("training-breadcrumb");
    await waitFor(() => expect(crumb).toHaveTextContent("Planning a lesson"));
    expect(within(crumb).queryByText("Course")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-list")).toHaveTextContent("1 of 3 complete");
  });

  it("carries the course name onto the exam page's breadcrumb", async () => {
    exam = EXAM_OPEN;
    renderAt(COURSE_URL);
    await waitFor(() => expect(screen.getByTestId("training-breadcrumb")).toHaveTextContent("Planning a lesson"));
    await userEvent.click(await screen.findByTestId("module-exam-start"));
    expect(screen.getByTestId("where").textContent).toBe("/portal/training/exam/41");
    expect(await screen.findByTestId("breadcrumb-course")).toHaveTextContent("Planning a lesson");
  });
});
