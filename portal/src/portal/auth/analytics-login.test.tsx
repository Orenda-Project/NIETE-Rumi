import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../newui/checks/rules";

/**
 * The analytics accounts' own sign-in page, /portal/analytics/login: an account NAME and a password, one Log in, in
 * the teacher login's look (the same frame, fields, button and bilingual words). Nothing a teacher's sign-in carries
 * is here: no phone, no WhatsApp code, no Forgot password, no name/phone switch, no register prompt, no banners.
 *
 * It signs in through the same useAuth().login the teacher form uses (POST /api/portal/login, the name in the phone
 * field) and lands where homeFor() says: an analytics-only account on the schools analytics page, anyone else on
 * their own home. The server answers every refusal of a name with the same 401, so the page says the plain
 * "Couldn't log in" and never points at one field.
 */
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  auth: { user: null as unknown, loading: false, login: vi.fn(), checkAuth: vi.fn() },
  api: { requestCode: vi.fn(), langGet: vi.fn(), langSet: vi.fn() },
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("../services/api", () => ({
  auth: { requestCode: h.api.requestCode },
  language: { get: h.api.langGet, set: h.api.langSet },
}));

import AnalyticsLogin from "./AnalyticsLogin";

const ANALYTICS = "/portal/analytics/schools";

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

const mount = (search = "") =>
  render(<MemoryRouter initialEntries={[`/portal/analytics/login${search}`]}><AnalyticsLogin /></MemoryRouter>);

const fill = async (user: ReturnType<typeof userEvent.setup>, name = "fde_admin", pw = "madeup123") => {
  if (name) await user.type(screen.getByLabelText("Account name"), name);
  if (pw) await user.type(screen.getByLabelText("Password"), pw);
  await user.click(screen.getByRole("button", { name: "Log in" }));
};

describe("the page: an account name, a password, one Log in", () => {
  it("is titled 'Schools analytics' with a one-line subtitle, in the auth frame", () => {
    mount();
    expect(document.querySelector('[data-frame="auth"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Schools analytics" })).toBeInTheDocument();
    expect(screen.getByText("Log in with your account name")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "NIETE Portal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByTestId("login-legal-footer")).toHaveTextContent("Privacy policy · Delete account");
  });

  it("the account name is a plain text field: no capitals, no autocorrect, no spell marks, a username", () => {
    mount();
    const name = screen.getByLabelText("Account name");
    expect(name).toHaveAttribute("type", "text");
    expect(name).toHaveAttribute("autocapitalize", "none");
    expect(name).toHaveAttribute("autocorrect", "off");
    expect(name).toHaveAttribute("spellcheck", "false");
    expect(name).toHaveAttribute("autocomplete", "username");
    expect(name).not.toHaveAttribute("inputmode", "tel");
  });

  it("the password has its eye and is the current password", async () => {
    const user = userEvent.setup();
    mount();
    const pw = screen.getByLabelText("Password");
    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveAttribute("autocomplete", "current-password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("carries none of the teacher sign-in's choices", () => {
    mount();
    expect(screen.getAllByRole("textbox")).toHaveLength(1); // the name; the password is not a textbox
    for (const gone of [
      "Phone number", "Send code", "Use password instead", "Use a code instead", "Forgot password",
      "Use a name instead", "Use phone number", "Register on WhatsApp", "Not registered yet",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByText(/WhatsApp/)).toBeNull(); // no signed-out code banner, no register prompt
    expect(screen.queryByRole("link", { name: /whatsapp/i })).toBeNull();
    // One button that submits, besides the eye and the language pill.
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent)).toEqual(
      ["Language", "Show password", "Log in"],
    );
  });

  it("every tap target is at least 56px, in English and Urdu", async () => {
    for (const lang of ["en", "ur"] as const) {
      await setLang(lang);
      const { container, unmount } = mount();
      expect({ lang, problems: tapProblems(container) }).toEqual({ lang, problems: [] });
      unmount();
    }
  });
});

describe("signing in", () => {
  it("sends the name and password through the same login the teacher form uses, as typed", async () => {
    h.auth.login.mockResolvedValue({ success: true, user: { role: "unregistered", analyticsOnly: true } });
    const user = userEvent.setup();
    mount();
    await fill(user, "FDE_Admin", "madeup123");
    await waitFor(() => expect(h.auth.login).toHaveBeenCalledWith("FDE_Admin", "madeup123"));
    expect(h.auth.login).toHaveBeenCalledTimes(1);
    expect(h.api.requestCode).not.toHaveBeenCalled();
  });

  it("an analytics-only account lands on the schools analytics page", async () => {
    h.auth.login.mockResolvedValue({ success: true, user: { role: "unregistered", analyticsOnly: true } });
    const user = userEvent.setup();
    mount();
    await fill(user);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(ANALYTICS));
    expect(h.toast).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: "teacher" }, "/portal/dashboard"],
    [{ role: "coach" }, "/portal/leader"],
    [{ role: "principal", analyticsOnly: false }, "/portal/leader"],
  ])("any other account goes to its own home (%o -> %s)", async (who, home) => {
    h.auth.login.mockResolvedValue({ success: true, user: who });
    const user = userEvent.setup();
    mount();
    await fill(user);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(home));
    expect(h.navigate).not.toHaveBeenCalledWith(ANALYTICS);
  });

  it("waiting is the button: 'Logging in', busy, not tappable twice", async () => {
    let resolve: (v: unknown) => void = () => {};
    h.auth.login.mockReturnValue(new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    mount();
    await fill(user);
    const busy = await screen.findByRole("button", { name: "Logging in" });
    expect(busy).toBeDisabled();
    expect(h.auth.login).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ success: false, status: 401, error: "x" }); });
    expect(await screen.findByRole("button", { name: "Log in" })).toBeEnabled();
  });
});

