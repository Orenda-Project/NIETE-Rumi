import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2567: the dashboard greeting shows the teacher's FULL name.
//
// It used to greet on firstName alone ("Welcome back, Ayesha!"), which reads
// oddly in a cohort where several teachers share a first name, and wastes the
// lastName the API already returns (portal.routes.js selects first_name AND
// last_name, and the User type has carried lastName all along).
//
// The interesting case is not the happy path — it is the missing surname.
// `{firstName} {lastName}` with a null lastName renders "Ayesha undefined" or
// leaves a trailing space before the "!", both of which look broken to a
// teacher. Whether last_name is populated for real NIETE users could not be
// checked from here, so the null path is treated as the LIKELY one, not the
// edge case.

vi.mock("react-apexcharts", () => ({ default: () => null }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  portal: {
    getDashboard: vi.fn().mockResolvedValue({
      stats: { totalLessonPlans: 0, totalCoachingSessions: 0 },
      recentLessonPlans: [],
      recentCoachingSession: null,
    }),
    getCoachingAnalytics: vi.fn().mockResolvedValue({ analytics: { overallScoreTrend: [] } }),
  },
}));

import { useAuth } from "../hooks/useAuth";
import PortalDashboard from "./PortalDashboard";

// The dashboard shows <LoadingState/> until its async fetch resolves, so every
// assertion has to wait for the real render — a synchronous query finds nothing.
async function renderDashboard(user: any) {
  (useAuth as any).mockReturnValue({ user, logout: vi.fn() });
  render(
    <MemoryRouter>
      <PortalDashboard />
    </MemoryRouter>,
  );
  return waitFor(() => screen.getByTestId("dashboard-greeting"));
}

describe("PortalDashboard greeting — full name (bd-2567)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("greets with first AND last name", async () => {
    await renderDashboard({ firstName: "Ayesha", lastName: "Khan", role: "teacher" });
    expect(screen.getByTestId("dashboard-greeting")).toHaveTextContent("Welcome back, Ayesha Khan!");
  });

  it("falls back to the first name alone when there is no surname", async () => {
    // Must NOT render "Ayesha undefined" or leave a dangling space before "!".
    await renderDashboard({ firstName: "Ayesha", lastName: null, role: "teacher" });
    const el = screen.getByTestId("dashboard-greeting");
    expect(el).toHaveTextContent("Welcome back, Ayesha!");
    expect(el.textContent).not.toMatch(/undefined|null/);
  });

  it("ignores a whitespace-only surname", async () => {
    // last_name = '' or '   ' is the same as absent, and is common in data
    // migrated from a system that stored one combined name field.
    await renderDashboard({ firstName: "Ayesha", lastName: "   ", role: "teacher" });
    expect(screen.getByTestId("dashboard-greeting")).toHaveTextContent("Welcome back, Ayesha!");
  });

  it("trims stray whitespace around the parts", async () => {
    await renderDashboard({ firstName: " Ayesha ", lastName: " Khan ", role: "teacher" });
    expect(screen.getByTestId("dashboard-greeting")).toHaveTextContent("Welcome back, Ayesha Khan!");
  });

  it("never leaks 'undefined' into the greeting for a user with no surname", async () => {
    // The realistic unresolved-user case: the API returned a user, but
    // last_name is absent. (A fully undefined user renders nothing at all —
    // the dashboard is auth-gated — so there is no greeting to inspect there.)
    await renderDashboard({ firstName: "Ayesha", role: "teacher" });
    const el = screen.getByTestId("dashboard-greeting");
    expect(el.textContent).not.toMatch(/undefined|null/);
    expect(el).toHaveTextContent("Welcome back, Ayesha!");
  });
});
