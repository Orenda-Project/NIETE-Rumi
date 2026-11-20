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
import { setDraft, clearDraft, setNotes, getNotes } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";

/**
 * bd-ra8xu.60 (queue #127) — Observation Notes on Check and send, while the coach's switch is on: the notes typed on
 * Record (read only, each with its recording clock) and a box for anything remembered after Stop. Send carries them all
 * to POST /leader/observe/start; with none (or the switch off) the request has no `notes` key, as today.
 */
const C = coach as any;
const L = leader as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000006";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
const RECORD_NOTES = [
  { text: "Board work: fractions drawn as pizzas", rec_time: "12:40", source: "portal_record" as const, typed_at: "2026-10-06T04:20:00.000Z" },
  { text: "Group 3 stayed quiet", rec_time: "31:05", source: "portal_record" as const, typed_at: "2026-10-06T04:39:00.000Z" },
];

const renderCheck = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/check`]}>
    <Routes>
      <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
      <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);
const sendNow = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
  await waitFor(() => expect(send).toHaveBeenCalled());
  return send.mock.calls[0][0];
};

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00+05:00"));
  clearDraft(VISIT_ID);
  setDraft(VISIT_ID, {
    blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation.webm", durationMs: 2520000,
    recordingId: null, label: "Ayesha Bibi’s observation", sub: "42 min",
  });
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: [] });
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false, observationNotes: true });
  send.mockImplementation(() => new Promise(() => {}));
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("Check and send — Observation Notes off (today's screen)", () => {
  it("switch off: no notes box, and the send has no notes key", async () => {
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    await waitFor(() => expect(L.getObserveLessonQuestion).toHaveBeenCalled());
    expect(screen.queryByText("Observation Notes")).toBeNull();
    expect(screen.queryByLabelText("Anything else you saw?")).toBeNull();
    expect(await sendNow()).not.toHaveProperty("notes");
  });
});

describe("Check and send — Observation Notes on", () => {
  it("the Record notes, read only with their clocks, and a box for anything else; no class question unless asked", async () => {
    setNotes(VISIT_ID, RECORD_NOTES);
    renderCheck();
    const box = await screen.findByRole("region", { name: "Observation Notes" });
    const notes = within(box).getAllByTestId("observation-note");
    expect(notes).toHaveLength(2);
    expect(within(notes[0]).getByTestId("note-clock")).toHaveTextContent("12:40");
    expect(notes[0]).toHaveTextContent("Board work: fractions drawn as pizzas");
    expect(within(notes[1]).getByTestId("note-clock")).toHaveTextContent("31:05");
    expect(within(box).getByLabelText("Anything else you saw?").tagName).toBe("TEXTAREA");
    expect(within(box).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.queryByText("Class and subject")).toBeNull();
  });

  it("Send carries the Record notes and those added here (no clock, one per line)", async () => {
    setNotes(VISIT_ID, RECORD_NOTES);
    renderCheck();
    const box = await screen.findByRole("region", { name: "Observation Notes" });
    fireEvent.change(within(box).getByLabelText("Anything else you saw?"), { target: { value: "  Chart on the wall was from last term \n\n Two children shared one book " } });
    fireEvent.click(within(box).getByRole("button", { name: "Add" }));
    const notes = within(box).getAllByTestId("observation-note");
    expect(notes).toHaveLength(4);
    expect(within(notes[2]).queryByTestId("note-clock")).toBeNull();
    expect(within(box).getByLabelText("Anything else you saw?")).toHaveValue("");
    const args = await sendNow();
    const typedAt = "2026-10-06T05:00:00.000Z";
    expect(args.notes).toEqual([
      ...RECORD_NOTES,
      { text: "Chart on the wall was from last term", source: "portal_check", typed_at: typedAt },
      { text: "Two children shared one book", source: "portal_check", typed_at: typedAt },
    ]);
    expect(args.notes[2]).not.toHaveProperty("rec_time");
  });

  it("on, but nothing typed: the send has no notes key", async () => {
    renderCheck();
    await screen.findByRole("region", { name: "Observation Notes" });
    fireEvent.change(screen.getByLabelText("Anything else you saw?"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryAllByTestId("observation-note")).toEqual([]);
    expect(await sendNow()).not.toHaveProperty("notes");
  });

  it("once the observation is sent, its notes are let go with the recording", async () => {
    let finish!: (v: { coachingSessionId: string }) => void;
    send.mockImplementation(() => new Promise((res) => { finish = res; }));
    setNotes(VISIT_ID, RECORD_NOTES);
    renderCheck();
    await screen.findByRole("region", { name: "Observation Notes" });
    await sendNow();
    await act(async () => { finish({ coachingSessionId: "cs-1" }); });
    expect(getNotes(VISIT_ID)).toEqual([]);
  });

  it("with the class question: both are asked", async () => {
    L.getObserveLessonQuestion.mockResolvedValue({ ask: true, grades: [6, 7], subjectGrades: [6, 7], subjects: ["maths"], observationNotes: true });
    renderCheck();
    expect(await screen.findByText("Class and subject")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Observation Notes" })).toBeInTheDocument();
  });

  it("Urdu: the box's words, and the clock in Urdu digits kept left-to-right", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    setNotes(VISIT_ID, RECORD_NOTES);
    renderCheck();
    const box = await screen.findByRole("region", { name: "مشاہدے کے نوٹس" });
    expect(within(box).getByLabelText("اور کچھ جو آپ نے دیکھا؟")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "شامل کریں" })).toBeInTheDocument();
    expect(within(box).getAllByTestId("note-clock")[0].textContent).toBe("⁦۱۲:۴۰⁩");
  });
});
