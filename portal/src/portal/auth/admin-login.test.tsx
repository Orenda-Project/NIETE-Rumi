import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../newui/checks/rules";

/**
 * bd-xxi78f.5 — the name accounts' sign-in (/portal/analytics/login), reached by "Admin login" (operator, 2026-10-20):
 *
 *   "what about going from Admin login back to the regular login?"  → a Back arrow in the band (lib/useBack: the
 *     screen she came from, or the login when nothing of the app is behind it — the old dashboard's redirect).
 *   "the title should instead of Schools analytics be NIETE Admin, stylistically a little different as well"
 *     → title "NIETE Admin", and option A: the same indigo band and lattice, with a flat "Admin" badge (a shield) above
 *     the title. The teacher login and its sibling pages carry no badge.
 */
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { user: null as unknown, loading: false, login: vi.fn(), checkAuth: vi.fn() },
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("../services/api", () => ({ auth: {}, language: { get: vi.fn(), set: vi.fn() } }));

import AnalyticsLogin from "./AnalyticsLogin";
import PortalLogin from "../pages/PortalLogin";
import PortalPasswordReset from "../pages/PortalPasswordReset";

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};

beforeEach(async () => {
  vi.clearAllMocks();
  h.auth = { user: null, loading: false, login: vi.fn(), checkAuth: vi.fn() };
  await setLang("en");
});
afterEach(async () => { await setLang("en"); });

const ADMIN = "/portal/analytics/login";
const mount = (entries: string[] = [ADMIN]) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <AnalyticsLogin />
    </MemoryRouter>,
  );
const band = () => document.querySelector('[data-frame="auth"] header') as HTMLElement;
// The Urdu title isolates the Latin brand (LRI … PDI); compare without the invisible marks.
const plain = (s: string | null | undefined) => String(s ?? "").replace(/[⁦-⁩]/g, "");

describe("the title: NIETE Admin", () => {
  it("English: 'NIETE Admin', the one-line subtitle unchanged", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^NIETE Admin$/);
    expect(screen.getByText("Log in with your account name")).toBeInTheDocument();
    expect(screen.queryByText("Schools analytics")).toBeNull();
  });

  it("Urdu: 'NIETE ایڈمن', the brand isolated left-to-right", async () => {
    await setLang("ur");
    mount();
    const title = screen.getByRole("heading", { level: 1 });
    expect(plain(title.textContent)).toBe("NIETE ایڈمن");
    expect(title.textContent).toContain("⁦NIETE⁩");
  });
});

describe("the Admin badge (option A)", () => {
  it("sits on the band above the title: 'Admin' with a shield, information and not a control", () => {
    mount();
    const badge = within(band()).getByTestId("auth-badge");
    expect(badge).toHaveTextContent(/^Admin$/);
    expect(badge.querySelector("svg")).not.toBeNull(); // the shield
    expect(badge.closest("button, a")).toBeNull();
    const title = screen.getByRole("heading", { level: 1 });
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Urdu: 'ایڈمن'", async () => {
    await setLang("ur");
    mount();
    expect(within(band()).getByTestId("auth-badge")).toHaveTextContent(/^ایڈمن$/);
  });

  it.each([
    ["the teacher login", () => render(<MemoryRouter><PortalLogin /></MemoryRouter>)],
    ["forgot password", () => render(<MemoryRouter><PortalPasswordReset /></MemoryRouter>)],
  ])("%s carries no badge", (_n, open) => {
    open();
    expect(screen.queryByTestId("auth-badge")).toBeNull();
  });
});

describe("Back to the regular login", () => {
  it("opened on its own (the old dashboard's redirect, a fresh tab): Back goes to the login, replacing this page", async () => {
    const user = userEvent.setup();
    mount([ADMIN]);
    await user.click(within(band()).getByRole("button", { name: "Back" }));
    expect(h.navigate).toHaveBeenCalledWith("/portal/login", { replace: true });
  });

  it("opened from the login's Admin login: Back is one step back, to that login", async () => {
    const user = userEvent.setup();
    mount(["/portal/login", ADMIN]);
    await user.click(within(band()).getByRole("button", { name: "Back" }));
    expect(h.navigate).toHaveBeenCalledWith(-1);
  });

  it("Urdu: the Back arrow is labelled in Urdu", async () => {
    await setLang("ur");
    mount();
    expect(within(band()).getByRole("button", { name: "واپس" })).toBeInTheDocument();
  });

  it("every tap target, Back included, is at least 56px in English and Urdu", async () => {
    for (const lang of ["en", "ur"] as const) {
      await setLang(lang);
      const { container, unmount } = mount();
      expect({ lang, problems: tapProblems(container) }).toEqual({ lang, problems: [] });
      unmount();
    }
  });
});
