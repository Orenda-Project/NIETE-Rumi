import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * bd-5rz1v.13 — /portal/assessment and its inner pages, through the route list App.tsx mounts
 * (ASSESSMENT_ROUTES). They exist only in the new UI: with `portal_new_ui` off, unreadable, or
 * for a school leader, every one of them goes to the old Curriculum page's Assessment tab, which
 * renders exactly what it did before.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
vi.mock("../newui/assessment/AssessmentHome", () => ({ default: () => <p>new assessment page</p> }));
vi.mock("../newui/assessment/AssessmentRequest", () => ({ default: () => <p>new writing page</p> }));
vi.mock("../newui/assessment/MyAssessments", () => ({ default: () => <p>new my assessments</p> }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import { resetNewUiMemory } from "../lib/useNewUi";
import { ASSESSMENT_PATH, ASSESSMENT_ROUTES } from "../lib/assessmentRoutes";
import PortalAssessment from "./PortalAssessment";

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderAt(path: string, user: Record<string, unknown> | null, newUi: boolean | "absent" | "throws") {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  if (newUi === "throws") vi.mocked(portal.getConfig).mockRejectedValue(new Error("down"));
  else {
    const features = newUi === "absent"
      ? { assessmentGenerator: true, assessmentGeneratorMessage: null }
      : { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi };
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {ASSESSMENT_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalAssessment view={r.view} />} />)}
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const TEACHER = { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" };
const COACH = { id: "c-1", firstName: "Noor", role: "coach", phoneNumber: "923001234568" };

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
});

describe("the routes", () => {
  it("are the page, a request being written, and her list", () => {
    expect(ASSESSMENT_PATH).toBe("/portal/assessment");
    expect(ASSESSMENT_ROUTES).toEqual([
      { path: "/portal/assessment", view: "home" },
      { path: "/portal/assessment/request/:requestId", view: "request" },
      { path: "/portal/assessment/mine", view: "mine" },
    ]);
  });

  it("App.tsx mounts every one of them, each on its own view", () => {
    const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");
    expect(app).toMatch(/ASSESSMENT_ROUTES\.map\(\(?(\w+)\)? => \(?\s*<Route key=\{\1\.path\} path=\{\1\.path\} element=\{<PortalAssessment view=\{\1\.view\} \/>\} \/>/);
  });
});

describe("flag on, a teacher", () => {
  it.each([
    ["/portal/assessment", "new assessment page"],
    ["/portal/assessment/request/r-1", "new writing page"],
    ["/portal/assessment/mine", "new my assessments"],
  ])("%s → %s", async (path, page) => {
    renderAt(path, TEACHER, true);
    expect(await screen.findByText(page)).toBeInTheDocument();
  });
});

describe("otherwise: the old Curriculum page's Assessment tab", () => {
  it.each([
    ["flag off", TEACHER, false],
    ["flag absent", TEACHER, "absent"],
    ["config unreadable", TEACHER, "throws"],
    ["a school leader, flag on", COACH, true],
  ] as const)("%s", async (_why, user, flag) => {
    for (const path of ["/portal/assessment", "/portal/assessment/mine", "/portal/assessment/request/r-1"]) {
      const view = renderAt(path, user, flag);
      expect(await screen.findByTestId("where")).toHaveTextContent("/portal/curriculum?tab=assessment");
      expect(screen.queryByText(/new /)).toBeNull();
      view.unmount();
      resetNewUiMemory();
    }
  });
});
