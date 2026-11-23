import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr.28 (queue #204, v7) — "error states with retry" (#188's board m9-errors: "Same card on every screen: red edge,
 * one plain line, one button that fixes it"), behind the v6/v7 switch:
 *
 *   1 Not sent yet        the visit, when its observation did not reach the server: "Your 41-minute recording is saved on
 *                         this phone." and Send it now (the sender sends it again, then the Sending page)
 *   2 Couldn't send       the Sending page: the reason and "Nothing is lost." in the red-edged card (Try again stays)
 *   3 No guide this time  the Debrief: "You can still record the debrief; the feedback comes as usual.", Try again, and
 *                         Record without the guide
 *   Analysis failed       the visit's stopped card: "We could not analyse this recording" / "Your recording is safe on this
 *                         visit." (v7.test.tsx pins its place)
 *
 * Switch off: every screen as today.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn(), getPending: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObservation: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn() },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../../lib/recordingSupport", () => ({ canRecordHere: () => Promise.resolve(true) }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../components/coaching/coach/CoachRecorder", () => ({ default: ({ label }: { label: string }) => <div data-testid="recorder">{label}</div> }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on }));
const send = vi.hoisted(() => ({ job: null as Record<string, unknown> | null, retry: vi.fn(() => true) }));
vi.mock("../observe/sender", async (orig) => ({ ...(await orig<object>()), useSendJob: () => send.job, retrySend: send.retry }));

import { coach, leader } from "../../services/api";
import CoachVisit from "../pages/CoachVisit";
import CoachSending from "../pages/CoachSending";
import Debrief, { GUIDE_RETRY_MS } from "../reports/Debrief";

vi.setConfig({ testTimeout: 40_000 });
const C = coach as unknown as Record<string, ReturnType<typeof vi.fn>>;
const L = leader as unknown as Record<string, ReturnType<typeof vi.fn>>;
const VISIT = { id: "v1", teacherName: "Lubna Arif", teacherExtId: "923001110001", schoolName: "IMSG G-7/3", schoolExtId: "niete:110", scheduledFor: "2026-11-19", scheduledSlot: "10:30", status: "upcoming" };
const JOB = (extra: Record<string, unknown> = {}) => ({
  visitId: "v1", teacherExtId: "923001110001", schoolExtId: "niete:110", teacherName: "Lubna Arif", visitDay: "2026-11-19",
  durationMs: 41 * 60_000, recordingId: "rec-1", state: "failed", pct: 62, planKind: null, observationId: null, errorCode: "network", ...extra,
});
const VIEW = { id: "cs-1", createdAt: "2026-11-19T06:30:00Z", sessionStatus: "x", step: "talk", problem: null, preparing: false, portal: true,
  teacher: { name: "Lubna Arif", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Lubna Arif", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null } };

function at(path: string, route: string, el: JSX.Element, more: JSX.Element[] = []) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} />{more}</Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  flow.on = true;
  send.job = null;
  C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: null, visit: VISIT });
  L.getObservation.mockResolvedValue(VIEW);
});
afterEach(() => { vi.useRealTimers(); });

describe("1 · Not sent yet (the visit)", () => {
  it("the recording did not reach the server: the red card, how long it is, Send it now sends it again", async () => {
    send.job = JOB();
    at("/portal/coach/visit/v1", "/portal/coach/visit/:id", <CoachVisit />, [
      <Route key="s" path="/portal/coach/visit/:id/sending" element={<div>sending page</div>} />,
    ]);
    const card = await screen.findByTestId("error-not-sent");
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByText("Not sent yet")).toBeTruthy();
    expect(within(card).getByText("Your 41-minute recording is saved on this phone.")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Send it now" }));
    expect(send.retry).toHaveBeenCalledWith("v1");
    expect(await screen.findByText("sending page")).toBeTruthy();
  });

  it("switch off: no card (the visit as today)", async () => {
    flow.on = false;
    send.job = JOB();
    at("/portal/coach/visit/v1", "/portal/coach/visit/:id", <CoachVisit />);
    await screen.findByTestId("teacher-card");
    expect(screen.queryByTestId("error-not-sent")).toBeNull();
  });
});

describe("2 · Couldn't send (the Sending page)", () => {
  it("the reason and Nothing is lost, in the red-edged card; Try again stays", async () => {
    send.job = JOB();
    at("/portal/coach/visit/v1/sending", "/portal/coach/visit/:id/sending", <CoachSending />);
    const card = await screen.findByTestId("error-couldnt-send");
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByText("Couldn't send")).toBeTruthy();
    expect(card.textContent).toMatch(/Nothing is lost\./);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("switch off: today's line", async () => {
    flow.on = false;
    send.job = JOB();
    at("/portal/coach/visit/v1/sending", "/portal/coach/visit/:id/sending", <CoachSending />);
    await screen.findByTestId("send-state");
    expect(screen.queryByTestId("error-couldnt-send")).toBeNull();
  });
});

describe("3 · No guide this time (the Debrief)", () => {
  const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

  it("the red card: record anyway, Try again, Record without the guide", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getTalkGuide.mockRejectedValue(fail(502));
    at("/portal/coach/observation/cs-1/debrief", "/portal/coach/observation/:id/debrief", <Debrief />);
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    for (const ms of GUIDE_RETRY_MS) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 100); });
    const card = await screen.findByTestId("guide-failed");
    expect(within(card).getByText("No guide this time")).toBeTruthy();
    expect(within(card).getByText("You can still record the debrief; the feedback comes as usual.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Record without the guide" }));
    expect(await screen.findByTestId("recorder")).toBeTruthy();
  });

  it("switch off: today's amber line", async () => {
    flow.on = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getTalkGuide.mockRejectedValue(fail(502));
    at("/portal/coach/observation/cs-1/debrief", "/portal/coach/observation/:id/debrief", <Debrief />);
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    for (const ms of GUIDE_RETRY_MS) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 100); });
    expect(await screen.findByText("Guide did not load")).toBeTruthy();
    expect(screen.queryByText("No guide this time")).toBeNull();
  });
});
