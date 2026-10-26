import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-sex15q.15 — More, with and without COACHIP. The insight menu takes the Training Library and Lesson Plans off the
 * bar, so with portal_coachip on they are rows on More (ruling 06:11Z: training one tap away). Off, absent or failing:
 * More is exactly what it was (no new row).
 */
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, coach: { getHome: vi.fn() } }));
vi.mock("../../../lib/useChildTestSa", () => ({ useChildTestSa: () => false }));
vi.mock("../../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn }));
import { useAuth } from "../../../hooks/useAuth";
import { coach, language, portal } from "../../../services/api";
import { resetCoachipMemory } from "../useCoachip";
import CoachMore from "../../profile/CoachMore";

async function renderMore(mode: "on" | "off" | "absent" | "fails") {
  resetCoachipMemory();
  const cfg = vi.mocked(portal.getConfig);
  if (mode === "fails") cfg.mockRejectedValue(new Error("down"));
  else cfg.mockResolvedValue({ success: true, features: mode === "absent" ? {} : { coachip: mode === "on" } } as never);
  vi.mocked(useAuth).mockReturnValue({ user: { firstName: "C", role: "coach", phoneNumber: "+920000000003" }, loading: false, logout: vi.fn() } as never);
  render(<MemoryRouter initialEntries={["/portal/coach/more"]}><CoachMore /></MemoryRouter>);
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false } as never);
  vi.mocked(coach.getHome).mockRejectedValue(new Error("not needed"));
});
afterEach(() => cleanup());

describe("More and COACHIP", () => {
  it.each(["off", "absent", "fails"] as const)("switch %s: no Training or Lesson Plans row (More unchanged)", async (mode) => {
    await renderMore(mode);
    expect(screen.queryByTestId("more-row-training")).toBeNull();
    expect(screen.queryByTestId("more-row-lessons")).toBeNull();
    expect(screen.getByTestId("more-row-profile")).toBeTruthy();
  });

  it("switch on: Training Library and Lesson Plans are rows on More", async () => {
    await renderMore("on");
    expect(screen.getByTestId("more-row-training").getAttribute("href")).toBe("/portal/coach/training");
    expect(screen.getByTestId("more-row-lessons").getAttribute("href")).toBe("/portal/teacher/lessons");
  });
});
