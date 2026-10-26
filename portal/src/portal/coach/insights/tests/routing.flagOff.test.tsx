import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-sex15q.15 — B7/B8 goldens for the coach's way in (SPEC v2 §6; ruling 06:11Z on C12).
 *
 *   portal_coachip OFF (absent, false, /config failing): a v2 coach is still sent to the Training Library, the menu is
 *   still Training Library · Lesson Plans · More, homeFor() is unchanged, and no insight page is reachable.
 *   portal_coachip ON for a v2 coach: "This week" (S1) is home, the menu is This week · Schools · Listen · Stats · More.
 *
 * Network boundary only: `services/api` (the /config read) and the child-test switch.
 */

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../lib/useChildTestSa", () => ({ useChildTestSa: () => false }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));

import { portal } from "../../../services/api";
import { useAuth } from "../../../hooks/useAuth";
import { AuthContext } from "../../../hooks/authContext";
import CoachAppGuard from "../../training/CoachAppGuard";
import { COACH_APP_READY, coachPathReady, coachReadyHome } from "../../training/appReady";
import { homeFor } from "../../../lib/homeRoute";
import { resetCoachV2Memory } from "../../useCoachV2";
import { resetCoachipMemory } from "../useCoachip";
import PortalNavigation from "../../../components/PortalNavigation";

type Mode = "absent" | "false" | "fails" | "on";
const COACH = { id: "u-coach", role: "coach", phoneNumber: "+920000000001", firstName: "C" };

function setConfig(mode: Mode, coachV2 = true) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  const base = { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false, coachV2 };
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: base } as never);
  if (mode === "false") fn.mockResolvedValue({ success: true, features: { ...base, coachip: false } } as never);
  if (mode === "on") fn.mockResolvedValue({ success: true, features: { ...base, coachip: true } } as never);
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

async function landAt(path: string) {
  const shared = { user: COACH, loading: false } as never;
  render(
    <AuthContext.Provider value={shared}>
      <MemoryRouter initialEntries={[path]}>
        <CoachAppGuard>
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </CoachAppGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await settle();
  return screen.getByTestId("where").textContent;
}

beforeEach(() => {
  resetCoachV2Memory();
  resetCoachipMemory();
  vi.mocked(useAuth).mockReturnValue({ user: COACH, loading: false, logout: vi.fn() } as never);
});
afterEach(() => cleanup());

describe("flag OFF: nothing about the coach's way in changes", () => {
  it("the ready list and its home are as before", () => {
    expect([...COACH_APP_READY]).toEqual(["training", "lessons"]);
    expect(coachReadyHome()).toBe("/portal/coach/training");
    expect(coachPathReady("/portal/coach/insights")).toBe(false);
    expect(homeFor(COACH)).toBe("/portal/leader");
  });

  it.each(["absent", "false"] as Mode[])("config %s: a v2 coach is sent from /portal/leader to the Training Library", async (mode) => {
    setConfig(mode);
    expect(await landAt("/portal/leader")).toBe("/portal/coach/training");
  });

  it.each(["absent", "false"] as Mode[])("config %s: no insight page is reachable", async (mode) => {
    setConfig(mode);
    expect(await landAt("/portal/coach/insights")).toBe("/portal/coach/training");
    cleanup();
    expect(await landAt("/portal/coach/insights/listen")).toBe("/portal/coach/training");
  });

  it.each(["absent", "false"] as Mode[])("config %s: the menu is Training Library · Lesson Plans · More", async (mode) => {
    setConfig(mode);
    render(<MemoryRouter initialEntries={["/portal/coach/training"]}><PortalNavigation /></MemoryRouter>);
    await settle();
    const bar = screen.getByTestId("teacher-nav");
    expect(within(bar).getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["/portal/coach/training", "/portal/teacher/lessons", "/portal/coach/more"]);
    expect(screen.queryByTestId("insights-nav")).toBeNull();
  });

  it("config failing: v2 itself reads off, so the coach keeps today's pages and no insight menu", async () => {
    setConfig("fails");
    expect(await landAt("/portal/leader")).toBe("/portal/leader");
    cleanup();
    render(<MemoryRouter initialEntries={["/portal/leader"]}><PortalNavigation /></MemoryRouter>);
    await settle();
    expect(screen.queryByTestId("insights-nav")).toBeNull();
  });
});

describe("flag ON for a v2 coach", () => {
  it("This week is home: /portal/leader goes to /portal/coach/insights", async () => {
    setConfig("on");
    expect(await landAt("/portal/leader")).toBe("/portal/coach/insights");
  });

  it("the insight pages and the Training Library are both reachable", async () => {
    setConfig("on");
    expect(await landAt("/portal/coach/insights/listen")).toBe("/portal/coach/insights/listen");
    cleanup();
    expect(await landAt("/portal/coach/training")).toBe("/portal/coach/training");
  });

  it("a coach NOT on v2 is untouched even with the switch on", async () => {
    setConfig("on", false);
    expect(await landAt("/portal/leader")).toBe("/portal/leader");
  });

  it("the menu is This week · Schools · Listen · Stats · More", async () => {
    setConfig("on");
    render(<MemoryRouter initialEntries={["/portal/coach/insights"]}><PortalNavigation /></MemoryRouter>);
    await settle();
    const bar = screen.getByTestId("insights-nav");
    expect(within(bar).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/insights", "/portal/coach/insights/schools", "/portal/coach/insights/listen",
      "/portal/coach/insights/stats", "/portal/coach/more",
    ]);
    expect(within(bar).getAllByRole("link")[0].getAttribute("aria-current")).toBe("page");
  });
});
