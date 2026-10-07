import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-o15qnr — a coach with portal_coach_v2 gets the v2 menu, in the LIVE look
 * (white bottom bar, green active item): Home · Schedule · Observe · Schools ·
 * Other. Training (bd-60160: coaches must keep reaching it) and My account sit
 * in Other. v2 wins over portal_new_ui for a coach.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";
import { resetNewUiMemory } from "../lib/useNewUi";
import { resetCoachV2Memory } from "../coach/useCoachV2";

const COACH = { id: "c-1", firstName: "Hataf", role: "coach", phoneNumber: "923001234567" };

async function renderNav(path: string, features: Record<string, unknown>) {
  resetNewUiMemory();
  resetCoachV2Memory();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user: COACH, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter initialEntries={[path]}>
      <PortalNavigation />
    </MemoryRouter>,
  );
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

function mobileBar() {
  return screen.getByTestId("mobile-nav-more").closest("nav") as HTMLElement;
}

describe("coach v2 menu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Home · Schedule · Observe · Schools, then Other", async () => {
    await renderNav("/portal/coach", { coachV2: true });
    const bar = within(mobileBar());
    const links = bar.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Home", "/portal/coach"],
      ["Schedule", "/portal/coach/scheduling"],
      ["Observe", "/portal/coach/observe"],
      ["Schools", "/portal/coach/people"],
    ]);
    expect(bar.getByRole("button", { name: "Other" })).toBeInTheDocument();
  });

  it("the current feature is the active (green) item", async () => {
    await renderNav("/portal/coach/observe/pick", { coachV2: true });
    const observe = within(mobileBar()).getByRole("link", { name: "Observe" });
    expect(observe.className).toContain("text-accent");
    expect(within(mobileBar()).getByRole("link", { name: "Home" }).className).not.toContain("text-accent");
  });

  it("Other holds Training, My account and Logout", async () => {
    await renderNav("/portal/coach", { coachV2: true });
    await userEvent.setup().click(screen.getByTestId("mobile-nav-more"));
    const sheet = within(await screen.findByRole("dialog"));
    expect(sheet.getByRole("link", { name: "Training" })).toHaveAttribute("href", "/portal/training");
    expect(sheet.getByRole("link", { name: /My account/ })).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "Logout" })).toBeInTheDocument();
  });

  it("v2 wins over the new UI for a coach: the live-look menu, not the indigo bar", async () => {
    await renderNav("/portal/coach", { coachV2: true, newUi: true });
    expect(within(mobileBar()).getByRole("link", { name: "Observe" })).toBeInTheDocument();
    expect(mobileBar().className).toContain("bg-white");
  });
});
