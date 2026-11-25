import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-oe6r47 (queue #278): these tests cover the in-app recorder, so upload-only (default ON) is switched off here.
vi.mock("../observe/uploadOnly", () => ({ useUploadOnly: () => false, uploadOnlyOn: () => false }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn() },
  portal: {},
}));
const rec = vi.hoisted(() => ({
  state: { recording: true, paused: false, elapsed: 1122000, level: 0.4, screenWentOff: false, micBlocked: false },
  togglePause: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("../../lib/useCoachRecording", () => ({
  useCoachRecording: (opts: { onStarted?: (id: string) => void }) => {
    opts.onStarted?.("rec-1");
    return { ...rec.state, togglePause: rec.togglePause, finish: rec.finish, elapsedNow: () => rec.state.elapsed };
  },
}));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));

import { coach, leader } from "../../services/api";
import CoachRecord from "./CoachRecord";
import CoachCheckSend from "./CoachCheckSend";
import { clearDraft, getNotes } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";

/**
 * bd-ra8xu.60 (queue #127) — Observation Notes on Record: while the coach's observation_notes switch is on (the
 * lesson-question read says `observationNotes: true`), a card between the level meter and the linked visit takes what the
 * recording cannot hear, each note stamped with the recording clock; Stop carries them to Check and send with the audio.
 * Switch off (or the read fails): no card, the screen exactly as before.
 */
const C = coach as any;
const L = leader as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000005";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};

const renderRecord = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/record`]}>
    <Routes>
      <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
      <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

const notesCard = () => screen.findByRole("region", { name: "Observation Notes" });
const type = (box: HTMLElement, text: string) => {
  fireEvent.change(within(box).getByRole("textbox"), { target: { value: text } });
  fireEvent.click(within(box).getByRole("button", { name: "Add" }));
};

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:30:00+05:00"));
  clearDraft(VISIT_ID);
  rec.state = { recording: true, paused: false, elapsed: 1122000, level: 0.4, screenWentOff: false, micBlocked: false };
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: [] });
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false, observationNotes: true });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("Record — Observation Notes off (today's screen)", () => {
  it("switch off: no card, and nothing else is asked", async () => {
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderRecord();
    await screen.findByRole("timer");
    await waitFor(() => expect(L.getObserveLessonQuestion).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Observation Notes" })).toBeNull();
    expect(screen.queryByText("Observation Notes")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("linked-visit")).toBeInTheDocument();
  });

  it("the switch cannot be read: no card", async () => {
    L.getObserveLessonQuestion.mockRejectedValue(new Error("down"));
    renderRecord();
    await screen.findByRole("timer");
    await waitFor(() => expect(L.getObserveLessonQuestion).toHaveBeenCalled());
    expect(screen.queryByText("Observation Notes")).toBeNull();
  });
});

describe("Record — Observation Notes on", () => {
  it("the card sits between the level meter and the linked visit, with its hint and an empty box", async () => {
    renderRecord();
    const card = await notesCard();
    expect(card).toHaveTextContent("What the recording can't hear: the board, group work, who stayed quiet.");
    expect(within(card).getByRole("textbox")).toHaveAttribute("placeholder", "Type what you see…");
    expect(within(card).getByRole("button", { name: "Add" })).toBeInTheDocument();
    const meter = screen.getByTestId("level-meter");
    const linked = screen.getByTestId("linked-visit");
    expect(meter.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(linked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the timer and the dock are as before
    expect(screen.getByRole("timer")).toHaveTextContent("18:42");
    expect(screen.getByRole("button", { name: /Pause/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();
  });

  it("Add stamps each note with the recording clock, trimmed; a blank one is ignored", async () => {
    renderRecord();
    const card = await notesCard();
    type(card, "   Board work: fractions drawn as pizzas  ");
    rec.state = { ...rec.state, elapsed: 3_725_000 };
    type(card, "Group 3 stayed quiet");
    type(card, "    ");
    const notes = within(card).getAllByTestId("observation-note");
    expect(notes).toHaveLength(2);
    expect(within(notes[0]).getByTestId("note-clock")).toHaveTextContent("18:42");
    expect(notes[0]).toHaveTextContent("Board work: fractions drawn as pizzas");
    expect(within(notes[1]).getByTestId("note-clock")).toHaveTextContent("62:05");
    expect(within(card).getByRole("textbox")).toHaveValue("");
  });

  it("a note is cut at 600 characters, and 40 notes is the most", async () => {
    renderRecord();
    const card = await notesCard();
    type(card, "x".repeat(700));
    for (let i = 2; i <= 40; i += 1) type(card, `note ${i}`);
    const notes = within(card).getAllByTestId("observation-note");
    expect(notes).toHaveLength(40);
    expect(notes[0].textContent).toContain("x".repeat(600));
    expect(notes[0].textContent).not.toContain("x".repeat(601));
    expect(within(card).queryByRole("textbox")).toBeNull(); // full: nothing more to type into
    expect(within(card).queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("Stop: the notes go with the recording to Check and send", async () => {
    const blob = new Blob(["x"], { type: "audio/webm" });
    rec.finish.mockResolvedValue({ id: "rec-1", blob, durationMs: 1122000, type: { ext: ".webm", mime: "audio/webm" } });
    renderRecord();
    type(await notesCard(), "Board work: fractions drawn as pizzas");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    const ask = await screen.findByRole("dialog", { name: "Stop recording" });
    fireEvent.click(within(ask).getByRole("button", { name: /Yes, stop/ }));
    await screen.findByText("Ayesha Bibi’s observation");
    expect(getNotes(VISIT_ID)).toEqual([
      { text: "Board work: fractions drawn as pizzas", rec_time: "18:42", source: "portal_record", typed_at: "2026-10-06T04:30:00.000Z" },
    ]);
  });

  it("Urdu: the card's words, and the clock in Urdu digits kept left-to-right", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderRecord();
    const card = await screen.findByRole("region", { name: "مشاہدے کے نوٹس" });
    expect(card).toHaveTextContent("جو ریکارڈنگ میں سنائی نہیں دیتا: بورڈ، گروپ کا کام، کون خاموش رہا۔");
    fireEvent.change(within(card).getByRole("textbox"), { target: { value: "بورڈ پر کسریں" } });
    fireEvent.click(within(card).getByRole("button", { name: "شامل کریں" }));
    const clock = within(card).getByTestId("note-clock");
    expect(clock.textContent).toBe("⁦۱۸:۴۲⁩");
    expect(clock).toHaveAttribute("dir", "ltr");
    expect(within(card).getByTestId("observation-note")).toHaveTextContent("بورڈ پر کسریں");
  });
});
