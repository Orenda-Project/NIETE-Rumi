import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../newui/checks/rules";

/**
 * bd-gmuk5s — on a phone the sign-in field opens the number keypad (type="tel"), so an analytics-only account
 * (bd-s6qbts.5) could not type its NAME ("admin") unless from a PC. Teachers keep the keypad by default; a small
 * link under the field switches it to a normal keyboard for a name, and a second link switches back. A value that
 * already holds a letter (pasted, autofilled) is a name without the tap. The server and the phone check are as before.
 */

const h = vi.hoisted(() => ({ navigate: vi.fn(), login: vi.fn() }));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ login: h.login, user: null, loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PortalLogin from "./PortalLogin";

const setLang = async (l: "en" | "ur") => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage(l); });
};

beforeEach(async () => {
  vi.clearAllMocks();
  await setLang("en");
});
afterEach(async () => { await setLang("en"); });

const at = () => render(<MemoryRouter initialEntries={["/portal/login"]}><PortalLogin /></MemoryRouter>);
const field = () => document.getElementById("phoneNumber") as HTMLInputElement;

describe("the sign-in field: phone keypad by default, a link for a name (bd-gmuk5s)", () => {
  it("by default it is the phone field, unchanged: tel keypad, phone label, Forgot password", () => {
    at();
    const input = screen.getByLabelText("Phone number");
    expect(input).toBe(field());
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toHaveAttribute("inputmode", "tel");
    expect(input).toHaveAttribute("autocomplete", "username");
    expect(screen.getByRole("button", { name: "Forgot password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a name instead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use phone number" })).toBeNull();
  });

  it("'Use a name instead' opens a normal keyboard: text, no capitals, no autocorrect, relabelled, focused, no Forgot password", async () => {
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "Use a name instead" }));
    const input = screen.getByLabelText("Account name");
    expect(input).toBe(field());
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "text");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocomplete", "username");
    expect(input).not.toHaveAttribute("placeholder", "03XX XXXXXXX");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Forgot password" })).toBeNull();
    expect(screen.queryByLabelText("Phone number")).toBeNull();
    expect(screen.getByRole("button", { name: "Use phone number" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use a name instead" })).toBeNull();
  });

  it("'Use phone number' brings the keypad back, focused, with Forgot password", async () => {
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "Use a name instead" }));
    await user.click(screen.getByRole("button", { name: "Use phone number" }));
    const input = screen.getByLabelText("Phone number");
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toHaveAttribute("inputmode", "tel");
    expect(input).not.toHaveAttribute("autocapitalize");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Forgot password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a name instead" })).toBeInTheDocument();
  });

  it("switching back to the phone empties a name, so the keypad starts on a clean field", async () => {
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "Use a name instead" }));
    await user.type(field(), "admin");
    await user.click(screen.getByRole("button", { name: "Use phone number" }));
    expect(field()).toHaveValue("");
    expect(field()).toHaveAttribute("type", "tel");
  });

  it("a pasted value with a letter is a name without the tap", async () => {
    const user = userEvent.setup();
    at();
    await user.click(field());
    await user.paste("admin");
    const input = screen.getByLabelText("Account name");
    expect(input).toHaveValue("admin");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "text");
    expect(screen.queryByRole("button", { name: "Forgot password" })).toBeNull();
    expect(screen.getByRole("button", { name: "Use phone number" })).toBeInTheDocument();
  });

  it("in name mode the name goes to the server as typed", async () => {
    h.login.mockResolvedValue({ success: true, user: { role: "unregistered", analyticsOnly: true } });
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "Use a name instead" }));
    await user.type(screen.getByLabelText("Account name"), "admin");
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(h.login).toHaveBeenCalledWith("admin", "madeup123"));
    expect(screen.queryByText("Check the number")).toBeNull();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/portal/analytics/schools"));
  });

  it("an empty name says 'Enter name' under the field, not 'Check the number', and never calls", async () => {
    const user = userEvent.setup();
    at();
    await user.click(screen.getByRole("button", { name: "Use a name instead" }));
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter name");
    expect(screen.queryByText("Check the number")).toBeNull();
    expect(h.login).not.toHaveBeenCalled();
  });

  it("the phone check is unchanged: a short number is still caught here", async () => {
    const user = userEvent.setup();
    at();
    await user.type(field(), "0300 123");
    await user.type(screen.getByLabelText("Password"), "madeup123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the number");
    expect(h.login).not.toHaveBeenCalled();
  });

  it("Urdu: both links and the label are in Urdu, and the field stays left-to-right", async () => {
    await setLang("ur");
    const user = userEvent.setup();
    at();
    expect(screen.getByLabelText("فون نمبر")).toHaveAttribute("inputmode", "tel");
    await user.click(screen.getByRole("button", { name: "نام استعمال کریں" }));
    const input = screen.getByLabelText("اکاؤنٹ کا نام");
    expect(input).toHaveAttribute("inputmode", "text");
    expect(input).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: "فون نمبر استعمال کریں" })).toBeInTheDocument();
    expect(screen.queryByText("Use a name instead")).toBeNull();
    expect(screen.queryByText("Use phone number")).toBeNull();
  });

  it.each(["en", "ur"] as const)("every tap target is at least 56px in both modes (%s)", async (lang) => {
    await setLang(lang);
    const user = userEvent.setup();
    const { container } = at();
    expect(tapProblems(container)).toEqual([]);
    await user.click(screen.getByRole("button", { name: lang === "en" ? "Use a name instead" : "نام استعمال کریں" }));
    expect(tapProblems(container)).toEqual([]);
  });
});
