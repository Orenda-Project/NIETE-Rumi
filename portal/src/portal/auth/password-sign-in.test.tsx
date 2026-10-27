import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tapProblems } from "../newui/checks/rules";

/**
 * bd-xxi78f — the login is a phone number and a password (operator, 2026-10-20). The WhatsApp-code sign-in
 * (bd-x7aprz.3) is gone from the page: no "Send code", no "Use password instead" / "Use a code instead", no signed-out
 * code banner. Forgot password is the one way through WhatsApp (a code, then a new password). An account name signs in
 * on its own page, reached by an "Admin login" button, not by turning the phone field into a name field.
 *
 *   A phone with no password (403) goes to that same Forgot password page, the number filled in, titled "Set password".
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  checkAuth: vi.fn(),
  api: { requestReset: vi.fn() },
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: h.login, checkAuth: h.checkAuth, user: null, loading: false }),
}));
vi.mock("../services/api", () => ({
  // Only what the real client still exports (services/api.ts): a mock that kept the code calls would hide their return.
  auth: { requestReset: h.api.requestReset },
  // This tier's bot number reaches the portal on /config (`bot`); a made-up one, built from parts.
  portal: { getConfig: vi.fn().mockResolvedValue({ success: true, features: {}, bot: ["92", "000", "0000001"].join("") }) },
  language: { get: vi.fn(), set: vi.fn() },
}));

import PortalLogin from "../pages/PortalLogin";
import PortalPasswordReset from "../pages/PortalPasswordReset";

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};

beforeEach(async () => {
  vi.clearAllMocks();
  h.checkAuth.mockResolvedValue(undefined);
  await setLang("en");
});
afterEach(async () => { await setLang("en"); });

const at = (ui: React.ReactElement, state?: unknown) =>
  render(<MemoryRouter initialEntries={[{ pathname: "/x", state }]}>{ui}</MemoryRouter>);
// Digits built from parts: the public repo holds no phone-shaped literal (tests/setup/phone-shaped-fixtures).
const NUM = ["03", "000", "000", "001"].join("");
const BANNED = /No password yet|No account found|Log in by code/;
const GONE_EN = ["Send code", "Use password instead", "Use a code instead", "Use a name instead", "Use phone number"];
const GONE_UR = ["کوڈ بھیجیں", "پاس ورڈ استعمال کریں", "کوڈ استعمال کریں", "نام استعمال کریں", "فون نمبر استعمال کریں"];

const signIn = async (user: ReturnType<typeof userEvent.setup>, phone = NUM, pw = "madeup123") => {
  await user.type(screen.getByLabelText("Phone number"), phone);
  await user.type(screen.getByLabelText("Password"), pw);
  await user.click(screen.getByRole("button", { name: "Log in" }));
};

describe("the login: a phone number, a password, Log in", () => {
  it("opens on the number and the password, with nothing of the code sign-in", () => {
    at(<PortalLogin />);
    expect(screen.getByLabelText("Phone number")).toHaveAttribute("inputmode", "tel");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    for (const gone of GONE_EN) expect(screen.queryByRole("button", { name: gone })).toBeNull();
    expect(screen.queryByText(/code on WhatsApp/i)).toBeNull(); // the signed-out notice pointed at the code
  });

  it("Urdu: the same page in Urdu, with the Admin login button", async () => {
    await setLang("ur");
    at(<PortalLogin />);
    expect(screen.getByLabelText("فون نمبر")).toBeInTheDocument();
    expect(screen.getByLabelText("پاس ورڈ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "لاگ اِن" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ایڈمن لاگ اِن" })).toBeInTheDocument();
    for (const gone of GONE_UR) expect(screen.queryByRole("button", { name: gone })).toBeNull();
  });

  it("number and password → in, to her home", async () => {
    h.login.mockResolvedValue({ success: true, user: { firstName: "Ayesha", role: "teacher" } });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await signIn(user);
    expect(h.login).toHaveBeenCalledWith(NUM, "madeup123");
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/dashboard"));
  });

  it("the API client has no code sign-in to call (the server routes stay one release: bd-pm4blf)", () => {
    const code = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("'/request-reset'"); // the file is the right one, and Forgot password is still there
    expect(code).not.toContain("'/request-code'");
    expect(code).not.toContain("'/verify-code'");
  });

  it("a letter in the number is not a name any more: 'Check the number', nothing sent", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await signIn(user, "fde-islamabad");
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the number");
    expect(h.login).not.toHaveBeenCalled();
  });

  it("every tap target is at least 56px, in English and Urdu", async () => {
    for (const lang of ["en", "ur"] as const) {
      await setLang(lang);
      const { container, unmount } = at(<PortalLogin />);
      expect({ lang, problems: tapProblems(container) }).toEqual({ lang, problems: [] });
      unmount();
    }
  });
});

describe("Forgot password and Admin login", () => {
  it("Forgot password carries the number she typed", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Forgot password" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/reset-password", { state: { phoneNumber: NUM } });
  });

  it("Admin login opens the account-name sign-in", async () => {
    const user = userEvent.setup();
    at(<PortalLogin />);
    await user.click(screen.getByRole("button", { name: "Admin login" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/analytics/login");
  });
});

describe("a phone the server answers for", () => {
  it("no password on the account (403): to Forgot password with her number, to set one", async () => {
    h.login.mockResolvedValue({ success: false, status: 403, error: "server sentence" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await signIn(user);
    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith("/portal/reset-password", { state: { phoneNumber: NUM, setPw: true } }),
    );
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("not registered (404): Register on WhatsApp", async () => {
    h.login.mockResolvedValue({ success: false, status: 404, error: "server sentence" });
    const user = userEvent.setup();
    at(<PortalLogin />);
    await signIn(user);
    expect(await screen.findByRole("link", { name: "Register on WhatsApp" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});

describe("the Forgot password page", () => {
  it("reached from a 403 it is titled 'Set password' and keeps her number", () => {
    at(<PortalPasswordReset />, { phoneNumber: NUM, setPw: true });
    expect(screen.getByRole("heading", { name: "Set password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveValue(NUM);
    expect(screen.getByRole("button", { name: "Send code" })).toBeInTheDocument();
  });

  it("Urdu: 'Set password' in Urdu", async () => {
    await setLang("ur");
    at(<PortalPasswordReset />, { phoneNumber: NUM, setPw: true });
    expect(screen.getByRole("heading", { name: "پاس ورڈ بنائیں" })).toBeInTheDocument();
  });

  it("opened from the link it is still 'Forgot password'", () => {
    at(<PortalPasswordReset />, { phoneNumber: NUM });
    expect(screen.getByRole("heading", { name: "Forgot password" })).toBeInTheDocument();
  });
});
