import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13.2 — Digital Coaching in Urdu: the hub, record, check and send, sent, the lesson's report page
 * and All DC observations take every word from COACHING (bilingual), none left in English; a lesson's band
 * is the bot's Urdu band word; data (topics, subjects, the coach's name, her answer) stays as the API sends
 * it. MACHINE-DRAFTED Urdu (see the review file).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getCoachingSession: vi.fn(),
  submitCoachingReflection: vi.fn(),
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
const sendLesson = vi.hoisted(() => vi.fn(async () => ({ coachingSessionId: "sess-1" })));
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

// The registry first, as the app loads it (a page imported first would be mid-load when its routes render it).
import "../routes";
import api from "../../services/api";
import { handOffRecording } from "../../lib/lessonHandoff";
import { CoachingHomePage } from "./CoachingHome";
import { SendPage } from "./SendPage";
import { ReportPage } from "./ReportPage";
import { CoachingAllPage } from "./CoachingAll";
import { clearDraft, holdDraft } from "./draft";
import { COACHING_ALL, COACHING_HOME, COACHING_REPORT, COACHING_SEND } from "./paths";
import { COACHING, COACHING_V2_COPY_UR as U } from "./copy";
import { dcKpiItems, lessonChip } from "./api";
import { dcSteps, toReportData } from "./report";
import { copyIn } from "../i18n";
import { LESSONS_V2_COPY_UR } from "../lessons/copy";
import { dayName, pkToday } from "../lessons/days";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const UR = copyIn(COACHING, "ur");
const DAYS = LESSONS_V2_COPY_UR.days;
/** The kit isolates digit and Latin runs on an Urdu page (LRI … PDI); compare without the isolates. */
const plain = (t: string | null | undefined) => (t || "").replace(/[⁦⁩]/g, "");
const ENGLISH_DAY = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/;
/** English labels still on the page, read without the isolates (an isolated "⁦Good⁩" is still English). */
const englishLeft = (words: string[]) => words.filter((w) => plain(document.body.textContent).includes(w));
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const DETAIL = {
  id: ID, date: "2026-10-02T06:00:00Z", duration: 1680, overallScore: 30, maxScore: 52, percentage: 58,
  topic: "Provinces of Pakistan", subject: "Social Studies",
  lessonAudioUrl: "https://r2/lesson.webm", debriefAudioUrl: "https://r2/debrief.mp3", reportUrl: "https://r2/report.png",
  photoUrls: ["https://r2/p1.jpg"],
  breakdown: { framework: "fico", language: "en", overall: 58, marks: 30, max: 52, groups: [
    { key: "B", domainKey: "lp", name: "Lesson Plan Fidelity", score: 9, max: 14, pct: 64, indicators: [] },
  ] },
  reflection: [{ question: "Which children answered?", answer: "Only the front rows.", language: "en", asked_at: null, answered_at: null }],
  prioritizedAction: { action: "Ask the back rows first.", commitment: null },
  analysisData: { overall_score: { points: 30, max_points: 52, percentage: 58 } },
  observation: null,
};

const HISTORY = {
  success: true, range: { key: "custom" }, previous: { from: "2026-09-01", to: "2026-09-08" },
  kpis: { sessions: { value: 3, previous: 1 }, minutes: { value: 95, previous: 25 }, reports: { value: 2, previous: 1 } },
  trend: { bucketDays: 1, points: [1, 0, 0, 0, 1, 0, 0, 1] },
  items: [
    { id: "s2", date: "2026-10-06", topic: "Parts of a plant", subject: "General Science", grade: 4, minutes: 34, percentage: null, reportReady: false },
    { id: "s1", date: "2026-10-02", topic: "Naming words", subject: "English", grade: null, minutes: 31, percentage: 63, reportReady: true },
  ],
  total: 2, truncated: false,
};

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  session.active = false;
  session.paused = false;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
  const answers: Record<string, () => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [] }),
    "/teacher/coaching/history": () => HISTORY,
    [`/teacher/coaching/${ID}/journey`]: () => ({ success: true, points: [{ date: "2026-09-10", pct: 50 }, { date: "2026-10-02", pct: 58 }] }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw new Error(`unexpected GET ${url}`);
    return { data: hit() };
  });
});

