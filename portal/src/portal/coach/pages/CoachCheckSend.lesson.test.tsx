import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn() },
  portal: {},
}));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));

import { coach, leader } from "../../services/api";
import { sendObservation } from "../../lib/coachObserve";
import CoachCheckSend from "./CoachCheckSend";
import CoachSending from "./CoachSending";
import { setDraft, clearDraft } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";

/**
 * bd-ra8xu.40 — Check and send asks the lesson's class (and, for grades 6-12, its subject) when FDE's switch is on for the
 * coach, exactly as WhatsApp's visit planner asks it after Start: the answer decides the rubric the observation is
 * stamped with (grades 1-5 FICO, grades 6-12 FDE's tool). Switch off: nothing is asked and nothing extra is sent.
 */
const C = coach as any;
const L = leader as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000003";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
const ASK = { ask: true, grades: [6, 7, 8, 9, 10, 11, 12], subjects: ["english", "urdu", "maths", "science", "social_studies", "islamiat", "computer", "other"] };

const renderCheck = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/check`]}>
    <Routes>
      <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
      <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

const choose = async (field: RegExp, option: string) => {
  fireEvent.click(await screen.findByRole("button", { name: field }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByText(option));
};

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  clearDraft(VISIT_ID);
  setDraft(VISIT_ID, {
    blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation.webm", durationMs: 2520000,
    recordingId: null, label: "Ayesha Bibi’s observation", sub: "42 min",
  });
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: [] });
  send.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); });

describe("Check and send — the lesson's class (bd-ra8xu.40)", () => {
  it("FDE off: no class question, and the observation is sent with no lesson", async () => {
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    await waitFor(() => expect(L.getObserveLessonQuestion).toHaveBeenCalled());
    expect(screen.queryByText("Class and subject")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson ?? null).toBeNull();
  });

  it("the question cannot be read: nothing is asked (today's path)", async () => {
    L.getObserveLessonQuestion.mockRejectedValue(new Error("down"));
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    await waitFor(() => expect(L.getObserveLessonQuestion).toHaveBeenCalled());
    expect(screen.queryByText("Class and subject")).toBeNull();
  });

  it("FDE on: Send waits for the class; grades 1-5 is sent as primary", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    expect(await screen.findByText("Class and subject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    expect(await screen.findByText("Choose the class first")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    await choose(/^Class,/, "Grade 1-5");
    expect(screen.queryByRole("button", { name: /^Subject,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ primary: true });
  });

  it("FDE on, grade 7: the subject is asked too, and both are sent", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    expect(await screen.findByText("Choose the subject first")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    await choose(/^Subject,/, "Maths");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 7, subject: "maths" });
  });
});
