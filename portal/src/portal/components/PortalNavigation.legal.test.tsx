import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-3wb0s — Google Play's User Data policy wants the privacy policy linked
 * INSIDE the app, and an in-app path to account deletion that a user can find
 * (account settings or a menu). The portal has no settings screen, so the menu
 * is the place: the mobile "Other" sheet, right above Logout, and the desktop
 * header next to Logout.
 *
 * Every role gets both. Deletion is not a teacher-only right, and the leader
 * family has a different nav array — a link added to one array only would
 * silently leave every coach without it (the same shape as bd-60160's missing
 * Training entry).
 *
 * The privacy policy is Taleemabad's (operator decision): an EXTERNAL page,
 * opened outside the app. The app's allowNavigation only covers the portal
 * host, so Capacitor hands any other host to the system browser.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

const PRIVACY_URL = "https://taleemabad.com/privacy-policy/";
const DELETE_PATH = "/portal/delete-account";
const ROLES = ["teacher", "coach", "aeo", "supervisor", "principal", "school_leader"];

function renderNav(role: string) {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Noor", role },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter>
      <PortalNavigation />
    </MemoryRouter>,
  );
}

function expectPrivacyLink(el: HTMLElement) {
  expect(el).toHaveAttribute("href", PRIVACY_URL);
  expect(el).toHaveAttribute("target", "_blank");
  expect(el).toHaveAttribute("rel", "noopener noreferrer");
}

/** Opens the mobile Other sheet and returns it. */
async function openOtherSheet() {
  await userEvent.setup().click(screen.getByTestId("mobile-nav-more"));
  return screen.findByRole("dialog");
}

describe("bd-3wb0s — privacy policy and account deletion in the Other sheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ROLES)("gives a %s both links in the Other sheet", async (role) => {
    renderNav(role);
    const sheet = await openOtherSheet();
    expectPrivacyLink(within(sheet).getByRole("link", { name: "Privacy policy" }));
    expect(within(sheet).getByRole("link", { name: "Delete my account" })).toHaveAttribute("href", DELETE_PATH);
  });

  it("puts both links above Logout", async () => {
    renderNav("teacher");
    const sheet = await openOtherSheet();
    const logout = within(sheet).getByTestId("mobile-nav-logout");
    for (const name of ["Privacy policy", "Delete my account"]) {
      const link = within(sheet).getByRole("link", { name });
      // DOCUMENT_POSITION_FOLLOWING: Logout comes after the link.
      expect(link.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("bd-3wb0s — privacy policy and account deletion in the desktop header", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ROLES)("gives a %s both links next to Logout", (role) => {
    renderNav(role);
    // The sheet is closed, so these are the desktop header's own links.
    const header = screen.getByTestId("desktop-nav-account");
    expect(within(header).getByRole("button", { name: /logout/i })).toBeInTheDocument();
    expectPrivacyLink(within(header).getByRole("link", { name: "Privacy policy" }));
    expect(within(header).getByRole("link", { name: "Delete my account" })).toHaveAttribute("href", DELETE_PATH);
  });
});
