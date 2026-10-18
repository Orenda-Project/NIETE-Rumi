import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../newui/checks/rules";

/**
 * A short-lived notice on the login page for people who were signed out by a server change: the default sign-in is a
 * code on WhatsApp, so they do not need the password they may have forgotten. It shows on every state of the page, in
 * the page's language, and it goes away by itself after its end date (no release, no switch). On the password form it
 * carries a tap that switches to the code sign-in; on the code form it is text only.
 */

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  checkAuth: vi.fn(),
  requestCode: vi.fn(),
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: h.login, checkAuth: h.checkAuth, user: null, loading: false }),
}));
vi.mock("../services/api", () => ({
  auth: { requestCode: h.requestCode, verifyCode: vi.fn(), setupSignIn: vi.fn(), requestReset: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PortalLogin from "./PortalLogin";

const EN = "Signed out? Log in with a code on WhatsApp — no password needed.";
const UR = "لاگ ان ختم ہو گیا؟ واٹس ایپ پر کوڈ سے لاگ ان کریں، پاس ورڈ کی ضرورت نہیں۔";

// Pakistan time is UTC+5 all year.
const BEFORE = new Date("2026-10-18T22:00:00+05:00");
const LAST_MINUTE = new Date("2026-10-25T23:59:30+05:00");
const AFTER = new Date("2026-10-26T00:00:00+05:00");

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};
const at = () => render(<MemoryRouter initialEntries={["/portal/login"]}><PortalLogin /></MemoryRouter>);
const banner = () => screen.queryByTestId("signed-out-banner");
// Digits built from parts: no phone-shaped literal in the repo.
const NUM = ["03", "000", "000", "001"].join("");

beforeEach(async () => {
  vi.clearAllMocks();
  h.checkAuth.mockResolvedValue(undefined);
  // Only Date is faked, so user events and promises run as normal.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BEFORE);
  await setLang("en");
});
afterEach(async () => {
  vi.useRealTimers();
  await setLang("en");
});

describe("the signed-out notice on the login page", () => {
  it("shows in English above the form, text only, while the code form is showing", () => {
    at();
    const b = banner();
    expect(b).not.toBeNull();
    expect(b).toHaveTextContent(EN);
    // Above the form: it comes before the phone field in the page.
    const field = document.getElementById("phoneNumber")!;
    expect(b!.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(b!).queryByRole("button")).toBeNull();
    // A notice, never an error.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows in Urdu, right-to-left, in the Urdu page", async () => {
    await setLang("ur");
    at();
    const b = banner();
    expect(b).not.toBeNull();
    expect(b).toHaveTextContent(UR);
    expect(b!.closest('[data-frame="auth"]')).toHaveAttribute("dir", "rtl");
  });

  it("still shows in the last minute of its last day", () => {
    vi.setSystemTime(LAST_MINUTE);
    at();
    expect(banner()).toHaveTextContent(EN);
  });

  it.each(["en", "ur"] as const)("is gone after its end date (%s), with no release", async (lang) => {
    vi.setSystemTime(AFTER);
    await setLang(lang);
    at();
    expect(banner()).toBeNull();
    expect(screen.queryByText(EN)).toBeNull();
    expect(screen.queryByText(UR)).toBeNull();
  });

  it("on the password form its tap switches to the code sign-in", async () => {
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "Use password instead" }));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    const tap = within(banner()!).getByRole("button");
    await user.click(tap);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Send code" })).toBeInTheDocument();
    expect(within(banner()!).queryByRole("button")).toBeNull();
  });

  it("on the Urdu password form the tap is in Urdu and switches too", async () => {
    await setLang("ur");
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "پاس ورڈ استعمال کریں" }));
    const tap = within(banner()!).getByRole("button");
    expect(tap).toHaveTextContent("کوڈ سے لاگ اِن");
    await user.click(tap);
    expect(screen.getByRole("button", { name: "کوڈ بھیجیں" })).toBeInTheDocument();
  });

  it("shows on the enter-code step too, text only", async () => {
    h.requestCode.mockResolvedValue({});
    const user = userEvent.setup();
    at();
    await user.type(screen.getByLabelText("Phone number"), NUM);
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("Enter code")).toBeInTheDocument();
    expect(banner()).toHaveTextContent(EN);
    expect(within(banner()!).queryByRole("button")).toBeNull();
  });

  it("keeps every tap target at least 56px, password form included", async () => {
    const user = userEvent.setup();
    const { container } = at();
    await user.click(screen.getByRole("button", { name: "Use password instead" }));
    expect(tapProblems(container)).toEqual([]);
  });
});
