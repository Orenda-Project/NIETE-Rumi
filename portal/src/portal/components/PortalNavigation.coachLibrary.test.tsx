import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-s42dye.2 — a coach on the coach app v2 sees ONLY the Training Library (and More, where her language, profile
 * and Log out are). Home, Schedule, Observe, Schools, Reports, Analytics and People are not in her menu.
 * bd-4joiqz — and Lesson Plans: the teacher Lesson Plans pages, read as a leader.
 */
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";
import { resetNewUiMemory } from "../lib/useNewUi";
import { resetCoachV2Memory } from "../coach/useCoachV2";

const user = (role: string) => ({ id: "u-1", firstName: "Hataf", role, phoneNumber: "923001234567" });

async function renderNav(role: string, features: Record<string, unknown>) {
  resetNewUiMemory();
  resetCoachV2Memory();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user: user(role), loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  render(<MemoryRouter initialEntries={["/portal/coach/training"]}><PortalNavigation /></MemoryRouter>);
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => vi.clearAllMocks());

describe("the coach v2 menu, as shipped", () => {
  it("is Training Library, Lesson Plans and More, nothing else", async () => {
    await renderNav("coach", { coachV2: true });
    const links = within(screen.getByTestId("teacher-nav")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Training Library", "/portal/coach/training"], ["Lesson Plans", "/portal/teacher/lessons"], ["More", "/portal/coach/more"]]);
    for (const w of ["Home", "Schedule", "Observe", "Schools", "Reports", "Analytics", "People", "Team"]) expect(screen.queryByText(w)).toBeNull();
  });

  it("a coach with the flag off keeps today's menu (no v2 bar)", async () => {
    await renderNav("coach", { coachV2: false });
    expect(screen.queryByTestId("teacher-nav")).toBeNull();
    expect(screen.queryByText("Training Library")).toBeNull();
    expect(screen.getAllByText("Training").length).toBeGreaterThan(0);
  });

  it("a principal with the flag on keeps today's leader menu", async () => {
    await renderNav("principal", { coachV2: true });
    expect(screen.queryByTestId("teacher-nav")).toBeNull();
    expect(screen.queryByText("Training Library")).toBeNull();
    expect(screen.getAllByText("Training").length).toBeGreaterThan(0);
  });
});
