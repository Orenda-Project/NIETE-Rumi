import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-o15qnr / bd-4404s7.2 — a coach with portal_coach_v2 gets the kit's role-aware
 * menu: Home · Schedule · Observe · Schools · More (the teacher bar, the coach's
 * items). Training and My account sit on More. v2 wins over portal_new_ui.
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

function bar() {
  return screen.getByTestId("teacher-nav");
}

describe("coach v2 menu (the kit's role-aware bar)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Home · Schedule · Observe · Schools · More", async () => {
    await renderNav("/portal/coach", { coachV2: true });
    const links = within(bar()).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Home", "/portal/coach"],
      ["Schedule", "/portal/coach/scheduling"],
      ["Observe", "/portal/coach/observe"],
      ["Schools", "/portal/coach/people"],
      ["More", "/portal/coach/more"],
    ]);
    expect(screen.queryByTestId("mobile-nav-more")).toBeNull();
  });

  it("the current feature is the current item, on every page inside it", async () => {
    await renderNav("/portal/coach/observe/pick", { coachV2: true });
    expect(within(bar()).getByRole("link", { name: "Observe" })).toHaveAttribute("aria-current", "page");
    expect(within(bar()).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("More stays current on My profile", async () => {
    await renderNav("/portal/coach/profile", { coachV2: true });
    expect(within(bar()).getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  it("v2 wins over the new UI for a coach: the kit bar, not the indigo one", async () => {
    await renderNav("/portal/coach", { coachV2: true, newUi: true });
    expect(within(bar()).getByRole("link", { name: "Observe" })).toBeInTheDocument();
    expect(bar().className).toContain("bg-white");
  });
});
