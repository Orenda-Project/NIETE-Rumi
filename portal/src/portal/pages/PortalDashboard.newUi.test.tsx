import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";

/**
 * bd-5rz1v.17 — which Home she gets. With `portal_new_ui` on, a teacher's /portal/dashboard is
 * the new Home, and Home's lists live under it (/portal/dashboard/lesson-plans, /coaching).
 * A leader still goes to My Patch. With the flag off (flagOff.test.tsx pins the markup) the
 * old dashboard renders, and a list's address goes back to it.
 */

vi.mock("react-apexcharts", () => ({ default: () => null }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn(), getDashboard: vi.fn(), getCoachingAnalytics: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import api, { portal } from "../services/api";
import PortalDashboard from "./PortalDashboard";
import PortalHomeList from "./PortalHomeList";

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function setup(user: Record<string, unknown>, newUi: boolean) {
  resetNewUiMemory();
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi } } as never);
  vi.mocked(portal.getDashboard).mockResolvedValue({ stats: { totalCoachingSessions: 0, totalAssessments: 0 }, recentCoachingSession: null } as never);
  vi.mocked(portal.getCoachingAnalytics).mockResolvedValue({ analytics: { overallScoreTrend: [] } } as never);
  vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/dashboard" element={<><PortalDashboard /><Where /></>} />
        <Route path="/portal/dashboard/:metric" element={<><PortalHomeList /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const TEACHER = { id: "t-1", firstName: "Ayesha", lastName: "Khan", role: "teacher", phoneNumber: "923001234567" };

beforeEach(() => vi.clearAllMocks());

describe("/portal/dashboard", () => {
  it("flag on, a teacher: the new Home", async () => {
    setup(TEACHER, true);
    renderAt("/portal/dashboard");
    expect(await screen.findByRole("heading", { name: "Salaam, Ayesha" })).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-greeting")).toBeNull();
  });

  it("flag off: the old dashboard", async () => {
    setup(TEACHER, false);
    renderAt("/portal/dashboard");
    expect(await screen.findByTestId("dashboard-greeting")).toHaveTextContent("Welcome back, Ayesha Khan!");
    expect(screen.queryByRole("heading", { name: /Salaam/ })).toBeNull();
  });

  it("flag on, a leader: still sent to My Patch", async () => {
    setup({ id: "c-1", firstName: "Noor", role: "coach", phoneNumber: "923001111111" }, true);
    renderAt("/portal/dashboard");
    expect(await screen.findByText("/portal/leader")).toBeInTheDocument();
  });
});

describe("/portal/dashboard/:metric", () => {
  it("flag on: Home's list", async () => {
    setup(TEACHER, true);
    renderAt("/portal/dashboard/coaching");
    expect(await screen.findByRole("heading", { name: "Coaching & observations" })).toBeInTheDocument();
  });

  it("flag off: back to the dashboard (the list is new UI only)", async () => {
    setup(TEACHER, false);
    renderAt("/portal/dashboard/coaching");
    expect(await screen.findByTestId("dashboard-greeting")).toBeInTheDocument();
  });
});
