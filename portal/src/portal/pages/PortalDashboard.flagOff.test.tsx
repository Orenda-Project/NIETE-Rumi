import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";

/**
 * bd-5rz1v.17 — the new Home ships behind `portal_new_ui`, and with the flag OFF the
 * dashboard must be exactly what it was.
 *
 * The snapshot in __snapshots__/ was recorded against PortalDashboard as it was BEFORE the
 * new Home existed (the layout and the navigation included). Every flag-off state must render
 * that same markup: the flag false, absent from /config, /config still loading, and /config
 * failing. A difference of one class name fails this test.
 */

vi.mock("react-apexcharts", () => ({ default: () => null }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// A STABLE toast: the dashboard's fetch effect depends on it, and a new function per render
// refetches for ever.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getDashboard: vi.fn(),
    getCoachingAnalytics: vi.fn(),
  },
}));

import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalDashboard from "./PortalDashboard";

type ConfigMode = "off" | "absent" | "loading" | "fails";

function setConfig(mode: ConfigMode) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false } } as never);
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null } } as never);
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderDashboard(mode: ConfigMode) {
  resetNewUiMemory();
  setConfig(mode);
  vi.mocked(portal.getDashboard).mockResolvedValue({
    stats: { totalCoachingSessions: 3, totalAssessments: 4, training: { modulesCompleted: 6, currentLevel: "Level 2" } },
    recentCoachingSession: { id: "s-1", date: "2026-10-01T10:00:00Z", duration: 1800, percentage: 64 },
  } as never);
  vi.mocked(portal.getCoachingAnalytics).mockResolvedValue({ analytics: { overallScoreTrend: [] } } as never);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", lastName: "Khan", role: "teacher", phoneNumber: "923001234567" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  const { container } = render(
    <MemoryRouter initialEntries={["/portal/dashboard"]}>
      <PortalDashboard />
    </MemoryRouter>,
  );
  await screen.findByTestId("dashboard-greeting");
  await settle();
  const html = normalise(container.innerHTML);
  cleanup();
  return html;
}

describe("bd-5rz1v.17 — flag off: the dashboard is exactly what it was", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches the dashboard recorded before the new Home, in every flag-off state", { timeout: 30_000 }, async () => {
    const off = await renderDashboard("off");
    expect(off).toMatchSnapshot("dashboard");
    for (const mode of ["absent", "loading", "fails"] as const) {
      expect(await renderDashboard(mode), mode).toBe(off);
    }
  });
});
