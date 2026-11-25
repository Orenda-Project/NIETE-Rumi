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
 * bd-r2uzg1.23.3 (queue #274, ICT sheet IAB Experience View 16; the operator 25 Nov ~17:08: "On the max photos, make them
 * 10", and his issue list item 3: "raise the image limit ... allow selecting several images at once"). A coach's or a
 * principal's Check and send takes up to TEN photos, several picked at once, the same as the teacher's own Digital
 * Coaching; the per-photo checks are unchanged. The WhatsApp photo step keeps its three.
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

const photo = (i: number) => new File([new Uint8Array([0xff, 0xd8, 0xff, i])], `board-${i}.jpg`, { type: "image/jpeg" });
const pick = async (files: File[]) => {
  const input = screen.getByTestId("photos-input") as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { files } }); });
};

describe("Check and send — up to ten photos, several at once (coach and principal)", () => {
  it("the Photos heading says up to 10, and the picker takes several files at once", async () => {
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    expect(screen.getByText("Up to 10")).toBeInTheDocument();
    expect(screen.queryByText("Up to 3")).toBeNull();
    expect((screen.getByTestId("photos-input") as HTMLInputElement).multiple).toBe(true);
  });

  it("four photos picked in one go are all kept (today the fourth was refused)", async () => {
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    await pick([1, 2, 3, 4].map(photo));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })).toHaveLength(4));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ten are kept and an eleventh is refused with the limit, so nothing past ten is ever sent", async () => {
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    await pick(Array.from({ length: 10 }, (_, i) => photo(i)));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })).toHaveLength(10));
    expect(screen.queryByTestId("photos-input")).not.toBeNull();
    await pick([photo(11)]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Up to 10 photos");
    expect(screen.getAllByRole("button", { name: /^Remove photo \d+$/ })).toHaveLength(10);
  });
});
