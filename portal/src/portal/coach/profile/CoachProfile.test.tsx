import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ coach: { getHome: vi.fn() } }));
import { useAuth } from "../../hooks/useAuth";
import { coach } from "../../services/api";
import CoachProfile from "./CoachProfile";

/** bd-4404s7.2 — the coach's own profile (Coach_Profile): name and phone as facts, her schools, privacy, delete. */
const HOME = { today: [], counts: { week: 6, overdue: 0, waiting: 0, inProgress: 0, teachers: 84, schools: 12 } };

function renderProfile() {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Hataf Atif", role: "coach", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/portal/coach/profile"]}><CoachProfile /></MemoryRouter>);
}

describe("CoachProfile", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
    await act(async () => { await i18n.changeLanguage("en"); });
    vi.mocked(coach.getHome).mockResolvedValue({ success: true, home: HOME } as never);
  });

  it("her name and phone, shown (not edited), under a Back to More", async () => {
    renderProfile();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My profile");
    expect(screen.getByTestId("profile-name")).toHaveTextContent("Hataf Atif");
    expect(screen.getByTestId("profile-phone")).toHaveTextContent("0300 1234567");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/portal/coach/more");
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => { await Promise.resolve(); });
  });

  it("Schools opens the Schools tab, with her real school and teacher counts", async () => {
    renderProfile();
    const row = await screen.findByTestId("profile-schools");
    expect(row).toHaveAttribute("href", "/portal/coach/people");
    expect(row).toHaveTextContent("12 schools");
    expect(row).toHaveTextContent("84 teachers");
  });

  it("no Schools row when the API cannot say", async () => {
    vi.mocked(coach.getHome).mockRejectedValue(new Error("down"));
    renderProfile();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("profile-schools")).toBeNull();
  });

  it("Account: Privacy policy and Delete account go to their pages", () => {
    renderProfile();
    expect(screen.getByRole("link", { name: /Privacy policy/ })).toHaveAttribute("href", "/portal/privacy");
    expect(screen.getByRole("link", { name: /Delete account/ })).toHaveAttribute("href", "/portal/delete-account");
  });

  it("Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderProfile();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("میری پروفائل");
    expect(screen.getByText("پرائیویسی پالیسی")).toBeInTheDocument();
    expect(screen.getByText("اکاؤنٹ حذف کریں")).toBeInTheDocument();
    expect(await screen.findByTestId("profile-schools")).toHaveTextContent("12 اسکول");
  });
});
