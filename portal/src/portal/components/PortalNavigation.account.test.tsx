import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-3wb0s — where "My account" lives in the navigation.
 *
 * Google Play wants the privacy policy and an account-deletion path findable
 * in the app. The first cut put "Privacy policy" and "Delete my account"
 * straight into the nav (the Other sheet and the desktop header). The operator
 * moved them onto a My account page (2026-10-03), so the nav now carries ONE
 * way in:
 *
 *   - mobile: a single "My account" row in the Other sheet, right above Logout;
 *   - desktop: the signed-in name in the header is itself the link.
 *
 * Every role gets it. The leader family has its own nav array, and an entry
 * added to one array only would leave every coach without it (the shape of
 * bd-60160's missing Training entry).
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

const ROLES = ["teacher", "coach", "aeo", "supervisor", "principal", "school_leader"];

function renderNav(role: string, firstName = "Noor") {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName, role },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter>
      <PortalNavigation />
    </MemoryRouter>,
  );
}

/** Opens the mobile Other sheet and returns it. */
async function openOtherSheet() {
  await userEvent.setup().click(screen.getByTestId("mobile-nav-more"));
  return screen.findByRole("dialog");
}

describe("bd-3wb0s — the Other sheet has one way into My account", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ROLES)("gives a %s exactly one 'My account' row, to /portal/account", async (role) => {
    renderNav(role);
    const sheet = await openOtherSheet();
    const rows = within(sheet).getAllByRole("link", { name: "My account" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/portal/account");
  });

  it.each(ROLES)("no longer lists privacy or deletion directly for a %s", async (role) => {
    renderNav(role);
    const sheet = await openOtherSheet();
    expect(within(sheet).queryByRole("link", { name: /privacy policy/i })).toBeNull();
    expect(within(sheet).queryByRole("link", { name: /delete my account/i })).toBeNull();
    expect(within(sheet).queryByTestId("mobile-nav-privacy")).toBeNull();
    expect(within(sheet).queryByTestId("mobile-nav-delete-account")).toBeNull();
  });

  it("puts 'My account' right above Logout, and keeps Logout in the sheet", async () => {
    renderNav("teacher");
    const sheet = await openOtherSheet();
    const logout = within(sheet).getByTestId("mobile-nav-logout");
    const account = within(sheet).getByRole("link", { name: "My account" });
    expect(logout.previousElementSibling).toBe(account);
  });
});

describe("bd-3wb0s — the desktop header: the name IS the link", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ROLES)("makes a %s's name a link to /portal/account named 'My account'", (role) => {
    renderNav(role, "Ayesha");
    // Sheet closed: the only links rendered are the desktop rail and the mobile bar.
    const links = screen.getAllByRole("link", { name: "My account" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/portal/account");
    expect(links[0]).toHaveTextContent("Ayesha");
    expect(links[0].className).toMatch(/hover:/);
  });

  it("drops the separate privacy and deletion links from the header", () => {
    renderNav("principal");
    expect(screen.queryByRole("link", { name: /privacy policy/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /delete my account/i })).toBeNull();
  });

  it("keeps Logout where it was, next to the name", () => {
    renderNav("teacher", "Ayesha");
    const nameLink = screen.getByRole("link", { name: "My account" });
    const logout = screen.getByRole("button", { name: /logout/i });
    expect(nameLink.parentElement).toBe(logout.parentElement);
  });
});
