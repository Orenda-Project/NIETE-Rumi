import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-s6qbts.3 — an analytics-only account lands on the schools analytics page from every way in: the sign-in form,
 * "/" (where the Android app cold-boots), an already-open session on /portal/login, and the password-reset login.
 * Teachers and leaders keep their homes (the PortalRoot / PortalLogin tests pin those too).
 */
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { user: null as unknown, loading: false, login: vi.fn(), logout: vi.fn() },
  api: { verifyResetCode: vi.fn(), resetPassword: vi.fn() },
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", async (orig) => ({
  ...(await orig<typeof import("../services/api")>()),
  auth: { verifyResetCode: h.api.verifyResetCode, resetPassword: h.api.resetPassword },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import PortalRoot from "../pages/PortalRoot";
import PortalLogin from "../pages/PortalLogin";
import PortalPasswordResetVerify from "../pages/PortalPasswordResetVerify";

const ANALYTICS = "/portal/analytics/schools";
const analyticsUser = { firstName: "FDE Islamabad", role: "unregistered", analyticsOnly: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth = { user: null, loading: false, login: vi.fn(), logout: vi.fn() };
});

describe("an analytics-only account's way in", () => {
  it("'/' with a live session goes to the analytics page", () => {
    h.auth.user = analyticsUser;
    render(<MemoryRouter><PortalRoot /></MemoryRouter>);
    expect(h.navigate).toHaveBeenCalledWith(ANALYTICS, { replace: true });
  });

  it("/portal/login with a live session goes to the analytics page", async () => {
    h.auth.user = analyticsUser;
    render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(ANALYTICS, { replace: true }));
  });

  it("signing in goes to the analytics page", async () => {
    h.auth.login = vi.fn().mockResolvedValue({ success: true, user: analyticsUser });
    const user = userEvent.setup();
    render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    await user.type(screen.getByLabelText("Phone number"), "0300 0000000");
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(ANALYTICS));
  });

  it("the password-reset login goes to the analytics page", async () => {
    h.api.verifyResetCode.mockResolvedValue({ success: true });
    h.api.resetPassword.mockResolvedValue({ success: true, user: analyticsUser });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: "/portal/reset-password/verify", state: { phoneNumber: "0300 0000000" } }]}>
        <PortalPasswordResetVerify />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("Code"), "482915");
    await user.type(screen.getByLabelText("New password"), "madeup123");
    await user.type(screen.getByLabelText("Confirm password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(ANALYTICS));
  });
});

describe("everyone else's way in is unchanged", () => {
  it("signing in: a teacher to the dashboard, a coach to My Patch", async () => {
    const user = userEvent.setup();
    h.auth.login = vi.fn().mockResolvedValue({ success: true, user: { role: "teacher", analyticsOnly: false } });
    const { unmount } = render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    await user.type(screen.getByLabelText("Phone number"), "0300 0000000");
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard"));
    unmount();

    h.navigate.mockClear();
    h.auth.login = vi.fn().mockResolvedValue({ success: true, user: { role: "coach" } });
    render(<MemoryRouter><PortalLogin /></MemoryRouter>);
    await user.type(screen.getByLabelText("Phone number"), "0300 0000000");
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/leader"));
  });

  it("the password-reset login: a principal to My Patch", async () => {
    h.api.verifyResetCode.mockResolvedValue({ success: true });
    h.api.resetPassword.mockResolvedValue({ success: true, user: { role: "principal" } });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: "/portal/reset-password/verify", state: { phoneNumber: "0300 0000000" } }]}>
        <PortalPasswordResetVerify />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("Code"), "482915");
    await user.type(screen.getByLabelText("New password"), "madeup123");
    await user.type(screen.getByLabelText("Confirm password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/leader"));
  });
});
