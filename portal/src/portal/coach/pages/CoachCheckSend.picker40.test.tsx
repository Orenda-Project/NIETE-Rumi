import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr.40.7 (queue #229, REGRESSION P0; the operator 23 Nov ~19:20-19:22: "ON HITL IT IS JUST SHOWING ACCEPTING
 * GRADE AND NOT SUBJECT" and "WE ALREADY HAVE A PICKER FOR GRADE SUBJECT ON THE LESSON PLAN JUST USE THAT") — on the
 * v6/v7 switch, Check and send's class step is the Lesson Plan screen's own grade + subject picker (the kit's
 * ClassPicker, fed by the same live lesson-plan catalogue): one card, "Select grade and subject"; its tray lists the
 * grades, then the picked grade's subjects; the card then reads "Grade 7 · English". Grade AND subject go to the bot
 * (grades 1-5 as the grades 1-5 class, as before; 6-12 with the subject's key), and the plans offered narrow by both.
 * Coach and principal alike (one page). Switch off: the dropdowns, as on production before the switch.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn() },
  portal: {},
}));
const lp = vi.hoisted(() => ({ catalogue: vi.fn() }));
vi.mock("../../newui/lessons/lessonPlansApi", async (orig) => {
  const real = await orig<typeof import("../../newui/lessons/lessonPlansApi")>();
  return { ...real, lessonPlans: { ...real.lessonPlans, catalogue: lp.catalogue } };
});
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { coach, leader } from "../../services/api";
import { sendObservation } from "../../lib/coachObserve";
import CoachCheckSend from "./CoachCheckSend";
import CoachSending from "./CoachSending";
import { setDraft, clearDraft } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";
import { COACH_OBSERVE_ROUTES, ObserveRoutesProvider } from "../observe/observeRoutes";

vi.setConfig({ testTimeout: 30_000 });
const C = coach as any;
const L = leader as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000040";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
/** FICO-S on (production): every grade 6-12 asks its subject. */
const ASK = { ask: true, rubric: "fico_s", grades: [6, 7, 8, 9, 10, 11, 12], subjectGrades: [6, 7, 8, 9, 10, 11, 12], subjects: ["english", "urdu", "maths", "science", "social_studies", "islamiat", "computer", "other"] };
const subj = (...names: string[]) => names.map((name, i) => ({ key: `k${i}`, name }));
const CATALOGUE = {
  grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  byGrade: {
    1: subj("English", "Urdu", "Math"), 2: subj("English", "Urdu", "Math"), 3: subj("English", "Urdu", "Math", "General Science"),
    4: subj("English", "Urdu", "Math", "General Science"), 5: subj("English", "Urdu", "Math", "General Science"),
    6: subj("English", "Urdu", "Mathematics", "Science"), 7: subj("English", "Urdu", "Mathematics", "Science"), 8: subj("English", "Mathematics"),
    9: subj("Physics", "English"), 10: subj("Physics", "English"),
  },
};
const dl = (assetId: string, topic: string, grade: number | string, subject: string, day: string) =>
  ({ own: false, assetId, ownId: null, lessonId: null, topic, grade, subject, chapterNumber: null, downloadedAt: `2026-11-${day}T08:00:00Z` });
const RECENT = [
  dl("a1", "Ratios", 7, "Mathematics", "20"), dl("a2", "Nouns", 7, "English", "19"), dl("a3", "Describing words", 3, "english", "14"),
  dl("a4", "Halves", 3, "math", "13"), dl("a5", "Plants", 4, "General Science", "12"),
];
const PRINCIPAL_ROUTES = { ...COACH_OBSERVE_ROUTES, coachGate: false, showScores: false };

