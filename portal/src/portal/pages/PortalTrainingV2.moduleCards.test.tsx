/**
 * bd-klecr.5 — the course page shows its modules as CARDS, like the provider,
 * level and course pages one step up (operator, 2026-10-06: "on the modules
 * screen the trainings are added in a list form, i want them in the cards form
 * just like the other screens"; design option A, versions/v2_module-cards-phone
 * in the bd-klecr investigation folder).
 *
 *   a card per module   "MODULE N", the full title, its duration
 *   assessment          a line INSIDE the module's card (score / Not attempted),
 *                       no longer a second row under it; none when the module
 *                       has no questions
 *   done                data-done, a check
 *   up next             the first module neither done nor locked
 *   locked              the server's lock (unitRowState, unchanged): disabled,
 *                       a lock, and "Finish Module N first" in words a phone
 *                       can see (the hint used to be a hover-only title)
 *   exam + reading      below the cards, in their own card
 *
 * Operator, 2026-10-06 (on sandbox): the green-filled done card "looks weird";
 * design option 1 (versions/v3_done-state-options): every card stays white and
 * done is a small green check badge, "Completed". The quiz is a "Quiz" chip at
 * the foot. No "Up next" on the FIRST module: nothing is behind it yet, so
 * "next" says nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTrainingV2 from "./PortalTrainingV2";
import { TRAINING_V2_PATHS } from "../lib/trainingRoutes";

const VENDORS = [
  { vendor_key: "TALEEMABAD", vendor_name: "NIETE", level_count: 1, course_count: 1, module_count: 4, completed_module_count: 1, certificate_count: 0, avg_score_pct: null },
];
const LEVELS = [{
  id: 1, name: "Skilled Practitioner", order_index: 2, cpd_level: null, vendor_key: "TALEEMABAD", unlock_logic: "chain", state: "in_progress",
  module_count: 4, completed_count: 1, courses_total: 1, courses_completed: 0, passed_at: null, cooldown_until: null, previous_level_order: 1,
}];
const COURSES = [{ id: "c-1", title: "Course", level_id: 1, module_count: 4, completed_count: 1 }];
const MODULES = [
  { id: "m-1", title: "Restorative Practices", course_id: "c-1", order_index: 0, duration_seconds: 480, completed_at: "2026-10-01T10:00:00Z", has_questions: true, lock: "passed" },
  { id: "m-2", title: "Positive Reinforcement Strategies", course_id: "c-1", order_index: 1, duration_seconds: 660, completed_at: null, has_questions: true, lock: "next" },
  { id: "m-3", title: "Expectations and Goals", course_id: "c-1", order_index: 2, duration_seconds: 0, completed_at: null, has_questions: false, lock: "locked" },
  { id: "m-4", title: "Classroom Routines", course_id: "c-1", order_index: 3, duration_seconds: 0, completed_at: null, has_questions: true, lock: "locked" },
];
const ATTEMPTS: Record<string, unknown[]> = {
  "m-1": [{ id: "a1", completed_at: "2026-10-01T10:05:00Z", score: 8, max_score: 10, quiz_kind: "module" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    if (url === "/training/courses") return Promise.resolve({ data: { courses: COURSES } });
    if (url === "/training/modules") return Promise.resolve({ data: { modules: MODULES, exam: null } });
    const m = url.match(/^\/training\/module\/(.+)\/attempts$/);
    if (m) return Promise.resolve({ data: { attempts: ATTEMPTS[m[1]] || [] } });
    return Promise.resolve({ data: {} });
  });
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
function renderCourse() {
  return render(
    <MemoryRouter initialEntries={["/portal/training/provider/TALEEMABAD/level/1/course/c-1"]}>
      <Routes>
        {TRAINING_V2_PATHS.map(p => <Route key={p} path={p} element={<PortalTrainingV2 />} />)}
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe("Course page — modules as cards", () => {
  it("lays the modules out as a grid of cards, numbered MODULE 1…n", async () => {
    renderCourse();
    const grid = await screen.findByTestId("module-grid");
    expect(grid.className).toMatch(/grid/);
    expect(grid.className).toMatch(/lg:grid-cols-3/);
    for (const [i, m] of MODULES.entries()) {
      const card = within(grid).getByTestId(`module-item-${m.id}`);
      expect(card).toHaveTextContent(`MODULE ${i + 1}`);
      expect(card).toHaveTextContent(m.title);
    }
    expect(within(grid).getByTestId("module-item-m-1")).toHaveTextContent("8 min");
  });

  it("puts the assessment INSIDE its module's card, not as a row of its own", async () => {
    renderCourse();
    const done = await screen.findByTestId("module-item-m-1");
    const line = within(done).getByTestId("module-assessment-m-1");
    expect(line).toHaveTextContent("Quiz");
    expect(await within(line).findByTestId("quiz-score-badge")).toHaveTextContent("8 / 10");
    // A module with no questions promises no assessment.
    expect(screen.queryByTestId("module-assessment-m-3")).not.toBeInTheDocument();
    expect(screen.queryByText(/— Assessment/)).not.toBeInTheDocument();
  });

  it("marks the done module, and the first open one as up next", async () => {
    renderCourse();
    expect(await screen.findByTestId("module-item-m-1")).toHaveAttribute("data-done", "true");
    const next = screen.getByTestId("module-item-m-2");
    expect(next).toHaveAttribute("data-next", "true");
    expect(next).toHaveTextContent("Up next");
    expect(screen.getByTestId("module-item-m-1")).not.toHaveAttribute("data-next", "true");
  });

  it("keeps a locked module shut, and says which module opens it", async () => {
    renderCourse();
    const locked = await screen.findByTestId("module-item-m-4");
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("data-lock", "locked");
    expect(within(locked).getByLabelText("Locked")).toBeInTheDocument();
    expect(locked).toHaveTextContent("Finish Module 3 first");
    expect(locked).not.toHaveTextContent("Up next");
    // A locked card has no assessment line to tempt a tap.
    expect(within(locked).queryByTestId("module-assessment-m-4")).not.toBeInTheDocument();
    await userEvent.click(locked);
    expect(screen.getByTestId("where").textContent).toBe("/portal/training/provider/TALEEMABAD/level/1/course/c-1");
  });

  it("opens an open module's unit page from its card", async () => {
    renderCourse();
    await userEvent.click(await screen.findByTestId("module-item-m-2"));
    expect(screen.getByTestId("where").textContent).toBe("/portal/training/unit/m-2");
  });

  it("keeps a done card white, with a Completed check badge", async () => {
    renderCourse();
    const done = await screen.findByTestId("module-item-m-1");
    expect(done.className).not.toMatch(/bg-green/);
    expect(within(done).getByTestId("module-done-badge")).toHaveTextContent("Completed");
    // An open module not yet quizzed says so in words, not a dash.
    expect(await within(screen.getByTestId("module-assessment-m-2")).findByText("Not attempted")).toBeInTheDocument();
  });

  it("does not call the first module Up next", async () => {
    const fresh = MODULES.map((m, i) => ({ ...m, completed_at: null, lock: i === 0 ? "next" : "locked" }));
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/training/vendors") return Promise.resolve({ data: { vendors: VENDORS } });
      if (url === "/training/levels") return Promise.resolve({ data: { levels: LEVELS } });
      if (url === "/training/courses") return Promise.resolve({ data: { courses: COURSES } });
      if (url === "/training/modules") return Promise.resolve({ data: { modules: fresh, exam: null } });
      if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
      return Promise.resolve({ data: {} });
    });
    renderCourse();
    const first = await screen.findByTestId("module-item-m-1");
    expect(first).not.toHaveTextContent("Up next");
    expect(first).not.toBeDisabled();
  });
});
