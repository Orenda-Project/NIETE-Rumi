/**
 * bd-3wb0s — "My account": one page for who you are and what you can do about
 * your account (operator, 2026-10-03).
 *
 * Google Play wants the privacy policy and an account-deletion path findable
 * inside the app. The first cut put both straight into the navigation; the
 * operator wanted them gathered on a page of their own, reached from the nav,
 * showing her own name and school — and NOT her phone number or her role.
 *
 * Mounted through the app's REAL route table (App.tsx) with the session API
 * answered at the client boundary, so these see what a user sees: the route,
 * the login redirect for a signed-out visitor, the layout, the logout flow and
 * the hop to the public deletion page and back.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "@/App";
import { portal, auth } from "../services/api";

beforeAll(() => {
  // jsdom has no matchMedia; the app shell's toaster reads it on mount.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

const PRIVACY_URL = "https://taleemabad.com/privacy-policy/";
const PHONE = "923001234567";

type DashboardUser = { firstName: string; lastName?: string | null; phoneNumber?: string; role?: string | null; schoolName?: string | null };

function signedInAs(user: DashboardUser) {
  vi.spyOn(portal, "getDashboard").mockResolvedValue(
    { success: true, user, stats: {} } as unknown as Awaited<ReturnType<typeof portal.getDashboard>>,
  );
}

function renderAppAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

/** The page body, so the navigation around it cannot satisfy a query. */
async function accountPage() {
  return screen.findByTestId("account-page");
}

beforeEach(() => {
  vi.spyOn(portal, "getConfig").mockResolvedValue({ features: {} } as unknown as Awaited<ReturnType<typeof portal.getConfig>>);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("bd-3wb0s — /portal/account is for signed-in users", () => {
  it("sends a signed-out visitor to the login screen", async () => {
    vi.spyOn(portal, "getDashboard").mockRejectedValue(
      Object.assign(new Error("unauthorised"), { response: { status: 401 } }),
    );
    renderAppAt("/portal/account");
    await waitFor(() => expect(window.location.pathname).toBe("/portal/login"));
  });

  it("is titled 'My account'", async () => {
    signedInAs({ firstName: "Ayesha Khan", role: "teacher", phoneNumber: PHONE, schoolName: "IMSG G-7/2" });
    renderAppAt("/portal/account");
    // The skeleton carries the same title, so ask the LOADED page for it.
    const page = await accountPage();
    expect(within(page).getByRole("heading", { level: 1, name: "My account" })).toBeInTheDocument();
  });

  it.each(["teacher", "coach", "aeo", "supervisor", "principal", "school_leader"])(
    "works for a %s",
    async (role) => {
      signedInAs({ firstName: "Noor Fatima", role, phoneNumber: PHONE, schoolName: "IMSG G-7/2" });
      renderAppAt("/portal/account");
      const page = await accountPage();
      expect(within(page).getByTestId("account-name")).toHaveTextContent("Noor Fatima");
    },
  );

  it("holds the layout with a skeleton while the user loads", async () => {
    vi.spyOn(portal, "getDashboard").mockReturnValue(new Promise(() => {}) as never);
    renderAppAt("/portal/account");
    expect(await screen.findByTestId("account-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("account-name")).toBeNull();
  });
});

describe("bd-3wb0s — who she is: name and school, nothing else", () => {
  it("shows her name and her school", async () => {
    signedInAs({ firstName: "Ayesha Khan", role: "teacher", phoneNumber: PHONE, schoolName: "IMSG G-7/2" });
    renderAppAt("/portal/account");
    const page = await accountPage();
    expect(within(page).getByTestId("account-name")).toHaveTextContent("Ayesha Khan");
    expect(within(page).getByTestId("account-school")).toHaveTextContent("IMSG G-7/2");
  });

  it("does not show her phone number or her role", async () => {
    signedInAs({ firstName: "Ayesha Khan", role: "principal", phoneNumber: PHONE, schoolName: "IMSG G-7/2" });
    renderAppAt("/portal/account");
    const page = await accountPage();
    expect(page).not.toHaveTextContent(/3001234567/);
    expect(page).not.toHaveTextContent(/\b(teacher|principal|coach|aeo|supervisor|school leader)\b/i);
  });

  it("puts her initials in the avatar: first and last name", async () => {
    signedInAs({ firstName: "Ayesha Khan", role: "teacher", schoolName: "IMSG G-7/2" });
    renderAppAt("/portal/account");
    const page = await accountPage();
    expect(within(page).getByTestId("account-avatar")).toHaveTextContent(/^AK$/);
  });

  it("uses one letter for a single name", async () => {
    signedInAs({ firstName: "noor", role: "coach", schoolName: null });
    renderAppAt("/portal/account");
    const page = await accountPage();
    expect(within(page).getByTestId("account-avatar")).toHaveTextContent(/^N$/);
  });

  it.each([null, undefined, "", "   "])("renders an unknown school (%s) as nothing at all", async (schoolName) => {
    signedInAs({ firstName: "Noor Fatima", role: "coach", schoolName: schoolName as string | null | undefined });
    renderAppAt("/portal/account");
    const page = await accountPage();
    expect(within(page).queryByTestId("account-school")).toBeNull();
    const header = within(page).getByTestId("account-header");
    expect(header).not.toHaveTextContent(/undefined|null|—|N\/A/);
  });
});

describe("bd-3wb0s — what she can do", () => {
  beforeEach(() => signedInAs({ firstName: "Ayesha Khan", role: "teacher", phoneNumber: PHONE, schoolName: "IMSG G-7/2" }));

  it("opens the privacy policy on taleemabad.com, outside the app", async () => {
    renderAppAt("/portal/account");
    const page = await accountPage();
    const link = within(page).getByRole("link", { name: /privacy policy/i });
    expect(link).toHaveAttribute("href", PRIVACY_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("takes 'Delete my account' to the deletion page, and Back returns to My account", async () => {
    renderAppAt("/portal/account");
    const page = await accountPage();
    const link = within(page).getByRole("link", { name: /delete my account/i });
    expect(link).toHaveAttribute("href", "/portal/delete-account");
    expect(link).not.toHaveAttribute("target");

    const user = userEvent.setup();
    await user.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Delete your NIETE account" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/portal/delete-account");

    await user.click(screen.getByRole("link", { name: /back to the niete portal/i }));
    await waitFor(() => expect(window.location.pathname).toBe("/portal/account"));
    const back = await accountPage();
    expect(within(back).getByRole("heading", { level: 1, name: "My account" })).toBeInTheDocument();
  });

  it("logs her out from the button at the bottom", async () => {
    const logout = vi.spyOn(auth, "logout").mockResolvedValue({ success: true } as never);
    renderAppAt("/portal/account");
    const page = await accountPage();
    // From here the server says "no session" — what the login screen will ask.
    vi.spyOn(portal, "getDashboard").mockRejectedValue(
      Object.assign(new Error("unauthorised"), { response: { status: 401 } }),
    );
    await userEvent.setup().click(within(page).getByRole("button", { name: /log ?out/i }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.pathname).toBe("/portal/login"));
  });
});
