/**
 * bd-60152 — the prev/next arrows on a unit opened BY URL.
 *
 * The operator reported "navigation don't work" twice: once on the dedicated
 * unit page, and again after the first fix, with both arrows still greyed out
 * on Unit 303 — a unit that plainly has neighbours either side.
 *
 * The arrows derive from moduleIndex = modules.findIndex(selectedModule). On a
 * deep link to /training/v2/unit/:id that index went to -1 and stayed there,
 * for a reason no component test caught: an ordering race between three
 * effects, each individually correct.
 *
 *   detail arrives
 *     -> the restore effect reads moduleDetail.course, sets selectedCourse
 *       -> which re-runs the course effect
 *         -> which called setModuleDetail(null)
 *
 * The detail fetch keys on selectedModule ALONE, so it never re-ran; the
 * restore's `if (!moduleDetail) return` then bailed forever. The page was left
 * holding a module id with no detail and no neighbours.
 *
 * This test drives the real route with a real (mocked-at-the-network) detail
 * response, so it executes that whole effect chain rather than asserting on a
 * rendered shape. Against the pre-fix page both arrows are disabled; the
 * assertion is that the NEXT arrow is live, because Unit 303 has a successor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTrainingV2 from "./PortalTrainingV2";

const COURSE = "course-3";
const LEVEL = { id: 27, name: "Level 1: Novice" };

// Three sibling units. 303 sits in the middle on purpose: a correct page
// offers BOTH arrows, so a one-sided bug cannot pass by luck.
const MODULES = [
  { id: "m-302", title: "Unit 302", course_id: COURSE, duration_seconds: 0, completed_at: null, has_questions: true },
  { id: "m-303", title: "Unit 303", course_id: COURSE, duration_seconds: 0, completed_at: null, has_questions: true },
  { id: "m-304", title: "Unit 304", course_id: COURSE, duration_seconds: 0, completed_at: null, has_questions: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors")
      return Promise.resolve({ data: { vendors: [{ id: "v1", vendor_key: "ISAPS", vendor_name: "I-SAPS", level_count: 1, course_count: 1, module_count: 3, completed_module_count: 0, certificate_count: 0 }] } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: [LEVEL] } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    if (url === "/training/courses") return Promise.resolve({ data: { courses: [{ id: COURSE, title: "Module 3", level_id: LEVEL.id }] } });
    if (url === "/training/modules") return Promise.resolve({ data: { modules: MODULES, exam: null } });
    // The detail response is what carries the page back to its course/level.
    if (url === "/training/module/m-303")
      return Promise.resolve({ data: { module: { ...MODULES[1], course: { id: COURSE, title: "Module 3" }, level: LEVEL, content: [], completed_at: null } } });
    if (/^\/training\/module\/.+\/attempts$/.test(url)) return Promise.resolve({ data: { attempts: [] } });
    return Promise.resolve({ data: {} });
  });
});

function renderAtUnit(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/portal/training/v2/unit/${id}`]}>
      <Routes>
        <Route path="/portal/training/v2/unit/:moduleId" element={<PortalTrainingV2 />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("bd-60152 — unit opened by URL keeps its neighbours", () => {
  it("enables the next arrow on a mid-course unit reached by deep link", async () => {
    renderAtUnit("m-303");

    // The unit itself renders — proves the route resolved and detail loaded.
    expect(await screen.findByText("Unit 303")).toBeInTheDocument();

    // The actual regression: neighbours must be known, so the arrow is live.
    await waitFor(() => {
      expect(screen.getByTestId("module-next")).not.toBeDisabled();
    });
  });

  it("enables the previous arrow too, since 303 has a predecessor", async () => {
    renderAtUnit("m-303");
    expect(await screen.findByText("Unit 303")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("module-prev")).not.toBeDisabled();
    });
  });
});
