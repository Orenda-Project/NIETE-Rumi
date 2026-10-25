import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../newui/checks/rules";

/**
 * bd-fmf24g.64 — the login and its three sibling auth pages in the teacher-app look (v36_login-refresh).
 *
 * What these pin, page by page: one frame (band, card, legal footer) on all four; a language pill that is a DEVICE
 * choice (it never touches the account); Urdu right-to-left with the phone number left-to-right; every tap target at
 * least 56px; errors that sit under the field as an alert, map from the HTTP status, and stay until she types; no
 * toast anywhere. The handlers and API calls are the old ones (the existing login/session/legal/visibility tests
 * still pin those).
 *
 * bd-xxi78f: the login is the number and the password (the WhatsApp-code sign-in of bd-x7aprz.3 is gone). 403 / 404
 * never say "No password yet" / "No account found": they send her to set a password / to Register on WhatsApp
 * (./password-sign-in.test.tsx). An old set-up link signs her in or offers a new link (./setup-link.test.tsx).
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  login: vi.fn(),
  checkAuth: vi.fn(),
  api: {
    requestReset: vi.fn(),
    verifyResetCode: vi.fn(),
    resetPassword: vi.fn(),
    validateToken: vi.fn(),
    setup: vi.fn(),
    setupSignIn: vi.fn(),
    langGet: vi.fn(),
    langSet: vi.fn(),
  },
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: h.login, checkAuth: h.checkAuth, user: null, loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("../services/api", () => ({
  // This tier's bot number reaches the portal on /config (`bot`); a made-up one, built from parts.
  portal: { getConfig: vi.fn().mockResolvedValue({ success: true, features: {}, bot: ["92", "000", "0000001"].join("") }) },
  auth: {
    requestReset: h.api.requestReset,
    verifyResetCode: h.api.verifyResetCode,
    resetPassword: h.api.resetPassword,
    validateToken: h.api.validateToken,
    setup: h.api.setup,
    setupSignIn: h.api.setupSignIn,
  },
  language: { get: h.api.langGet, set: h.api.langSet },
}));

import PortalLogin from "../pages/PortalLogin";
import PortalPasswordReset from "../pages/PortalPasswordReset";
import PortalPasswordResetVerify from "../pages/PortalPasswordResetVerify";
import PortalSetup from "../pages/PortalSetup";

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};

const httpError = (status: number, error = "x") => Object.assign(new Error(error), { response: { status, data: { error } } });

beforeEach(async () => {
  vi.clearAllMocks();
  await setLang("en");
});
afterEach(async () => { await setLang("en"); });

const at = (ui: React.ReactElement, state?: unknown) =>
  render(<MemoryRouter initialEntries={[{ pathname: "/x", state }]}>{ui}</MemoryRouter>);

describe("one frame on every auth page", () => {
  it.each([
    ["login", () => at(<PortalLogin />)],
    ["forgot password", () => at(<PortalPasswordReset />)],
    ["enter code", () => at(<PortalPasswordResetVerify />, { phoneNumber: "0300 0000000" })],
  ])("%s: the band, the mark, the language pill and the legal footer", (_n, mount) => {
    mount();
    expect(document.querySelector('[data-frame="auth"]')).not.toBeNull();
    expect(screen.getByRole("img", { name: "NIETE Portal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByTestId("login-legal-footer")).toHaveTextContent("Privacy policy · Delete account");
  });

  it("an old set-up link that is dead: the same frame, once the link is checked", async () => {
    h.api.setupSignIn.mockRejectedValue(httpError(400));
    render(<MemoryRouter initialEntries={["/portal/setup/tok"]}><Routes><Route path="/portal/setup/:token" element={<PortalSetup />} /></Routes></MemoryRouter>);
    await screen.findByRole("heading", { name: "Link expired" });
    expect(document.querySelector('[data-frame="auth"]')).not.toBeNull();
    expect(screen.getByTestId("login-legal-footer")).toBeInTheDocument();
  });
});

describe("the language pill is a device choice", () => {
  it("names the language it switches TO, in its own script, and switches the page", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    const pill = screen.getByRole("button", { name: "Language" });
    expect(pill).toHaveTextContent("اردو");
    await user.click(pill);
    expect(i18n.language).toBe("ur");
    expect(screen.getByRole("heading", { name: "خوش آمدید" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "زبان" })).toHaveTextContent("English");
    await user.click(screen.getByRole("button", { name: "زبان" }));
    expect(i18n.language).toBe("en");
  });

  it("never reads or writes her account's language (she is not signed in)", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.click(screen.getByRole("button", { name: "Language" }));
    expect(h.api.langSet).not.toHaveBeenCalled();
    expect(h.api.langGet).not.toHaveBeenCalled();
  });
});

describe("Urdu: right-to-left, the number left-to-right", () => {
  it("the page is rtl, the labels are Urdu, the phone number input stays ltr", async () => {
    await setLang("ur");
    at(<PortalLogin />);
    const frame = document.querySelector('[data-frame="auth"]') as HTMLElement;
    expect(frame).toHaveAttribute("dir", "rtl");
    expect(frame).toHaveAttribute("lang", "ur");
    const phone = screen.getByLabelText("فون نمبر");
    expect(phone).toHaveAttribute("dir", "ltr");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(screen.getByLabelText("پاس ورڈ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "لاگ اِن" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ایڈمن لاگ اِن" })).toBeInTheDocument();
  });

  it("English is left-to-right", () => {
    at(<PortalLogin />);
    expect(document.querySelector('[data-frame="auth"]')).toHaveAttribute("dir", "ltr");
  });
});

describe("every tap target is at least 56px", () => {
  it.each(["en", "ur"] as const)("login, forgot, code and setup in %s", async (lang) => {
    await setLang(lang);
    const pages: Array<[string, () => ReturnType<typeof render>]> = [
      ["login", () => at(<PortalLogin />)],
      ["forgot", () => at(<PortalPasswordReset />)],
      ["code", () => at(<PortalPasswordResetVerify />, { phoneNumber: "0300 0000000" })],
    ];
    for (const [name, mount] of pages) {
      const { container, unmount } = mount();
      expect({ name, problems: tapProblems(container) }).toEqual({ name, problems: [] });
      unmount();
    }
    h.api.setupSignIn.mockRejectedValue(httpError(400));
    const { container } = render(<MemoryRouter initialEntries={["/portal/setup/tok"]}><Routes><Route path="/portal/setup/:token" element={<PortalSetup />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('[data-frame="auth"] a')).not.toBeNull());
    expect({ name: "setup", problems: tapProblems(container) }).toEqual({ name: "setup", problems: [] });
  });
});

describe("login: errors sit under the field, map from the status, and stay until she types", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, phone = "0300 0000000", pw = "madeup123") => {
    await user.type(screen.getByLabelText("Phone number"), phone);
    if (pw) await user.type(screen.getByLabelText("Password"), pw);
    await user.click(screen.getByRole("button", { name: "Log in" }));
  };

  it.each([
    [401, "Wrong password", "Password"],
    // 403 and 404 are not a field's message: password-sign-in.test.tsx (set a password / Register on WhatsApp).
    [400, "Check the number", "Phone number"],
  ])("status %i: '%s' under the %s field", async (status, label, field) => {
    h.login.mockResolvedValue({ success: false, status, error: "server sentence" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(label);
    expect(alert).not.toHaveTextContent("server sentence");
    expect(screen.getByLabelText(field)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(field)).toHaveAccessibleDescription(label);
  });

  it.each([
    [429, "Too many tries"],
    [0, "No connection"],
    [500, "Couldn't log in"],
    [200, "Couldn't log in"],
  ])("status %i is a plain message under the button: '%s'", async (status, label) => {
    h.login.mockResolvedValue({ success: false, status, error: "server sentence" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(label);
  });

  it("the message stays until she types in THAT field, and no toast ever opens", async () => {
    h.login.mockResolvedValue({ success: false, status: 401, error: "Incorrect password. Please try again." });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByRole("alert")).toBeInTheDocument(); // not a timed toast
    await user.type(screen.getByLabelText("Phone number"), "1"); // the OTHER field
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  // A no-password account is taken to Forgot password to set one — password-sign-in.test.tsx, "no password".

  it("the message is in her language", async () => {
    await setLang("ur");
    h.login.mockResolvedValue({ success: false, status: 401, error: "x" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("فون نمبر"), "0300 0000000");
    await user.type(screen.getByLabelText("پاس ورڈ"), "madeup123");
    await user.click(screen.getByRole("button", { name: "لاگ اِن" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("غلط پاس ورڈ");
  });

  it("a dropped digit is caught here: no call, 'Check the number' under the number", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user, "0300 000000");
    expect(h.login).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the number");
  });

  it("a missing password is caught here: no call, 'Enter password' under the password", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user, "0300 0000000", "");
    expect(h.login).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter password");
  });

  it("waiting is the button: 'Logging in', busy, not tappable twice", async () => {
    let resolve: (v: unknown) => void = () => {};
    h.login.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user);
    const busy = await screen.findByRole("button", { name: "Logging in" });
    expect(busy).toBeDisabled();
    expect(h.login).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ success: false, status: 401, error: "x" }); });
    expect(await screen.findByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("signing in goes straight on: no 'Welcome back' toast, no one-second wait", async () => {
    h.login.mockResolvedValue({ success: true, user: { role: "teacher" } });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard"));
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a leader goes to My Patch", async () => {
    h.login.mockResolvedValue({ success: true, user: { role: "coach" } });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await fill(user);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/leader"));
  });

  it("Forgot password carries the number she typed", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), "0300 0000000");
    await user.click(screen.getByRole("button", { name: "Forgot password" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/reset-password", { state: { phoneNumber: "0300 0000000" } });
  });

  it("says nothing about who the portal is for (no sentence, no example number)", () => {
    at(<PortalLogin />);
    expect(screen.queryByText(/teachers and coaches/i)).toBeNull();
    expect(screen.queryByText(/e\.g\./i)).toBeNull();
  });

  // bd-xxi78f: an account NAME no longer goes in this field; it signs in on its own page (Admin login,
  // password-sign-in.test.tsx; analytics-login.test.tsx).

  it("a setup link that died shows its reason on the login page, and keeps showing it", () => {
    at(<PortalLogin />, { notice: "linkExpired" });
    expect(screen.getByRole("alert")).toHaveTextContent("Link expired");
  });
});

describe("forgot password", () => {
  it("the number she typed on login is already there; Send code asks the same API", async () => {
    h.api.requestReset.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    at(<PortalPasswordReset />, { phoneNumber: "0300 0000000" });
    expect(screen.getByLabelText("Phone number")).toHaveValue("0300 0000000");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(h.api.requestReset).toHaveBeenCalledWith("0300 0000000"));
    expect(h.navigate).toHaveBeenCalledWith("/portal/reset-password/verify", { state: { phoneNumber: "0300 0000000" } });
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("not registered (404): the way to register, never 'No account found'", async () => {
    h.api.requestReset.mockRejectedValue(httpError(404));
    const user = userEvent.setup();
    at(<PortalPasswordReset />, { phoneNumber: "0300 0000000" });
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not registered yet");
    expect(screen.getByRole("link", { name: "Register on WhatsApp" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/No account found/);
  });

  it("an empty or short number never reaches the API", async () => {
    const user = userEvent.setup();
    at(<PortalPasswordReset />);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the number");
    expect(h.api.requestReset).not.toHaveBeenCalled();
  });

  it("Back goes to the login", async () => {
    const user = userEvent.setup();
    at(<PortalPasswordReset />);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/login");
  });
});

describe("enter code", () => {
  const mount = () => at(<PortalPasswordResetVerify />, { phoneNumber: "0300 0000000" });

  it("opened without a number it goes back to forgot password", () => {
    function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
    render(<MemoryRouter initialEntries={["/portal/reset-password/verify"]}><Routes>
      <Route path="/portal/reset-password/verify" element={<PortalPasswordResetVerify />} />
      <Route path="/portal/reset-password" element={<Where />} />
    </Routes></MemoryRouter>);
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/reset-password");
  });

  it("shows where the code went as plain information, the number left-to-right", () => {
    mount();
    expect(screen.getByText("0300 0000000")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("Sent on WhatsApp")).toBeInTheDocument();
  });

  it("the code is one input drawn as six slots: digits only, six at most, one-time-code autofill", async () => {
    const user = userEvent.setup();
    mount();
    const code = screen.getByLabelText("Code");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    await user.type(code, "48a29x15999");
    expect(code).toHaveValue("482915");
    expect(document.querySelectorAll("[data-slot]")).toHaveLength(6);
    expect(document.querySelectorAll('[data-slot="filled"]')).toHaveLength(6);
  });

  const typeAll = async (user: ReturnType<typeof userEvent.setup>, code = "482915", a = "madeup123", b = "madeup123") => {
    await user.type(screen.getByLabelText("Code"), code);
    await user.type(screen.getByLabelText("New password"), a);
    await user.type(screen.getByLabelText("Confirm password"), b);
    await user.click(screen.getByRole("button", { name: "Reset password" }));
  };

  it("two different passwords: 'Passwords differ' under the second, no call", async () => {
    const user = userEvent.setup();
    mount();
    await typeAll(user, "482915", "madeup123", "madeup124");
    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords differ");
    expect(h.api.verifyResetCode).not.toHaveBeenCalled();
  });

  it("a short code: '6 digits needed' under the code, no call", async () => {
    const user = userEvent.setup();
    mount();
    await typeAll(user, "4829");
    expect(await screen.findByRole("alert")).toHaveTextContent("6 digits needed");
    expect(h.api.verifyResetCode).not.toHaveBeenCalled();
  });

  it("a short password: 'Too short' under the password", async () => {
    const user = userEvent.setup();
    mount();
    await typeAll(user, "482915", "abc12", "abc12");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too short");
  });

  it("the same two calls as before, then straight in", async () => {
    h.api.verifyResetCode.mockResolvedValue({ success: true });
    h.api.resetPassword.mockResolvedValue({ success: true, user: { role: "teacher" } });
    const user = userEvent.setup();
    mount();
    await typeAll(user);
    await waitFor(() => expect(h.api.resetPassword).toHaveBeenCalledWith("madeup123"));
    expect(h.api.verifyResetCode).toHaveBeenCalledWith("0300 0000000", "482915");
    expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard");
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a wrong code: 'Wrong code' under the code, and it stays until she types", async () => {
    h.api.verifyResetCode.mockRejectedValue(httpError(400));
    const user = userEvent.setup();
    mount();
    await typeAll(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code");
    await user.type(screen.getByLabelText("New password"), "z");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Code"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("one eye shows both passwords", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("type", "text");
  });
});

// bd-x7aprz.3: the set-password page is gone. An old /portal/setup/<token> link signs her in, or (dead) offers a new
// link from WhatsApp; the full behaviour is in code-sign-in.test.tsx. What stays pinned here: no toast, either way.
describe("an old set-up link", () => {
  const open = () => render(<MemoryRouter initialEntries={["/portal/setup/tok-123"]}><Routes><Route path="/portal/setup/:token" element={<PortalSetup />} /></Routes></MemoryRouter>);

  it("a live link: straight to her home, no password asked, never a toast", async () => {
    h.api.setupSignIn.mockResolvedValue({ success: true, user: { role: "teacher" } });
    open();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard", { replace: true }));
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a dead link says so on its own page (no password form), never a toast", async () => {
    h.api.setupSignIn.mockRejectedValue(httpError(400, "This link has expired."));
    open();
    expect(await screen.findByRole("heading", { name: "Link expired" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });
});

describe("the page frame inside a card reads as one list", () => {
  it("the Forgot password link is a real button, not information", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    const forgot = screen.getByRole("button", { name: "Forgot password" });
    expect(within(forgot).queryByRole("img")).toBeNull();
  });
});
