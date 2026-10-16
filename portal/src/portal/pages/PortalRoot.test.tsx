import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2394: the Android app always cold-boots to "/" (the Capacitor WebView
// serves the bundle from https://localhost with no path). That route rendered
// PortalLogin unconditionally, so a teacher with a perfectly valid session was
// shown the login form after every force-close and believed they'd been logged
// out. The session was never the problem — the cookie survives the kill and
// /api/portal/dashboard returns 200; only the routing was wrong.
//
// The rule this locks in: "/" must decide from the SESSION, not from the URL.
//   - session still valid            -> land on the dashboard, no re-login
//   - leader session                 -> land on My Patch (bd-2434 parity)
//   - no session                     -> the login form, as before
//   - still checking                 -> neither; no login flash before we know

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { useAuth } from "../hooks/useAuth";
import PortalRoot from "./PortalRoot";

function renderWith(auth: { user: any; loading: boolean }) {
  (useAuth as any).mockReturnValue({
    user: auth.user,
    loading: auth.loading,
    login: vi.fn(),
    logout: vi.fn(),
  });
  render(
    <MemoryRouter>
      <PortalRoot />
    </MemoryRouter>
  );
}

describe("PortalRoot — '/' honours an existing session (bd-2394)", () => {
  beforeEach(() => navigateSpy.mockClear());

  it("sends an authenticated teacher to the dashboard instead of the login form", () => {
    renderWith({ user: { firstName: "Ayesha", role: "teacher" }, loading: false });
    expect(navigateSpy).toHaveBeenCalledWith("/portal/dashboard", { replace: true });
  });

  it("sends an authenticated leader to My Patch (bd-2434 parity)", () => {
    renderWith({ user: { firstName: "Haroon", role: "coach" }, loading: false });
    expect(navigateSpy).toHaveBeenCalledWith("/portal/leader", { replace: true });
  });

  it("shows the login form when there is no session", () => {
    renderWith({ user: null, loading: false });
    expect(navigateSpy).not.toHaveBeenCalled();
    // bd-x7aprz.3: the login form opens on the WhatsApp code.
    expect(screen.getByRole("button", { name: /send code/i })).toBeInTheDocument();
  });

  it("does not flash the login form while the session check is still in flight", () => {
    renderWith({ user: null, loading: true });
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /log in/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send code/i })).not.toBeInTheDocument();
  });
});
