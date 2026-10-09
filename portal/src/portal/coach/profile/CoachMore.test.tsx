import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ language: { get: vi.fn(), set: vi.fn() }, coach: { getHome: vi.fn() } }));
vi.mock("../../lib/useChildTest", () => ({ useChildTest: vi.fn() }));
vi.mock("../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn }));
import { useAuth } from "../../hooks/useAuth";
import { useChildTest } from "../../lib/useChildTest";
import { coach, language } from "../../services/api";
import CoachMore from "./CoachMore";

/** bd-4404s7.2 — the coach's More (Coach_More): who she is, Training and Certificates, Language, My profile, Log out. */
const logout = vi.fn();
const HOME = { today: [], counts: { week: 6, overdue: 0, waiting: 0, inProgress: 0, teachers: 84, schools: 12 } };

function renderMore() {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Hataf Atif", role: "coach", phoneNumber: "923001234567" }, loading: false, logout,
  } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/coach/more"]}><CoachMore /></MemoryRouter>);
}

describe("CoachMore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await act(async () => { await i18n.changeLanguage("en"); });
    vi.mocked(useChildTest).mockReturnValue(false);
    vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false });
    vi.mocked(language.set).mockResolvedValue(undefined);
    vi.mocked(coach.getHome).mockResolvedValue({ success: true, home: HOME } as never);
  });

  it("who she is: initials, name, phone the local way, and her school count from the API", async () => {
    renderMore();
    const who = screen.getByTestId("more-who");
    expect(who).toHaveTextContent("HA");
    expect(who).toHaveTextContent("Hataf Atif");
    expect(who).toHaveTextContent("0300 1234567");
    expect(await within(who).findByText(/12 schools/)).toBeInTheDocument();
  });

  it("no school count when the API cannot say (nothing invented)", async () => {
    vi.mocked(coach.getHome).mockRejectedValue(new Error("down"));
    renderMore();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("more-who")).not.toHaveTextContent("school");
  });

  it("exactly three things: Language, My profile, Log out (bd-fmf24g.33)", () => {
    renderMore();
    expect(screen.getAllByTestId(/^more-row-/).map((r) => r.getAttribute("data-testid"))).toEqual([
      "more-row-language", "more-row-profile", "more-row-logout",
    ]);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByTestId("more-row-profile")).toHaveAttribute("href", "/portal/coach/profile");
    expect(screen.queryByText("Training")).toBeNull();
    expect(screen.queryByText("Certificates")).toBeNull();
  });

  it("Language is a two-option toggle, English | اردو, and the child test no longer lives here", () => {
    vi.mocked(useChildTest).mockReturnValue(true);
    renderMore();
    const tabs = within(screen.getByTestId("more-row-language")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["English", "اردو"]);
    expect(screen.queryByTestId("more-row-child-test")).toBeNull();
  });

  it("Language switches (one writer) and Log out logs out", async () => {
    const user = userEvent.setup();
    renderMore();
    await user.click(screen.getByRole("tab", { name: "اردو" }));
    expect(language.set).toHaveBeenCalledWith("ur");
    await user.click(screen.getByTestId("more-row-logout"));
    expect(logout).toHaveBeenCalled();
  });

  it("Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderMore();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("مزید");
    expect(screen.getByText("میری پروفائل")).toBeInTheDocument();
    expect(screen.getByText("لاگ آؤٹ")).toBeInTheDocument();
    expect(await screen.findByText(/12 اسکول/)).toBeInTheDocument();
  });
});