function at(path: string, element: React.ReactElement, pattern = path, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Digital Coaching in Urdu — the hub", () => {
  it("title, sections, the Photos hint and chips, Start / Upload, Recent: all in Urdu", async () => {
    at(COACHING_HOME, <CoachingHomePage />);
    // The first test of the file also loads the page's module graph: room for a slow, loaded run.
    expect(await screen.findByRole("button", { name: new RegExp(U.selectClass) }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.title);
    expect(screen.getByRole("heading", { name: U.yourClass })).toBeTruthy();
    expect(screen.getByRole("heading", { name: new RegExp(U.lessonPlan) })).toBeTruthy();
    expect(screen.getByText(U.optional)).toBeTruthy();
    expect(screen.getByText(U.selectPlan)).toBeTruthy();
    expect(screen.getByText(U.photosHint)).toBeTruthy();
    expect(screen.getByText(U.noFaces)).toBeTruthy();
    expect(screen.getByRole("button", { name: U.addPhoto })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.startRecording })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.uploadRecording })).toBeTruthy();
    expect(englishLeft(["Start recording", "Upload recording", "Your class", "Select lesson plan", "Optional", "No faces", "Photos", "Board work"])).toEqual([]);
  });

  it("Recent: her lessons with Urdu chips (Analysing, the band) and Urdu day names; data as it is", async () => {
    at(COACHING_HOME, <CoachingHomePage />);
    const toggle = await screen.findByRole("button", { name: new RegExp(U.recent) });
    fireEvent.click(toggle);
    expect(await screen.findByText(/Parts of a plant/)).toBeTruthy();
    expect(screen.getByText(U.analysing)).toBeTruthy();
    expect(screen.getByText(U.bands.good)).toBeTruthy();
    expect(englishLeft(["Good", "Analysing", " min"])).toEqual([]);
    const body = plain(document.body.textContent);
    expect(body).toContain(dayName("2026-10-02", pkToday(), DAYS));
    expect(body).not.toMatch(ENGLISH_DAY);
    expect(body).toContain(UR.minutes(31));
  });

  it("Photos: each photo's remove and the at-most-3 line in Urdu", async () => {
    at(COACHING_HOME, <CoachingHomePage />);
    await screen.findByRole("button", { name: new RegExp(U.selectClass) });
    const input = screen.getByTestId("dc-photos-input") as HTMLInputElement;
    const img = (n: string) => new File(["x"], n, { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [img("a.jpg"), img("b.jpg")] } });
    expect(screen.getByRole("button", { name: UR.removePhoto(1) })).toBeTruthy();
    fireEvent.change(input, { target: { files: [img("c.jpg"), img("d.jpg")] } });
    expect(screen.getByText(U.upToThree)).toBeTruthy();
    expect(englishLeft(["Up to 3 photos", "Add photo"])).toEqual([]);
  });
});

describe("Digital Coaching in Urdu — record, check and send, sent", () => {
  it("recording: title, the state chip, Pause / Stop, the plan link, Keep app open; Finish lesson in Urdu", async () => {
    session.active = true;
    at(COACHING_SEND, <SendPage />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.recordTitle);
    expect(screen.getByText(U.recording)).toBeTruthy();
    expect(screen.getByRole("link", { name: U.lessonPlans })).toBeTruthy();
    expect(screen.getByText(U.keepAppOpen)).toBeTruthy();
    expect(screen.getByRole("button", { name: U.pause })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: U.stop }));
    expect(await screen.findByRole("dialog", { name: U.finishTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.yesFinish })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.keepRecording })).toBeTruthy();
    expect(englishLeft(["Record lesson", "Recording", "Pause", "Stop", "Keep app open", "Finish lesson", "Yes, finish", "Lesson plans"])).toEqual([]);
  });

  it("check and send: title, her lesson, Attached, the photos count, Send; then Sent and its ways on", async () => {
    const photo = new File(["x"], "board.jpg", { type: "image/jpeg" });
    holdDraft({ combo: { grade: 4, subject: "General Science" }, plan: { kind: "library", pick: { lessonId: "L3" }, title: "How plants make food", chips: [] }, photos: [photo] });
    handOffRecording(new File(["a"], "lesson.m4a", { type: "audio/mp4" }));
    at(COACHING_SEND, <SendPage />, COACHING_SEND, { start: "file" });

    expect(await screen.findByRole("heading", { name: U.checkTitle })).toBeTruthy();
    expect(plain(screen.getByTestId("page-crumb").textContent)).toBe(`${UR.grade(4)} · General Science`);
    const attached = screen.getByRole("region", { name: U.attached });
    expect(within(attached).getByText(/How plants make food/)).toBeTruthy();
    expect(within(attached).getByText(UR.photosCount(1))).toBeTruthy();
    expect(within(attached).getByText(U.photos)).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(U.changeFile) })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.listen })).toBeTruthy();
    expect(englishLeft(["Check and send", "Attached", "Change file", "1 photo", "Photos"])).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(U.send) }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: U.sent })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(U.openLesson) })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.title })).toBeTruthy();
    expect(englishLeft(["Sent", "Open lesson", "Digital Coaching"])).toEqual([]);
  });
});

