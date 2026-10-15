import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * Digital Coaching in the Assessment flow, on one screen (design v6):
 *
 *   main page     Start DC observation (→ /coaching/new), Analysing only while one is analysed, Recent DC Observations
 *                 open, no See all, no Record / Upload on the main page. A lesson-plan link lands on the one screen.
 *   one screen    1 Grade and subject (the kit picker, grade colours) → 2 Recording (inline, or Upload) → 3 Lesson plan
 *                 and 4 Photos → Submit, which sends the class. Then, on the same screen: Analysing → Reflection
 *                 question (answered here) → Report ready, the leave note and Back to Digital Coaching.
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
import * as paths from "./paths";
import { COACHING_ALL, COACHING_HOME } from "./paths";
import { clearDraft } from "./draft";
import { COACHING_V2_COPY as C } from "./copy";

const COACHING_NEW = (paths as Record<string, unknown>).COACHING_NEW as string;
const http = api as unknown as { get: ReturnType<typeof vi.fn> };

let answers: Record<string, () => unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  session.active = false;
  answers = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", featureKey: "general_science", source: "class", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [
      { planKey: "k5:L3", kind: "k5", lessonId: "L3", found: true, title: "How plants make food", grade: 4, subject: "General Science",
        dayLabel: "Day 3", open: { lane: "k5", lessonId: "L3" } },
    ] }),
    "/teacher/coaching/history": () => ({ success: true, items: [
      { id: "s2", date: "2026-10-06", topic: "Parts of a plant", subject: "General Science", grade: 4, minutes: 34, percentage: null, reportReady: false },
      { id: "s1", date: "2026-10-02", topic: "Naming words", subject: "English", grade: 3, minutes: 31, percentage: 63, reportReady: true },
    ], kpis: { sessions: { value: 2, previous: null }, minutes: { value: 65, previous: null }, reports: { value: 1, previous: null } },
    trend: { bucketDays: 1, points: [] }, total: 2 }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 2 }] }),
    "/lp612/grades": () => ({ grades: [] }),
    "/curriculum/subjects": () => ({ subjects: [
      { subject_key: "general_science", subject: "General Science", lesson_count: 40 },
      { subject_key: "math", subject: "Math", lesson_count: 80 },
    ] }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}
function at(path: string) {
  const [pathname, search] = path.split("?");
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "" }]}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const m4a = () => new File(["a"], "lesson.m4a", { type: "audio/mp4" });

/** Step 1: Grade 4 · General Science, from the tray. */
async function pickClass() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
}

describe("main page", () => {
  it("Start DC observation goes to the one screen; nothing to record on the main page", async () => {
    expect(COACHING_NEW).toBe(`${COACHING_HOME}/new`);
    at(COACHING_HOME);
    const start = await screen.findByRole("link", { name: new RegExp(C.startObservation) });
    expect(start.getAttribute("href")).toBe(COACHING_NEW);
    expect(start.textContent).toContain(C.subReport);
    expect(screen.queryByRole("button", { name: C.recordTitle })).toBeNull();
    expect(screen.queryByRole("button", { name: C.uploadRecording })).toBeNull();
  });

  it("a lesson still analysing is under Analysing, the rest under Recent, open, with no See all", async () => {
    at(COACHING_HOME);
    const analysing = await screen.findByRole("region", { name: C.analysing });
    expect(within(analysing).getByText("Parts of a plant")).toBeTruthy();
    expect(await screen.findByText("Naming words")).toBeTruthy();
    expect(screen.getAllByText("Parts of a plant")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
    expect(screen.getByRole("link", { name: new RegExp(C.summary) }).getAttribute("href")).toBe(COACHING_ALL);
  });

  it("nothing analysing: no Analysing list", async () => {
    answers["/teacher/coaching/history"] = () => ({ success: true, items: [
      { id: "s1", date: "2026-10-02", topic: "Naming words", subject: "English", grade: 3, minutes: 31, percentage: 63, reportReady: true },
    ], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 1 });
    at(COACHING_HOME);
    await screen.findByText("Naming words");
    expect(screen.queryByRole("region", { name: C.analysing })).toBeNull();
  });

  it("opened from a lesson plan: lands on the one screen with the plan", async () => {
    at(`${COACHING_HOME}?grade=4&subject=science&plan=k5:L3`);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`${COACHING_NEW}?grade=4&subject=science&plan=k5:L3`));
  });
});

describe("the one screen", () => {
  it("step by step: the recording comes only after a grade and subject", async () => {
    at(COACHING_NEW);
    expect(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.recordTitle })).toBeNull();
    await pickClass();
    expect(await screen.findByRole("button", { name: C.recordTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.uploadRecording })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("Start recording records on this screen: the clock, Pause and Stop, no new page", async () => {
    // A real session reports itself active once it starts.
    session.start.mockImplementationOnce(async () => { session.active = true; return "recording"; });
    at(COACHING_NEW);
    await pickClass();
    fireEvent.click(await screen.findByRole("button", { name: C.recordTitle }));
    await waitFor(() => expect(session.start).toHaveBeenCalledWith({ returnTo: COACHING_NEW }));
    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.pause) })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.stop) })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW);
  });

  it("a recording opens Lesson plan, Photos and Submit; Submit sends the class, then progress on the same screen", async () => {
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
    expect(await screen.findByText(C.photos)).toBeTruthy();
    expect(screen.getByRole("heading", { name: new RegExp(C.lessonPlan) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    expect((sendLesson.mock.calls[0][0] as { teacherClass: unknown }).teacherClass)
      .toEqual(expect.objectContaining({ grade: 4, subject: "General Science" }));
    const progress = await screen.findByRole("region", { name: C.progress });
    expect(within(progress).getByText(C.analysing)).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(C.backToCoaching) }).getAttribute("href")).toBe(COACHING_HOME);
    expect(screen.getByRole("note")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW);
  });

  it("the reflection question is answered on the same screen", async () => {
    portal.getCoachingProgress.mockResolvedValue({
      id: "sess-1", status: "reflection", stage: "reflection", reflection: { questionNumber: 1, question: "What would you change?" },
    } as never);
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    expect(await screen.findByText("What would you change?")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: C.yourAnswer }), { target: { value: "More group work" } });
    fireEvent.click(screen.getByRole("button", { name: C.send }));
    await waitFor(() => expect(portal.submitCoachingReflection).toHaveBeenCalledWith("sess-1", "More group work"));
  });
});

describe("compact record / upload (operator, 15 Oct: all steps share one screen)", () => {
  it("Start recording and Upload recording are 88px buttons with the art beside the words, not 176px squares", async () => {
    at(COACHING_NEW);
    await pickClass();
    const rec = await screen.findByRole("button", { name: C.recordTitle });
    expect(rec.className).toContain("min-h-[88px]");
    expect(rec.className).not.toContain("min-h-[176px]");
    expect(rec.className).toContain("flex-row");
  });
});
