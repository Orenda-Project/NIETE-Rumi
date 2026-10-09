import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ language: { get: vi.fn(), set: vi.fn() } }));
const logout = vi.fn();
vi.mock("../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn }));
vi.mock("i18next", () => {
  const handlers: Array<() => void> = [];
  const i18n = {
    language: "en",
    on: (_e: string, h: () => void) => { handlers.push(h); },
    off: () => {},
    changeLanguage: vi.fn(async (lng: string) => { i18n.language = lng; handlers.forEach((h) => h()); }),
  };
  return { default: i18n };
});
import i18n from "i18next";
import { useAuth } from "../../hooks/useAuth";
import { language } from "../../services/api";
import More from "./More";
import { teacherPath } from "../routes";

/**
 * bd-fmf24g.1 — teacher v2 More (canvas v28 More): who she is, then rows for the
 * features the menu bar does not hold — Assessment, Attendance, My Classes, Analytics;
 * Certificates; Language, My profile, Logout.
 */
function renderMore() {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Ayesha Bibi", role: "teacher", phoneNumber: "923001234567", schoolName: "IMSG I-10/1" },
    loading: false,
    logout,
  } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/teacher/more"]}><More /></MemoryRouter>);
}

describe("teacher v2 More", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (i18n as unknown as { language: string }).language = "en";
    vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false });
    vi.mocked(language.set).mockResolvedValue(undefined);
  });

  it("who she is: initials, name, her phone the local way, her school", () => {
    renderMore();
    const who = screen.getByTestId("more-who");
    expect(who).toHaveTextContent("AB");
    expect(who).toHaveTextContent("Ayesha Bibi");
    expect(who).toHaveTextContent("0300 1234567");
    expect(who).toHaveTextContent("IMSG I-10/1");
  });

  it("exactly three things: Language, My profile, Log out (bd-fmf24g.33)", () => {
    renderMore();
    expect(screen.getAllByTestId(/^more-row-/).map((r) => r.getAttribute("data-testid"))).toEqual([
      "more-row-language", "more-row-profile", "more-row-logout",
    ]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", teacherPath("profile"));
    for (const gone of ["Assessment", "Attendance", "My Classes", "Analytics", "Certificates"]) expect(screen.queryByText(gone)).toBeNull();
  });

  it("Language is a two-option toggle, English | اردو, the current one picked", () => {
    renderMore();
    const tabs = within(screen.getByTestId("more-row-language")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["English", "اردو"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("picking the other language saves through the one writer, then switches the page", async () => {
    renderMore();
    await userEvent.setup().click(screen.getByRole("tab", { name: "اردو" }));
    await waitFor(() => expect(language.set).toHaveBeenCalledWith("ur"));
    await waitFor(() => expect(i18n.changeLanguage).toHaveBeenCalledWith("ur"));
  });

  it("picking the language already shown writes nothing", async () => {
    renderMore();
    await userEvent.setup().click(screen.getByRole("tab", { name: "English" }));
    expect(language.set).not.toHaveBeenCalled();
  });

  it("a failed save keeps the page's language and says Not saved", async () => {
    vi.mocked(language.set).mockRejectedValue(new Error("400"));
    renderMore();
    await userEvent.setup().click(screen.getByRole("tab", { name: "اردو" }));
    await waitFor(() => expect(language.set).toHaveBeenCalled());
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
  });

  it("Logout logs out (through the recording guard)", async () => {
    renderMore();
    await userEvent.setup().click(screen.getByTestId("more-row-logout"));
    expect(logout).toHaveBeenCalled();
  });

  it("every row is a 56px+ target", () => {
    renderMore();
    for (const row of within(document.body).getAllByTestId(/^more-row-/)) expect(row.className).toMatch(/min-h-\[64px\]/);
  });
});