describe("Digital Coaching in Urdu — the lesson's report page", () => {
  const openReport = () => at(COACHING_REPORT.replace(":id", ID), <ReportPage />, COACHING_REPORT);

  it("while it waits for her answer: the steps, Your turn, the answer box and Send in Urdu", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
      reflection: { questionNumber: 1, question: "Which children answered?" } });
    openReport();
    const steps = await screen.findByRole("region", { name: U.progress });
    for (const w of [U.analysing, U.stepReport, U.yourTurn, U.subReflection]) {
      expect(within(steps).getAllByText(w).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(U.stepReflection).length).toBeGreaterThan(0);
    expect(screen.getByText("Which children answered?")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: U.yourAnswer })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.send })).toBeTruthy();
    expect(screen.getByTestId("page-crumb").textContent).toBe(U.title);
    expect(englishLeft(["Reflection question", "Your turn", "Lesson received", "Answer by text", "Progress", "Digital Coaching"])).toEqual([]);
  });

  it("ready: voice note, her recording (its player too), Download, her answer folded — in Urdu", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
    portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
    openReport();
    expect(await screen.findByRole("heading", { name: U.voiceNote })).toBeTruthy();
    expect(screen.getByRole("group", { name: new RegExp(U.title) })).toBeTruthy();
    expect(screen.getByRole("heading", { name: U.yourRecording })).toBeTruthy();
    // Her recording's player (newui AudioPlayer, named by the recording) — the voice note has a play button too.
    const player = screen.getByRole("group", { name: U.yourRecording });
    expect(within(player).getByRole("button", { name: U.audio.play })).toBeTruthy();
    expect(screen.getByRole("link", { name: U.download })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(U.yourAnswer) })).toBeTruthy();
    expect(screen.getByText(/Lesson Plan Fidelity/)).toBeTruthy();
    expect(englishLeft(["Voice note", "Your lesson", "Your answer", "Download"])).toEqual([]);
    for (const en of ["Play", "Download"]) {
      expect(screen.queryByRole("button", { name: en })).toBeNull();
      expect(screen.queryByRole("link", { name: en })).toBeNull();
    }
  });

  it("stopped and not found: said in Urdu", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "failed", stage: "stopped", reflection: null });
    const { unmount } = openReport();
    expect(await screen.findByText(U.stopped)).toBeTruthy();
    unmount();
    portal.getCoachingProgress.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));
    openReport();
    expect(await screen.findByRole("heading", { name: U.notFound })).toBeTruthy();
  });
});

describe("Digital Coaching in Urdu — All DC observations", () => {
  it("title, the tiles' labels, the latest band and the list's chips and days in Urdu", async () => {
    at(COACHING_ALL, <CoachingAllPage />);
    expect(await screen.findByText(/Parts of a plant/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.allTitle);
    expect(screen.getByTestId("page-crumb").textContent).toBe(U.title);
    for (const w of [U.kpiSessions, U.kpiLatestBand, U.kpiMinutes, U.kpiReports]) expect(screen.getByText(w)).toBeTruthy();
    expect(screen.getAllByText(U.bands.good).length).toBeGreaterThan(0);
    expect(screen.getByText(U.analysing)).toBeTruthy();
    expect(englishLeft(["DC observations", "Latest band", "Minutes recorded", "Reports received", "Good", "Analysing", " min"])).toEqual([]);
    const body = plain(document.body.textContent);
    expect(body).not.toMatch(ENGLISH_DAY);
    expect(body).not.toMatch(/\bvs\b/);
  });
});

describe("Digital Coaching in Urdu — the helpers take the words given", () => {
  it("toReportData: the coach's heading and the dates in Urdu", () => {
    const d = toReportData({ ...DETAIL, prioritizedAction: null, observation: {
      observerName: "Hataf Atif", observedAt: null, sentAt: null, reportImageUrl: null, caption: null, companionText: "Well done.",
    } } as never, { teacher: "Ayesha Bibi", journey: [{ date: "2026-09-10", pct: 50 }, { date: "2026-10-02", pct: 58 }], words: UR, days: DAYS });
    expect(d.debrief?.heading).toBe(UR.fromCoach("Hataf Atif"));
    expect(d.date).toBe(dayName("2026-10-02", pkToday(), DAYS));
    expect(d.journey?.first).toBe(dayName("2026-09-10", pkToday(), DAYS));
  });

  it("dcSteps: the three steps (one Analysing) and their Now / Your turn in Urdu", () => {
    const steps = dcSteps("reflection", false, UR);
    expect(steps.map((s) => s.label)).toEqual([U.analysing, U.stepReflection, U.stepReport]);
    expect(steps[1]).toMatchObject({ sub: U.subReflection, nowText: U.yourTurn, state: "current" });
  });

  it("lessonChip and dcKpiItems: the band and the tiles in Urdu", () => {
    expect(lessonChip({ id: "x", date: "2026-10-02", topic: null, subject: null, grade: null, minutes: null, percentage: 85, reportReady: true }, UR))
      .toEqual({ text: U.bands.excellent, tone: "done" });
    const tiles = dcKpiItems(HISTORY as never, UR);
    expect(tiles.map((t) => t.label)).toEqual([U.kpiSessions, U.kpiLatestBand, U.kpiMinutes, U.kpiReports]);
    expect(tiles[1].value).toBe(U.bands.good);
  });
});
