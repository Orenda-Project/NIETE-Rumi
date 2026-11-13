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
 * bd-snkn32.41 — "Their recent plans" on Check and send lists the plans the teacher MADE with Make my own beside the
 * ones she downloaded, each marked "Made by her"; picking one sends { ownId } and the bot puts her PDF in as the plan.
 */
const C = coach as any;
const L = leader as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000003";
const OWN_ID = "0e0e0000-0000-4000-8000-0000000000aa";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
const PLANS = [
  { assetId: "a1", lessonId: "l1", topic: "Fractions", grade: 4, subject: "Maths", chapterNumber: 5, dayLabel: null, pagesLabel: null, downloadedAt: "2026-11-13T09:00:00Z" },
  { own: true, ownId: OWN_ID, lessonId: "grade_3_english_ch4_seg1", topic: "Describing words", grade: 3, subject: "english", chapterNumber: "4", madeAt: "2026-11-12T08:00:00Z" },
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
  L.getObserveRecentPlans.mockResolvedValue({ plans: PLANS });
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
  send.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); });

describe("Check and send — her own Make my own plans (bd-snkn32.41)", () => {
  it("lists her own plan, marked Made by her with grade, subject and chapter", async () => {
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: /Their recent plans/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Describing words")).toBeTruthy();
    expect(within(dialog).getByText("Made by her · Grade 3 · english · Ch 4")).toBeTruthy();
    expect(within(dialog).getByText("Fractions")).toBeTruthy();
  });

  it("picking it sends { ownId } as the observation's plan", async () => {
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: /Their recent plans/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByText("Describing words"));
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toEqual({ kind: "library", pick: { ownId: OWN_ID } });
  });
});
