import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-sex15q.15 — More, with and without COACHIP. The insight menu takes the Training Library and Lesson Plans off the
 * bar, so with portal_coachip on they are rows on More (the lead's decision: training one tap away). Off, absent or failing:
 * More is exactly what it was (no new row).
 */
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, coach: { getHome: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../lib/useChildTestSa", () => ({ useChildTestSa: () => false }));
vi.mock("../../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn }));
import { useAuth } from "../../../hooks/useAuth";
import api, { coach, language, portal } from "../../../services/api";
import { resetCoachipMemory } from "../useCoachip";
import CoachMore from "../../profile/CoachMore";

async function renderMore(mode: "on" | "off" | "absent" | "fails", rm?: boolean) {
  resetCoachipMemory();
  const cfg = vi.mocked(portal.getConfig);
  if (mode === "fails") cfg.mockRejectedValue(new Error("down"));
  else cfg.mockResolvedValue({ success: true, features: { ...(mode === "absent" ? {} : { coachip: mode === "on" }), ...(rm === undefined ? {} : { coachipRm: rm }) } } as never);
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
afterEach(() => { cleanup(); vi.mocked(api.get).mockReset(); vi.mocked(api.post).mockReset(); });

/** Every COACHIP request the page made (the More page itself reads none). */
const coachipCalls = () => [...vi.mocked(api.get).mock.calls, ...vi.mocked(api.post).mock.calls].map((c) => String(c[0])).filter((u) => u.includes("/coachip/"));

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

  // fix-r5 item 5d (SPEC v2.1 §11.6, dual-role users): a "Sector (RM)" row only when features.coachipRm === true
  it.each([["absent", undefined], ["false", false]] as const)("coachipRm %s: no Sector (RM) row and zero /coachip/ requests", async (_n, rm) => {
    for (const mode of ["on", "off"] as const) {
      await renderMore(mode, rm);
      expect(screen.queryByTestId("more-row-rm")).toBeNull();
      expect(coachipCalls()).toEqual([]);
      cleanup();
    }
  });

  it("coachipRm true: the Sector (RM) row links to the RM home, labelled from COPY more.rm", async () => {
    await renderMore("on", true);
    const row = screen.getByTestId("more-row-rm");
    expect(row.getAttribute("href")).toBe("/portal/rm");
    expect(row.textContent).toContain("Sector (RM)");
    expect(coachipCalls()).toEqual([]);
  });
});
