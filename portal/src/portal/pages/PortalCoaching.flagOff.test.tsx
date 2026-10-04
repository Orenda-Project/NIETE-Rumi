import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";

/**
 * bd-5rz1v.26 — the new Coaching screens ship behind `portal_new_ui`, and with the flag OFF
 * every coaching page must be exactly what it was.
 *
 * The snapshots in __snapshots__/ were recorded against the coaching pages as they were BEFORE
 * the new screens existed (the real layout and navigation included):
 *
 *   /portal/coaching               self-observation on (CoachingHome) and off (today's list)
 *   /portal/coaching/new           recording, check-and-send, and "not available"
 *   /portal/coaching/session/:id   LessonPage (report, question) and today's report page
 *   RecordingBar                   on the old menu, and with no menu
 *
 * Every flag-off state must render that same markup: the flag false, the flag absent from
 * /config, and /config failing (which also turns self-observation off). /config still loading
 * is the spinner it always was. A difference of one class name fails this test.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// A STABLE toast: the pages' fetch effects depend on it.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getDashboard: vi.fn(),
    getCoachingSessions: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
    getCoachingSession: vi.fn(),
    getCoachingProgress: vi.fn(),
    submitCoachingReflection: vi.fn(),
    getRecentLessonPlans: vi.fn(),
    presignCoachingUpload: vi.fn(),
    uploadToR2: vi.fn(),
    startCoachingUpload: vi.fn(),
  },
  auth: { logout: vi.fn() },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../lib/recordingSupport")>()),
  canRecordHere: vi.fn(async () => true),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
vi.mock("../lib/recordingStore", () => ({
  latestUnsent: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../lib/coachingUpload", async (orig) => ({
  ...(await orig<typeof import("../lib/coachingUpload")>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));
const recorder = vi.hoisted(() => ({
  id: "rec-live",
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), isPaused: vi.fn(), elapsedMs: vi.fn(), stop: vi.fn(), discard: vi.fn(),
}));
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import { latestUnsent } from "../lib/recordingStore";
import { handOffRecording, takeHandedOffRecording } from "../lib/lessonHandoff";
import { RecordingSessionProvider, type RecordingSession } from "../lib/recordingSession";
import RecordingBar from "../components/RecordingBar";
import PortalCoaching from "./PortalCoaching";
import PortalCoachingRecord from "./PortalCoachingRecord";
import PortalCoachingDetail from "./PortalCoachingDetail";

const api = vi.mocked(portal) as unknown as Record<string, ReturnType<typeof vi.fn>>;

type Mode = "off" | "absent" | "fails" | "loading";

function setConfig(mode: Mode, selfObservation: boolean) {
  const fn = api.getConfig;
  fn.mockReset();
  const base = { assessmentGenerator: false, assessmentGeneratorMessage: null, selfObservation };
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { ...base, newUi: false } });
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: base });
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const TEACHER = { id: "t-1", firstName: "Ayesha", lastName: "Khan", role: "teacher", phoneNumber: "920000000001" };

const done = (id: string, date: string, topic: string | null, subject: string | null, percentage: number | null) => ({
  id, date, session_date: date, duration: 1700, overallScore: 0, maxScore: 44, percentage, framework: "fico", topic, subject,
});
const active = (id: string, createdAt: string, stage: string, needsAnswer: boolean, topic: string | null = null) => ({
  id, createdAt, status: "x", stage, source: "portal", needsAnswer, topic, subject: null,
});

const DETAIL = {
  id: "cs-1", date: "2026-10-02T05:02:00Z", duration: 1680, status: "completed",
  overallScore: 30, maxScore: 44, percentage: 68, framework: "fico", topic: "Provinces of Pakistan", subject: "Social Studies",
  debriefAudioUrl: "https://r2/debrief.mp3", lessonAudioUrl: "https://r2/lesson.webm",
  reportUrl: "https://r2/report.png", reportFormat: "png",
  transcript: "[00:10] Teacher (UR): line 1\n\n[00:11] Student (UR): line 2",
  breakdown: { framework: "fico", language: "en", overall: 68, marks: 30, max: 44, groups: [
    { key: "a", domainKey: "a", name: "Children taking part", score: 9, max: 10, pct: 90, indicators: [] },
  ] },
  reflection: [{ question: "Which question made the children think most?", answer: "The map question", language: "en", asked_at: null, answered_at: null }],
  prioritizedAction: { action: "Ask a child to point on the map before you explain." },
  analysisData: {
    overall_score: { points: 30, max_points: 44, percentage: 68 },
    strengths: ["You used the map to start the lesson."],
    growth_opportunities: ["More children could answer."],
    recommendations: ["Ask a child to point on the map.", "Use names when you ask."],
  },
};

const progress = (stage: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", status: "x", stage, source: "portal", reflection: null, reportReady: stage === "done",
  shortRecording: false, hasLessonPlan: true, photoCount: 0, createdAt: "2026-10-02T05:02:00Z", ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  takeHandedOffRecording();
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  api.getDashboard.mockResolvedValue({ user: TEACHER });
  api.getCoachingSessions.mockResolvedValue({
    sessions: [
      done("c-sep", "2026-09-24T09:00:00Z", "Parts of a plant", "General Science", 30),
      done("c-oct1", "2026-10-01T09:00:00Z", "Reading: The Thirsty Crow", "English", 85),
      done("c-oct2", "2026-10-02T08:00:00Z", "Provinces of Pakistan", "Social Studies", 65),
    ],
    pagination: {},
  });
  api.getActiveCoachingSessions.mockResolvedValue({
    sessions: [
      active("a-oldest", "2026-10-01T07:00:00Z", "reflection", true, "Fractions"),
      active("a-analysing", "2026-10-02T10:40:00Z", "analysing", false),
    ],
  });
  api.getCoachingSession.mockResolvedValue({ session: DETAIL });
  api.getCoachingProgress.mockResolvedValue(progress("done"));
  api.getRecentLessonPlans.mockResolvedValue({ plans: [] });
  vi.mocked(latestUnsent).mockResolvedValue({
    meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T04:00:00Z", elapsedMs: 31 * 60_000, finished: false },
    blob: new Blob(["x"], { type: "audio/webm" }),
  });
  recorder.start.mockResolvedValue(undefined);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(12 * 60_000 + 34_000);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true });
});

async function renderAt(path: string, state: unknown, mode: Mode, selfObservation: boolean, before?: () => void) {
  resetNewUiMemory();
  setConfig(mode, selfObservation);
  before?.();
  const { container } = render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <RecordingSessionProvider>
        <Routes>
          <Route path="/portal/coaching" element={<PortalCoaching />} />
          <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
          <Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
  await settle();
  const html = normalise(container.innerHTML);
  cleanup();
  return html;
}

/** The markup for `mode`, and that every other flag-off state renders the same. */
async function pin(name: string, path: string, state: unknown, selfObservation: boolean, before?: () => void) {
  const off = await renderAt(path, state, "off", selfObservation, before);
  expect(off).toMatchSnapshot(name);
  expect(await renderAt(path, state, "absent", selfObservation, before), "absent").toBe(off);
  return off;
}

