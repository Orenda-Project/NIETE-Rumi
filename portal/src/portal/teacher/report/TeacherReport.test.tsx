import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-370733 — Report an issue is for teachers too (operator, 12 Nov: "Report an issue on the portal only appearing for
 * Coaches only. Should be for teacher as well."). The teacher's More (the teacher app: teachers, and principals on it)
 * gets the coach's row in the coach's place, Account between My profile and Log out, and it opens the coach's own form.
 * Her report goes to POST /report-issue (any signed-in user), the coaches' table; the server records who she is.
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn, useRecordingSession: () => null }));
vi.mock("../help/useHelp", () => ({ useHelpSwitch: () => false }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(() => new Promise(() => {})) },
  portal: { reportIssue: vi.fn() },
  coach: { reportIssue: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
import { useAuth } from "../../hooks/useAuth";
import { coach, portal } from "../../services/api";
import More from "../pages/More";
import TeacherReport from "./TeacherReport";
import { TEACHER_REPORT_PATH } from "./paths";
import { TEACHER_ROUTES } from "../routes";
import { currentMenuItem, currentPrincipalMenuItem } from "../menu";

const MORE = "/portal/teacher/more";

function signedInAs(role: string | null) {
  vi.mocked(useAuth).mockReturnValue({
    user: { firstName: "Sana Iqbal", role, phoneNumber: "923001234567", schoolName: "IMSG I-10/1" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

const rows = () => screen.getAllByTestId(/^more-row-/).map((r) => r.getAttribute("data-testid"));

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.mocked(portal.reportIssue).mockResolvedValue({ success: true });
  signedInAs("teacher");
});

describe("the teacher's More has Report an issue", () => {
  it("in Account, between My profile and Log out, opening the teacher's own Report an issue page", () => {
    render(<MemoryRouter initialEntries={[MORE]}><More /></MemoryRouter>);
    expect(rows()).toEqual(["more-row-language", "more-row-profile", "more-row-report", "more-row-logout"]);
    const row = screen.getByTestId("more-row-report");
    expect(row).toHaveTextContent("Report an issue");
    expect(row).toHaveAttribute("href", "/portal/teacher/more/report");
    expect(TEACHER_REPORT_PATH).toBe("/portal/teacher/more/report");
  });

  it("in Urdu too, with the coach's words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<MemoryRouter initialEntries={[MORE]}><More /></MemoryRouter>);
    expect(screen.getByTestId("more-row-report")).toHaveTextContent("مسئلہ بتائیں");
  });

  it("a principal on the teacher app sees the same row (her More is the teacher's)", () => {
    signedInAs("principal");
    render(<MemoryRouter initialEntries={[MORE]}><More /></MemoryRouter>);
    expect(screen.getByTestId("more-row-report")).toHaveAttribute("href", TEACHER_REPORT_PATH);
  });
});

describe("the teacher's Report an issue page", () => {
  it("is a registered teacher route (TeacherGate: teachers and principals on the teacher app), not a leaders' page", () => {
    const route = TEACHER_ROUTES.find((r) => r.path === TEACHER_REPORT_PATH);
    expect(route).toBeDefined();
    expect(route?.leaders).toBeFalsy();
  });

  it("keeps More current in the teacher's menu and the principal's", () => {
    expect(currentMenuItem(TEACHER_REPORT_PATH)).toBe("more");
    expect(currentPrincipalMenuItem(TEACHER_REPORT_PATH)).toBe("more");
  });

  it("is the coach's form; Send goes to /report-issue as sent from the teacher's More, and Sent leads back there", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[TEACHER_REPORT_PATH]}>
        <Routes>
          <Route path={TEACHER_REPORT_PATH} element={<TeacherReport />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Report an issue");
    const kinds = screen.getAllByTestId("report-kind");
    expect(kinds.map((k) => k.textContent)).toEqual(["Something isn't working", "Numbers look wrong", "An idea", "Something else"]);
    await user.click(kinds[1]);
    await user.type(screen.getByRole("textbox", { name: "Your message" }), "Attendance shows 0 present");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(portal.reportIssue).toHaveBeenCalledWith({ kind: "numbers", message: "Attendance shows 0 present", page: MORE });
    expect(coach.reportIssue).not.toHaveBeenCalled();
    const sent = await screen.findByTestId("report-sent");
    expect(within(sent).getByRole("link", { name: "More" })).toHaveAttribute("href", MORE);
  });
});