describe("errors: under the field, or one plain message, in her language", () => {
  it("an empty name asks for the name, under the name; nothing is sent", async () => {
    const user = userEvent.setup();
    mount();
    await fill(user, "", "madeup123");
    expect(h.auth.login).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter name");
    expect(screen.getByLabelText("Account name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Account name")).toHaveAccessibleDescription("Enter name");
  });

  it("spaces alone are an empty name", async () => {
    const user = userEvent.setup();
    mount();
    await fill(user, "   ", "madeup123");
    expect(h.auth.login).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter name");
  });

  it("an empty password asks for the password, under the password; nothing is sent", async () => {
    const user = userEvent.setup();
    mount();
    await fill(user, "fde_admin", "");
    expect(h.auth.login).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("a wrong name or password (401) is the plain 'Couldn't log in', never 'Wrong password'", async () => {
    h.auth.login.mockResolvedValue({ success: false, status: 401, error: "Incorrect password. Please try again." });
    const user = userEvent.setup();
    mount();
    await fill(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't log in");
    expect(alert).not.toHaveTextContent("Wrong password");
    expect(screen.getByLabelText("Account name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it.each([
    [500, "Couldn't log in"],
    [200, "Couldn't log in"],
    // Only digits reach the server as a phone: still one plain message, never a teacher's register / code / number one.
    [400, "Couldn't log in"],
    [403, "Couldn't log in"],
    [404, "Couldn't log in"],
    [429, "Too many tries"],
    [0, "No connection"],
  ])("status %i: '%s'", async (status, label) => {
    h.auth.login.mockResolvedValue({ success: false, status, error: "server sentence" });
    const user = userEvent.setup();
    mount();
    await fill(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(label);
    expect(alert).not.toHaveTextContent("server sentence");
    expect(screen.queryByText("Register on WhatsApp")).toBeNull();
    expect(screen.queryByText("Log in by code")).toBeNull();
    expect(screen.queryByText("Check the number")).toBeNull();
  });

  it("a login that throws is 'No connection'", async () => {
    h.auth.login.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    mount();
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("No connection");
  });

  it("the form message goes when she types again", async () => {
    h.auth.login.mockResolvedValue({ success: false, status: 401, error: "x" });
    const user = userEvent.setup();
    mount();
    await fill(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't log in");
    await user.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("already signed in", () => {
  it("an analytics-only account goes straight to the schools analytics page", async () => {
    h.auth.user = { firstName: "FDE", role: "unregistered", analyticsOnly: true };
    mount();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(ANALYTICS, { replace: true }));
    expect(screen.queryByLabelText("Account name")).toBeNull();
  });

  it.each([
    [{ role: "teacher" }, "/portal/dashboard"],
    [{ role: "coach" }, "/portal/leader"],
  ])("anyone else goes to their own home (%o -> %s)", async (who, home) => {
    h.auth.user = who;
    mount();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith(home, { replace: true }));
  });

  it("while the session is being read: the sign-in outline, never the form", () => {
    h.auth.loading = true;
    mount();
    expect(document.querySelector('[data-frame="login"][aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText("Account name")).toBeNull();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("Urdu", () => {
  it("right-to-left, Urdu words, the account name left-to-right", async () => {
    await setLang("ur");
    mount();
    const frame = document.querySelector('[data-frame="auth"]') as HTMLElement;
    expect(frame).toHaveAttribute("dir", "rtl");
    expect(frame).toHaveAttribute("lang", "ur");
    expect(screen.getByRole("heading", { level: 1, name: "اسکولوں کا تجزیہ" })).toBeInTheDocument();
    expect(screen.getByText("اپنے اکاؤنٹ کے نام سے لاگ اِن کریں")).toBeInTheDocument();
    expect(screen.getByLabelText("اکاؤنٹ کا نام")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("پاس ورڈ")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "لاگ اِن" })).toBeInTheDocument();
    expect(screen.queryByText("Schools analytics")).toBeNull();
  });

  it("the messages are Urdu too", async () => {
    await setLang("ur");
    h.auth.login.mockResolvedValue({ success: false, status: 401, error: "x" });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "لاگ اِن" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("نام لکھیں");
    await user.type(screen.getByLabelText("اکاؤنٹ کا نام"), "fde_admin");
    await user.type(screen.getByLabelText("پاس ورڈ"), "madeup123");
    await user.click(screen.getByRole("button", { name: "لاگ اِن" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لاگ اِن نہیں ہوا");
  });

  it("the language pill switches this page, and never touches an account", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Language" }));
    expect(i18n.language).toBe("ur");
    expect(screen.getByRole("heading", { level: 1, name: "اسکولوں کا تجزیہ" })).toBeInTheDocument();
    expect(h.api.langSet).not.toHaveBeenCalled();
    expect(h.api.langGet).not.toHaveBeenCalled();
  });
});
