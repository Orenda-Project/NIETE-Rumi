import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../newui/checks/rules";

/**
 * bd-x7aprz.3 — the portal signs her in with a code on her WhatsApp; a password is optional; nothing ever says
 * "No account found" or "No password yet".
 *
 *   Login         number → Send code → the 6-digit code → in, to her home. "Use password instead" keeps the password
 *                 sign-in (and Forgot password) for the 5,762 who have one. A number that is not registered gets a
 *                 "Register on WhatsApp" button to the bot with /register typed.
 *   Set-up link   an old /portal/setup/<token> link signs her in; a dead one says so and offers a new link from
 *                 WhatsApp (/portal typed). There is no set-password form any more.
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  checkAuth: vi.fn(),
  api: {
    requestCode: vi.fn(),
    verifyCode: vi.fn(),
    setupSignIn: vi.fn(),
    requestReset: vi.fn(),
  },
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: h.login, checkAuth: h.checkAuth, user: null, loading: false }),
}));
vi.mock("../services/api", () => ({
  auth: {
    requestCode: h.api.requestCode,
    verifyCode: h.api.verifyCode,
    setupSignIn: h.api.setupSignIn,
    requestReset: h.api.requestReset,
  },
  language: { get: vi.fn(), set: vi.fn() },
}));

import PortalLogin from "../pages/PortalLogin";
import PortalSetup from "../pages/PortalSetup";
import PortalPasswordReset from "../pages/PortalPasswordReset";

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};
const httpError = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error("x"), { response: { status, data: { error: "server sentence", ...data } } });

beforeEach(async () => {
  vi.clearAllMocks();
  h.checkAuth.mockResolvedValue(undefined);
  await setLang("en");
});
afterEach(async () => { await setLang("en"); });

const at = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
// Digits built from parts: the public repo holds no phone-shaped literal (tests/setup/phone-shaped-fixtures).
const NUM = ["03", "000", "000", "001"].join("");
const BOT = ["92", "302", "0000255"].join("");
const BANNED = /No account found|No password yet/;

describe("login by a code on WhatsApp", () => {
  it("opens on the number and Send code: no password field, a way to use one instead", () => {
    at(<PortalLogin />);
    expect(screen.getByLabelText("Phone number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send code" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use password instead" })).toBeInTheDocument();
  });

  it("number → code → in: the two calls, then her home", async () => {
    h.api.requestCode.mockResolvedValue({ success: true });
    h.api.verifyCode.mockResolvedValue({ success: true, user: { firstName: "Ayesha", role: "teacher" } });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), "0300 0000001");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(h.api.requestCode).toHaveBeenCalledWith("0300 0000001");
    expect(await screen.findByText("Sent on WhatsApp")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(h.api.verifyCode).toHaveBeenCalledWith("0300 0000001", "123456");
    expect(h.checkAuth).toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard");
  });

  it("a leader goes to My Patch", async () => {
    h.api.requestCode.mockResolvedValue({ success: true });
    h.api.verifyCode.mockResolvedValue({ success: true, user: { firstName: "Sana", role: "principal" } });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/leader");
  });

  it("a code sent under a minute ago: straight to the code step (that code still works)", async () => {
    h.api.requestCode.mockRejectedValue(httpError(429, { code: "CODE_ALREADY_SENT" }));
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
  });

  it("a wrong code: 'Wrong code' under the code, nobody signed in", async () => {
    h.api.requestCode.mockResolvedValue({ success: true });
    h.api.verifyCode.mockRejectedValue(httpError(400));
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Code"), "654321");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("a short code is caught here: '6 digits needed', no call", async () => {
    h.api.requestCode.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Code"), "123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("6 digits needed");
    expect(h.api.verifyCode).not.toHaveBeenCalled();
  });

  it("a dropped digit is caught before any call", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), "0300 000000");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the number");
    expect(h.api.requestCode).not.toHaveBeenCalled();
  });

  it("a number that is not registered: a Register on WhatsApp button to the bot with /register typed — never 'No account found'", async () => {
    h.api.requestCode.mockRejectedValue(httpError(404, { code: "REGISTER_ON_WHATSAPP", whatsapp: `https://wa.me/${BOT}?text=%2Fregister` }));
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("Not registered yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register on WhatsApp" })).toHaveAttribute("href", `https://wa.me/${BOT}?text=%2Fregister`);
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("with no number from the server, the button opens the portal's own WhatsApp number", async () => {
    h.api.requestCode.mockRejectedValue(httpError(404, { code: "REGISTER_ON_WHATSAPP" }));
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    const link = await screen.findByRole("link", { name: "Register on WhatsApp" });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\d+\?text=%2Fregister$/);
  });

  it("every tap target on the code step is at least 56px", async () => {
    h.api.requestCode.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { container } = at(<PortalLogin />);
    expect(tapProblems(container)).toEqual([]);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    expect(tapProblems(container)).toEqual([]);
  });
});

describe("login by password is the second choice", () => {
  const passwordMode = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Use password instead" }));
  };

  it("shows the password, Log in and Forgot password; a code is one tap back", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await passwordMode(user);
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forgot password" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use a code instead" }));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("no password on her account: back to the code, with 'Log in by code' — never 'No password yet'", async () => {
    h.login.mockResolvedValue({ success: false, status: 403, error: "server sentence" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await passwordMode(user);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Log in by code");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send code" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("not registered (404): the Register on WhatsApp button", async () => {
    h.login.mockResolvedValue({ success: false, status: 404, error: "server sentence" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await passwordMode(user);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("link", { name: "Register on WhatsApp" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});

describe("Forgot password for a number that is not registered", () => {
  it("offers Register on WhatsApp, not 'No account found'", async () => {
    h.api.requestReset.mockRejectedValue(httpError(404, { code: "REGISTER_ON_WHATSAPP" }));
    const user = userEvent.setup();
    at(<PortalPasswordReset />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("link", { name: "Register on WhatsApp" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});

describe("an old set-up link (/portal/setup/<token>)", () => {
  // A made-up link id, in the uuid shape the server checks (built from parts so no scanner reads it as a secret).
  const LINK_ID = ["0b6b8f9e", "1c2d", "4e5f", "8a9b", "0c1d2e3f4a5b"].join("-");
  const open = (id = LINK_ID) =>
    render(
      <MemoryRouter initialEntries={[`/portal/setup/${id}`]}>
        <Routes><Route path="/portal/setup/:token" element={<PortalSetup />} /></Routes>
      </MemoryRouter>,
    );

  it("a live link signs her in and lands on her home — no password to set", async () => {
    h.api.setupSignIn.mockResolvedValue({ success: true, user: { firstName: "Ayesha", role: "teacher" } });
    open();
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard", { replace: true }));
    expect(h.api.setupSignIn).toHaveBeenCalledWith(LINK_ID);
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("a dead link: 'Link expired', a button for a new link from WhatsApp (/portal typed), and Log in", async () => {
    h.api.setupSignIn.mockRejectedValue(httpError(400, { code: "LINK_EXPIRED", whatsapp: `https://wa.me/${BOT}?text=%2Fportal` }));
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole("heading", { name: "Link expired" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a new link" })).toHaveAttribute("href", `https://wa.me/${BOT}?text=%2Fportal`);
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/login");
  });

  it("Urdu: the dead-link page is in Urdu, right-to-left", async () => {
    await setLang("ur");
    h.api.setupSignIn.mockRejectedValue(httpError(400, { code: "LINK_EXPIRED" }));
    const { container } = open();
    expect(await screen.findByRole("heading", { name: "لنک ختم ہو گیا" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "نیا لنک لیں" })).toBeInTheDocument();
    expect(container.querySelector('[data-frame="auth"]')).toHaveAttribute("dir", "rtl");
  });
});
