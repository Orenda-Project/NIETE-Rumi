import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-370733 — Send feedback is for teachers too (operator, 12 Nov: "Report an issue on the portal only appearing for
 * Coaches only. Should be for teacher as well."). The teacher's More (the teacher app: teachers, and principals on it)
 * gets the coach's row in the same place, Account between My profile and Log out, and it opens the coach's own form.
 * What she sends lands where a coach's lands (POST /feedback → coach_feedback); the server records who she is.
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn, useRecordingSession: () => null }));
vi.mock("../help/useHelp", () => ({ useHelpSwitch: () => false }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(() => new Promise(() => {})) },
  portal: { presignFeedbackUpload: vi.fn(), uploadToR2: vi.fn(), sendFeedback: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
const voice = { available: true, state: "idle", clip: null, elapsedMs: 0, start: vi.fn(), stop: vi.fn(), discard: vi.fn() };
vi.mock("../../lib/voiceAnswer", () => ({ useVoiceAnswer: () => voice, VOICE_ANSWER_MAX_MS: 180000 }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import More from "../pages/More";
import TeacherFeedback from "./TeacherFeedback";
import { TEACHER_FEEDBACK_PATH } from "./paths";
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
  vi.mocked(portal.sendFeedback).mockResolvedValue({ success: true, feedbackId: "fb-1" });
  signedInAs("teacher");
});

describe("the teacher's More has Send feedback", () => {
  it("in Account, between My profile and Log out, opening the teacher's own feedback page", () => {
    render(<MemoryRouter initialEntries={[MORE]}><More /></MemoryRouter>);
    expect(rows()).toEqual(["more-row-language", "more-row-profile", "more-row-feedback", "more-row-logout"]);
    const row = screen.getByTestId("more-row-feedback");
    expect(row).toHaveTextContent("Send feedback");
    expect(row).toHaveAttribute("href", "/portal/teacher/more/feedback");
    expect(TEACHER_FEEDBACK_PATH).toBe("/portal/teacher/more/feedback");
  });

  it("in Urdu too, with the coach's words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<MemoryRouter initialEntries={[MORE]}><More /></MemoryRouter>);
    expect(screen.getByTestId("more-row-feedback")).toHaveTextContent("رائے بھیجیں");
  });

  it("a principal on the teacher app sees the same row (her More is the teacher's)", () => {
    signedInAs("principal");
    render(<MemoryRouter initialEntries={[MORE]}><More /></MemoryRouter>);
    expect(screen.getByTestId("more-row-feedback")).toHaveAttribute("href", TEACHER_FEEDBACK_PATH);
  });
});

describe("the teacher's feedback page", () => {
  it("is a registered teacher route (TeacherGate: teachers and principals on the teacher app), not a leaders' page", () => {
    const route = TEACHER_ROUTES.find((r) => r.path === TEACHER_FEEDBACK_PATH);
    expect(route).toBeDefined();
    expect(route?.leaders).toBeFalsy();
  });

  it("keeps More current in the teacher's menu and the principal's", () => {
    expect(currentMenuItem(TEACHER_FEEDBACK_PATH)).toBe("more");
    expect(currentPrincipalMenuItem(TEACHER_FEEDBACK_PATH)).toBe("more");
  });

  it("is the coach's form; Send stores it as sent from the teacher's More, Done goes back there", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[MORE, TEACHER_FEEDBACK_PATH]} initialIndex={1}>
        <Routes>
          <Route path={TEACHER_FEEDBACK_PATH} element={<TeacherFeedback />} />
          <Route path={MORE} element={<div>TEACHER MORE</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Send feedback" })).toBeInTheDocument();
    for (const t of ["Something isn’t working", "Numbers look wrong", "An idea", "Something else"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${t}`) })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: /^Numbers look wrong/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("textbox", { name: "Or write here" }), "Attendance shows 0 present");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(portal.sendFeedback).toHaveBeenCalledWith({
      topic: "numbers", text: "Attendance shows 0 present", audioKey: undefined, photoKeys: [], page: MORE, context: {},
    });
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.getByText("TEACHER MORE")).toBeInTheDocument();
  });
});