describe("bd-5rz1v.26 — flag off: Coaching is exactly what it was", () => {
  it("/portal/coaching with self-observation (CoachingHome)", { timeout: 30_000 }, async () => {
    await pin("coaching home", "/portal/coaching", null, true);
  });

  it("/portal/coaching without self-observation (today's list), and when /config fails", { timeout: 30_000 }, async () => {
    const off = await pin("coaching legacy", "/portal/coaching", null, false);
    expect(await renderAt("/portal/coaching", null, "fails", true), "fails").toBe(off);
  });

  it("/portal/coaching while /config loads", { timeout: 30_000 }, async () => {
    expect(await renderAt("/portal/coaching", null, "loading", true)).toMatchSnapshot("coaching loading");
  });

  it("/portal/coaching/new recording", { timeout: 30_000 }, async () => {
    const html = await pin("record recording", "/portal/coaching/new", { start: "record" }, true);
    expect(html).toContain("12:34");
  });

  it("/portal/coaching/new check and send (an uploaded file)", { timeout: 30_000 }, async () => {
    const before = () => handOffRecording(new File(["x"], "Period 3.m4a"));
    const html = await pin("record check", "/portal/coaching/new", { start: "file" }, true, before);
    expect(html).toContain("Period 3.m4a");
  });

  it("/portal/coaching/new when it is not on for her", { timeout: 30_000 }, async () => {
    const off = await pin("record unavailable", "/portal/coaching/new", { start: "record" }, false);
    expect(await renderAt("/portal/coaching/new", { start: "record" }, "fails", true), "fails").toBe(off);
  });

  it("/portal/coaching/session/:id report (LessonPage)", { timeout: 30_000 }, async () => {
    await pin("lesson report", "/portal/coaching/session/cs-1", null, true);
  });

  it("/portal/coaching/session/:id her question (LessonPage)", { timeout: 30_000 }, async () => {
    const before = () => api.getCoachingProgress.mockResolvedValue(progress("reflection", {
      reflection: { questionNumber: 1, question: "What did you do next?" },
    }));
    await pin("lesson question", "/portal/coaching/session/cs-1", null, true, before);
  });

  it("/portal/coaching/session/:id coach observation (LessonPage)", { timeout: 30_000 }, async () => {
    const before = () => api.getCoachingSession.mockResolvedValue({ session: {
      ...DETAIL, topic: "Fractions",
      observation: { observerName: "Noor", observerRole: "coach", observedAt: "2026-10-01T05:00:00Z", sentAt: "2026-10-01T09:00:00Z", reportImageUrl: "https://r2/obs.png", caption: "Well done", companionText: "Try names" },
    } });
    await pin("lesson observation", "/portal/coaching/session/cs-1", null, true, before);
  });

  it("/portal/coaching/session/:id without self-observation (today's report page), and when /config fails", { timeout: 30_000 }, async () => {
    const off = await pin("lesson legacy", "/portal/coaching/session/cs-1", null, false);
    expect(await renderAt("/portal/coaching/session/cs-1", null, "fails", true), "fails").toBe(off);
  });
});

describe("bd-5rz1v.26 — the recording bar on the old menu is exactly what it was", () => {
  const session = (over: Partial<RecordingSession> = {}): RecordingSession => ({
    active: true, paused: false, stream: null, screenWentOff: false, recordingId: "r", returnTo: "/portal/coaching/new",
    elapsedMs: () => 12 * 60_000 + 34_000,
    start: vi.fn(), pause: vi.fn(), resume: vi.fn(), finish: vi.fn(), askBeforeLogout: vi.fn(),
    ...over,
  } as unknown as RecordingSession);

  it.each([
    ["above the old menu", { aboveMenu: true }, {}],
    ["with no menu", { aboveMenu: false }, {}],
    ["paused, screen went off", { aboveMenu: true }, { paused: true, screenWentOff: true }],
  ] as const)("%s", (_label, props, over) => {
    const { container } = render(<MemoryRouter><RecordingBar session={session(over)} {...props} /></MemoryRouter>);
    expect(normalise(container.innerHTML)).toMatchSnapshot();
    screen.getByTestId("recording-bar");
  });
});
