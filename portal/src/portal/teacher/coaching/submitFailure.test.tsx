import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-bmc9a0.1 — ICT IAB rows 28–29: on the DC one screen, Submit said "No internet" on strong Wi-Fi.
 *
 * "No internet" is said only when the phone IS offline. Any other failed send names the part that did not go
 * (Recording / Lesson plan / Photo N), with Try again; a recording the phone cannot open says so and offers Change
 * file. Try again hands sendLesson the same record of what already arrived, so only the rest is sent.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(async () => ({ id: "sess-1", status: "analysing", stage: "analysing", reflection: null })),
  submitCoachingReflection: vi.fn(async () => ({ acknowledgement: "Thank you" })),
  getCoachingSession: vi.fn(),
  answerClassCheck: vi.fn(async (..._a: unknown[]) => ({ next: "analysis" })),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
const sendLesson = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ coachingSessionId: "sess-1" })));
vi.mock("../../lib/coachingSend", async (orig) => ({ ...(await orig<typeof import("../../lib/coachingSend")>()), sendLesson }));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(async () => null),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../../lib/coachingUpload", async (orig) => ({
  ...(await orig<typeof import("../../lib/coachingUpload")>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import coachingRoutes from "./routes";
import { COACHING_NEW } from "./paths";
import { clearDraft } from "./draft";
import { SendError, type SendDetail } from "../../lib/coachingSend";
import { COACHING_V2_COPY as C } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
let online = true;

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const answers: Record<string, () => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", featureKey: "general_science", source: "class", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [] }),
    "/teacher/coaching/history": () => ({ success: true, items: [], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 0 }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
    "/lp612/grades": () => ({ grades: [] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "general_science", subject: "General Science", lesson_count: 40 }] }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}
function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const m4a = () => new File(["a"], "lesson.m4a", { type: "audio/mp4" });

async function submitted() {
  at(COACHING_NEW);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
  fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
  fireEvent.click(await screen.findByRole("button", { name: C.submit }));
}

const failed = (detail: SendDetail) => new SendError("network", undefined, undefined, detail);
const audioPart = { kind: "audio" as const, photo: 0 };

describe("a failed Submit on the one screen (bd-bmc9a0.1)", () => {
  it("the recording did not go and the phone is online: it names the recording, never 'No internet'", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: audioPart, offline: false, unreadable: false }));
    await submitted();
    const card = await screen.findByRole("alert");
    expect(within(card).getByText(C.recordingNotSent)).toBeTruthy();
    expect(screen.queryByText(C.noInternet)).toBeNull();
  });

  it("Try again re-sends with the same record of what already arrived", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: { kind: "photo", photo: 3 }, offline: false, unreadable: false }));
    await submitted();
    const card = await screen.findByRole("alert");
    expect(within(card).getByText(C.photoNotSent(3))).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: C.tryAgain }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalledTimes(2));
    const first = (sendLesson.mock.calls[0][0] as { uploaded?: unknown }).uploaded;
    const second = (sendLesson.mock.calls[1][0] as { uploaded?: unknown }).uploaded;
    expect(first).toBeInstanceOf(WeakMap);
    expect(second).toBe(first);
  });

  it("the lesson plan did not go: it names the lesson plan", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: { kind: "lesson_plan", photo: 0 }, offline: false, unreadable: false }));
    await submitted();
    expect(within(await screen.findByRole("alert")).getByText(C.planNotSent)).toBeTruthy();
  });

  it("the phone is offline: No internet, with Try again", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: audioPart, offline: true, unreadable: false }));
    await submitted();
    const card = await screen.findByRole("alert");
    expect(within(card).getByText(C.noInternet)).toBeTruthy();
    expect(within(card).getByRole("button", { name: C.tryAgain })).toBeTruthy();
  });

  it("the recording will not open on this phone: it says so and offers Change file, not Try again", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: audioPart, offline: false, unreadable: true }));
    await submitted();
    const card = await screen.findByRole("alert");
    expect(within(card).getByText(C.recordingNotSent)).toBeTruthy();
    expect(within(card).getByText(C.fileWontOpen)).toBeTruthy();
    expect(within(card).getByRole("button", { name: C.changeFile })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: C.tryAgain })).toBeNull();
  });

  it("an unexpected failure while online is 'Not sent', not 'No internet'", async () => {
    sendLesson.mockRejectedValueOnce(new Error("boom"));
    await submitted();
    const card = await screen.findByRole("alert");
    expect(within(card).getByText(C.notSent)).toBeTruthy();
    expect(screen.queryByText(C.noInternet)).toBeNull();
  });
});
