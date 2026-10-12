import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn() },
  portal: {},
}));
const rec = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock("../../lib/useCoachRecording", () => ({
  useCoachRecording: (opts: { onStarted?: (id: string) => void }) => {
    opts.onStarted?.("rec-1");
    return { recording: true, paused: false, elapsed: 60000, level: 0.4, screenWentOff: false, micBlocked: false, togglePause: vi.fn(), finish: rec.finish, elapsedNow: () => 60000 };
  },
}));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));

import { coach, leader } from "../../services/api";
import CoachVisit from "./CoachVisit";
import CoachRecord from "./CoachRecord";
import CoachCheckSend from "./CoachCheckSend";
import CoachSending from "./CoachSending";
import { clearDraft } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";

/**
 * bd-fmf24g.68 — Back in coach v2 goes to the last screen, and never to a transient one.
 *
 *   - a page's Back arrow is a step back in history, not its fixed parent, when something in the app is behind it;
 *   - Visit → Record → Stop → Check and send → Send observation → Sending: stepping back from Sending (the arrow, or the
 *     phone's own back) lands on the Visit — not on the finished recording, not on Check and send (which would bounce
 *     straight on to Sending again).
 */
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
  lastVisit: null,
};
const VISIT_PATH = `/portal/coach/visit/${VISIT_ID}`;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}
function PhoneBack() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>phone back</button>;
}
function renderAt(entries: string[], index?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
        <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
        <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
        <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
      <Where /><PhoneBack />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:30:00+05:00"));
  clearDraft(VISIT_ID);
  (coach as unknown as { getVisit: ReturnType<typeof vi.fn> }).getVisit.mockResolvedValue(VISIT);
  (leader as unknown as { getObserveRecentPlans: ReturnType<typeof vi.fn> }).getObserveRecentPlans.mockResolvedValue({ plans: [] });
});
afterEach(() => { vi.useRealTimers(); });

describe("coach Back", () => {
  it("a page's arrow goes to the screen before it, not to its fixed parent", async () => {
    renderAt(["/portal/coach/schedule", VISIT_PATH], 1);
    fireEvent.click(await screen.findByRole("link", { name: "Back" }));
    expect(where()).toBe("/portal/coach/schedule"); // the Visit page's fixed parent is /portal/coach/observe/pick
  });

  it("opened with nothing behind it (a link from WhatsApp), the arrow goes to the fixed parent", async () => {
    renderAt([VISIT_PATH]);
    fireEvent.click(await screen.findByRole("link", { name: "Back" }));
    expect(where()).toBe("/portal/coach/observe/pick");
  });

  it("Visit → Record → Stop → Check and send → Send → Sending: Back from Sending is the Visit; no finished recording, no bounce", async () => {
    rec.finish.mockResolvedValue({ id: "rec-1", blob: new Blob(["x"], { type: "audio/webm" }), durationMs: 60000, type: { ext: ".webm", mime: "audio/webm" } });
    renderAt(["/portal/coach/schedule", VISIT_PATH], 1);
    fireEvent.click(await screen.findByRole("link", { name: "Start recording" }));
    await screen.findByRole("timer");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, stop/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Send observation" }));
    await screen.findByTestId("send-state");
    expect(where()).toBe(`${VISIT_PATH}/sending`);

    fireEvent.click(screen.getByRole("button", { name: "phone back" }));
    expect(where()).toBe(VISIT_PATH);
    fireEvent.click(screen.getByRole("button", { name: "phone back" }));
    expect(where()).toBe("/portal/coach/schedule");
  });
});
