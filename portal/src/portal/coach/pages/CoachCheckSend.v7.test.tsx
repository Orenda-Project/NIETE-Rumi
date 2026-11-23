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
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

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
const ASK = { ask: true, grades: [6, 7, 8, 9, 10, 11, 12], subjectGrades: [6, 7, 8], subjects: ["english", "urdu", "maths", "science", "social_studies", "islamiat", "computer", "other"] };

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


/*
 * bd-o15qnr.29 (the operator 21 Nov ~09:00: "it asks for Grade Subject in a weird chips type way. Make it how it used to
 * be") — with the v6/v7 switch on, the class question is the dropdowns again, exactly as with the switch off: Class
 * (Grade 1-5, Grade 6 … 12), then Subject for the grades that ask it. No chips. Same answers, same lesson sent.
 */
describe("Check and send, v7: the class question as it used to be (dropdowns, no chips)", () => {
  beforeEach(() => { flow.on = true; });

  it("Class and subject, the Class dropdown; no chips, no 'Which class was it?'", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    // the file's first render loads the page's chunk cold: 8 s under a loaded machine (as v7visit39)
    expect(await screen.findByText("Class and subject", undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Class,/ })).toBeTruthy();
    expect(screen.queryByText("Which class was it?")).toBeNull();
    expect(screen.queryByRole("radio", { name: "1–5" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "7" })).toBeNull();
  });

  it("Grade 7 asks the subject, and both are sent", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    expect(await screen.findByText("Choose the subject first")).toBeTruthy();
    await choose(/^Subject,/, "Maths");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 7, subject: "maths" });
  });

  it("Grade 9 is the class alone (no subject asked)", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    await choose(/^Class,/, "Grade 9");
    expect(screen.queryByRole("button", { name: /^Subject,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 9 });
  });

  it("switch off: the dropdowns, as on production (Grade 1-5 is primary)", async () => {
    flow.on = false;
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    expect(await screen.findByText("Class and subject")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Class,/ })).toBeTruthy();
    expect(screen.queryByText("Which class was it?")).toBeNull();
    await choose(/^Class,/, "Grade 1-5");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ primary: true });
  });
});

/*
 * bd-o15qnr.40.3 (queue #229, the operator 23 Nov ~15:20): the Class list showed "Grade 1-5" as one row, then 6, 7, 8 …
 * each on its own. With the switch on every grade is its own row (Grade 1 … Grade 12, in order); the rubric is still
 * picked from the grade behind the scenes: a grade 1-5 goes up as { primary: true } (FICO17 v6), 6-12 as before.
 */
describe("Check and send, v7: every grade on its own (bd-o15qnr.40.3)", () => {
  beforeEach(() => { flow.on = true; });

  it("the Class list is Grade 1 … Grade 12, one row each; no 'Grade 1-5'", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: /^Class,/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Grade 1-5")).toBeNull();
    const shown = within(dialog).getAllByText(/^Grade \d+$/).map((el) => el.textContent);
    expect(shown).toEqual(Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`));
  });

  it("Grade 3: no subject asked, sent as the grades 1-5 class (primary), named Grade 3 on the page", async () => {
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    await choose(/^Class,/, "Grade 3");
    expect(screen.queryByRole("button", { name: /^Subject,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Class,/ })).toHaveTextContent("Grade 3");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].lesson).toEqual({ primary: true });
  });

  it("Urdu: جماعت ۱ … one row each, no «جماعت ۱ تا ۵»", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObserveLessonQuestion.mockResolvedValue(ASK);
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: /^جماعت/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("جماعت ۱ تا ۵")).toBeNull();
    // the kit isolates the digits (LRI … PDI) so they read left to right inside the Urdu line
    const rows = within(dialog).getAllByText(/^جماعت ./).map((el) => (el.textContent || "").replace(/[\u2066-\u2069]/g, ""));
    expect(rows).toEqual(Array.from({ length: 12 }, (_, i) => `جماعت ${i + 1}`));
  });
});

/*
 * bd-o15qnr.40.2 (queue #229, the operator 23 Nov ~15:20): Check and send played the recording on the old card (play and
 * pause only). With the switch on it is #204's full player, as on the visit and the debrief: a bar to drag, the time and
 * the length, back / forward 10 s and the speed (1× → 1.5× → 2× → 4×). Switch off: the card as on production.
 */
describe("Check and send, v7: the full player (bd-o15qnr.40.2)", () => {
  it("switch on: the recording has the bar, back / forward 10 s and the speed", async () => {
    flow.on = true;
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderCheck();
    const player = await screen.findByTestId("check-recording");
    expect(within(player).getByRole("slider", { name: "Position" })).toBeTruthy();
    expect(within(player).getByRole("button", { name: "Back 10 s" })).toBeTruthy();
    expect(within(player).getByRole("button", { name: "Forward 10 s" })).toBeTruthy();
    expect(within(player).getByRole("button", { name: /Playback speed/ })).toBeTruthy();
    expect(within(player).getByRole("button", { name: /Record again|Redo/i })).toBeTruthy();
  });

  it("switch off: the plain card, no bar", async () => {
    flow.on = false;
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderCheck();
    await screen.findByRole("button", { name: "Send observation" });
    expect(screen.queryByRole("slider", { name: "Position" })).toBeNull();
  });
});
