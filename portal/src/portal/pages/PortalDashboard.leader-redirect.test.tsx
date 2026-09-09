import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2434 (NIETE port of bd-2412): a school leader (role in LEADER_ROLES) must
// NOT be stranded on the teacher dashboard after login — they belong on
// /portal/leader (My Patch). This guard catches every entry point: login
// redirect, a bookmark, a refresh.

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));
vi.mock("react-apexcharts", () => ({ default: () => null }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  portal: {
    getDashboard: vi.fn().mockResolvedValue({
      stats: {
        totalCoachingSessions: 0,
        totalAssessments: 0,
        training: { modulesCompleted: 0, modulesTotal: 0, currentLevel: null },
      },
      recentCoachingSession: null,
    }),
    getCoachingAnalytics: vi.fn().mockResolvedValue({ analytics: { overallScoreTrend: [] } }),
  },
}));

import { useAuth } from "../hooks/useAuth";
import PortalDashboard from "./PortalDashboard";

function renderAs(user: any) {
  (useAuth as any).mockReturnValue({ user, loading: false, logout: vi.fn() });
  render(<MemoryRouter><PortalDashboard /></MemoryRouter>);
}

describe("PortalDashboard — leader redirect (bd-2434)", () => {
  beforeEach(() => navigateSpy.mockClear());

  it("redirects a school leader (coach) to /portal/leader", () => {
    renderAs({ firstName: "Haroon", role: "coach" });
    expect(navigateSpy).toHaveBeenCalledWith("/portal/leader", { replace: true });
  });

  it("redirects other leader-family roles too (principal)", () => {
    renderAs({ firstName: "Sana", role: "principal" });
    expect(navigateSpy).toHaveBeenCalledWith("/portal/leader", { replace: true });
  });

  it("does NOT redirect a teacher", () => {
    renderAs({ firstName: "Ayesha", role: "teacher" });
    expect(navigateSpy).not.toHaveBeenCalledWith("/portal/leader", expect.anything());
  });

  it("does NOT redirect a user with no role", () => {
    renderAs({ firstName: "Nadia" });
    expect(navigateSpy).not.toHaveBeenCalledWith("/portal/leader", expect.anything());
  });
});
