import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2569: /portal/login must not show a login form to someone who is already
// signed in.
//
// The session was never the problem. The cookie is persistent (7-day Max-Age,
// Secure, httpOnly) and MainActivity.onPause() flushes the WebView cookie jar
// to disk, so it survives a force-close. What broke is WHERE the app lands:
// the OTA build boots straight to /portal/login (that path is compiled into
// the APK), which bypasses "/" — the one route that reads the session and
// forwards an authenticated user onward (see PortalRoot.tsx).
//
// Result: a teacher with a perfectly valid session got the login form on every
// cold start and believed the app had logged them out.
//
// Fixing the OTA url instead would need a Play release AND would leave this
// hole open for anyone who reaches /portal/login by any other route. The page
// itself is the right place for the check, and it ships over OTA.

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useAuth } from "../hooks/useAuth";
import PortalLogin from "./PortalLogin";

function renderLogin(auth: any) {
  (useAuth as any).mockReturnValue({ login: vi.fn(), ...auth });
  render(
    <MemoryRouter>
      <PortalLogin />
    </MemoryRouter>,
  );
}

describe("PortalLogin — an existing session skips the form (bd-2569)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards an already-authenticated teacher to the dashboard", async () => {
    renderLogin({ user: { firstName: "Ayesha", role: "teacher" }, loading: false });
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith("/portal/dashboard", { replace: true }),
    );
  });

  it("forwards an already-authenticated leader to My Patch", async () => {
    // Same rule as PortalRoot: leaders belong on /portal/leader, not the
    // teacher dashboard.
    renderLogin({ user: { firstName: "Noor", role: "coach" }, loading: false });
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith("/portal/leader", { replace: true }),
    );
  });

  it("does NOT show the login form to an authenticated user", async () => {
    // The visible half of the bug: the form appearing at all is what made a
    // teacher think they had been logged out.
    renderLogin({ user: { firstName: "Ayesha", role: "teacher" }, loading: false });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(screen.queryByText("Log In")).toBeNull();
  });

  it("shows nothing while the session is still resolving", async () => {
    // Flashing the form and then yanking it away looks worse than the bug.
    // PortalRoot renders null in this window; do the same here.
    renderLogin({ user: null, loading: true });
    expect(screen.queryByText("Log In")).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("shows the login form when there is genuinely no session", async () => {
    // The ordinary case must be untouched — this is still the login page.
    renderLogin({ user: null, loading: false });
    await waitFor(() => expect(screen.getByText("Log In")).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