const renderCheck = (principal = false) => render(
  <ObserveRoutesProvider value={principal ? PRINCIPAL_ROUTES : COACH_OBSERVE_ROUTES}>
    <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/check`]}>
      <Routes>
        <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
        <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>
  </ObserveRoutesProvider>,
);
/** The picker's card, by what it says now: "Select grade and subject", or the pair picked ("Grade 7 · English"). */
const trigger = () => screen.findByRole("button", { name: /Select grade and subject|Grade \d+ · / }, { timeout: 8000 });
const pick = async (grade: number, subject: string) => {
  fireEvent.click(await trigger());
  const tray = await screen.findByRole("dialog", { name: "Select grade and subject" });
  fireEvent.click(within(tray).getByRole("radio", { name: new RegExp(`^Grade ${grade}\\b`) }));
  fireEvent.click(await within(tray).findByRole("button", { name: new RegExp(`Grade ${grade} · ${subject}`) }));
};

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  clearDraft(VISIT_ID);
  setDraft(VISIT_ID, { blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation.webm", durationMs: 2520000, recordingId: null, label: "Ayesha Bibi’s observation", sub: "42 min" });
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: RECENT });
  L.getObserveLessonQuestion.mockResolvedValue(ASK);
  lp.catalogue.mockResolvedValue(CATALOGUE);
  send.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); });

describe("Check and send, v7: the Lesson Plan screen's grade + subject picker (bd-o15qnr.40.7)", () => {
  it("one card, Select grade and subject; no Class / Subject dropdowns", async () => {
    renderCheck();
    expect(await screen.findByRole("button", { name: /Select grade and subject/ }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Class,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Subject,/ })).toBeNull();
  });

  it("6-12: grade then subject; the card reads Grade 7 · English; both go to the bot", async () => {
    renderCheck();
    await pick(7, "English");
    expect(await screen.findByRole("button", { name: /Grade 7 · English/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 7, subject: "english" });
  });

  it("a subject named its own way is sent as the question's key (Mathematics → maths; Physics → science)", async () => {
    renderCheck();
    await pick(9, "Physics");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 9, subject: "science" });
  });

  // the operator 23 Nov ~19:45: every grade asks the subject; 1-5 goes as the grades 1-5 class (FICO17 v6) WITH its
  // grade and subject, which the bot keeps on the visit
  it("1-5: grade and subject picked; the bot gets the grades 1-5 class with its grade and subject", async () => {
    renderCheck();
    await pick(3, "Math");
    expect(await screen.findByRole("button", { name: /Grade 3 · Math/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ primary: true, grade: 3, subject: "maths" });
  });

  it("every grade 1-12 the catalogue has is offered, each then asks its subject", async () => {
    renderCheck();
    fireEvent.click(await trigger());
    const tray = await screen.findByRole("dialog", { name: "Select grade and subject" });
    for (const g of [1, 3, 5, 7, 9]) {
      fireEvent.click(within(tray).getByRole("radio", { name: new RegExp(`^Grade ${g}\\b`) }));
      expect(within(tray).getAllByRole("button", { name: new RegExp(`Grade ${g} · `) }).length).toBeGreaterThan(0);
    }
  });

  it("the plans offered narrow by grade AND subject (6-12 and 1-5)", async () => {
    renderCheck();
    await pick(7, "Mathematics");
    fireEvent.click(await screen.findByText(/NIETE lesson plan/));
    let tray = await screen.findByRole("dialog");
    expect(await within(tray).findByText("Ratios")).toBeInTheDocument();
    expect(within(tray).queryByText("Nouns")).toBeNull();
    fireEvent.click(within(tray).getByRole("button", { name: /Close/ }));
    await pick(3, "Math");
    fireEvent.click(await screen.findByText(/NIETE lesson plan/));
    tray = await screen.findByRole("dialog");
    expect(await within(tray).findByText("Halves")).toBeInTheDocument();
    expect(within(tray).queryByText("Describing words")).toBeNull();
    expect(within(tray).queryByText("Plants")).toBeNull();
  });

  it("nothing picked: Send asks for the class first", async () => {
    renderCheck();
    await trigger();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    expect(await screen.findByText("Choose the class first")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("the principal: the same picker, grade and subject sent", async () => {
    renderCheck(true);
    await pick(6, "Science");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 6, subject: "science" });
  });

  it("Urdu: جماعت اور مضمون چنیں", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderCheck();
    expect(await screen.findByRole("button", { name: /جماعت اور مضمون چنیں/ }, { timeout: 8000 })).toBeInTheDocument();
  });

  it("the catalogue cannot be read: the dropdowns, grade then subject, as a fallback", async () => {
    lp.catalogue.mockRejectedValue(new Error("down"));
    renderCheck();
    expect(await screen.findByRole("button", { name: /^Class,/ }, { timeout: 8000 })).toBeInTheDocument();
  });

  it("switch off: the dropdowns, as before", async () => {
    flow.on = false;
    renderCheck();
    expect(await screen.findByRole("button", { name: /^Class,/ }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select grade and subject/ })).toBeNull();
  });
});
