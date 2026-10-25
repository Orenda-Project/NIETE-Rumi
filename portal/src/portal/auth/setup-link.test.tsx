import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import { WHATSAPP_URL_PICKER } from "@/lib/whatsapp";

/**
 * bd-x7aprz.3 — no dead ends on the way in: nothing ever says "No account found" or "No password yet".
 *
 *   Forgot password  a number that is not registered gets a "Register on WhatsApp" button to the bot.
 *   Set-up link      an old /portal/setup/<token> link signs her in; a dead one says so and offers a new link from
 *                    WhatsApp (/portal typed). There is no set-password form any more.
 *
 * bd-xxi78f: the WhatsApp-code SIGN-IN that this file also pinned is gone from the login; the login (a number and a
 * password) is pinned in ./password-sign-in.test.tsx.
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  checkAuth: vi.fn(),
  api: {
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
  // This tier's bot number reaches the portal on /config (`bot`); a made-up one, built from parts.
  portal: { getConfig: vi.fn().mockResolvedValue({ success: true, features: {}, bot: ["92", "000", "0000001"].join("") }) },
  auth: {
    setupSignIn: h.api.setupSignIn,
    requestReset: h.api.requestReset,
  },
  language: { get: vi.fn(), set: vi.fn() },
}));

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
// The chat link the SERVER sends for its own deployment.
const serverChat = (text: string) => `${WHATSAPP_URL_PICKER}${BOT}?text=${encodeURIComponent(text)}`;
const BANNED = /No account found|No password yet/;

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
    h.api.setupSignIn.mockRejectedValue(httpError(400, { code: "LINK_EXPIRED", whatsapp: serverChat("/portal") }));
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole("heading", { name: "Link expired" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a new link" })).toHaveAttribute("href", serverChat("/portal"));
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
