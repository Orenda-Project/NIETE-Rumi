import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fgj73x.5 — From the library, for the class she already picked (operator, 16 Oct; design v11):
 *
 *   one screen → Lesson plan → From the library  =  that class's chapters (no grade or subject again), "Choose a lesson plan"
 *   chapter → its lesson plans: a tap ATTACHES it and goes back to the one screen, everything as she left it
 *   the eye on a row opens the plan to read, with "Use this lesson plan" (attaches and goes back)
 *   the eye on the attached plan opens it to read; Back is the one screen again
 *   the tray's Recent are this class's only
 *
 * Grades 1–5 only (operator: DC is not for middle and high school for now).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({
  default: ({ view }: { view: { title: string } }) => <div data-testid="viewer">{view.title}</div>,
}));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: {} }));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(async () => null),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { CoachingHomePage } from "./CoachingHome";
import { NewObservationPage } from "./NewObservation";
import { clearDraft } from "./draft";
import { COACHING_HOME, COACHING_NEW } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";
import lessonRoutes from "../lessons/routes";
import { LESSONS_HOME, LESSONS_VIEWER } from "../lessons/paths";
import { LESSONS_V2_COPY as L } from "../lessons/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

const RECENT = { plans: [
  { planKey: "k5:g4s3", kind: "k5", lessonId: "g4s3", found: true, title: "How plants make food", grade: 4, subject: "General Science",
    chapterTitle: "Plants", dayLabel: "Day 3", usedAt: "2026-10-15T08:00:00Z", open: { lane: "k5", lessonId: "g4s3" } },
  { planKey: "k5:g5m1", kind: "k5", lessonId: "g5m1", found: true, title: "Fractions of a whole", grade: 5, subject: "Mathematics",
    chapterTitle: "Fractions", dayLabel: "Day 1", usedAt: "2026-10-14T08:00:00Z", open: { lane: "k5", lessonId: "g5m1" } },
] };

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  session.active = false;
  const answers: Record<string, (p?: Record<string, unknown>) => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" },
    ] }),
    "/lesson-plans/recent": () => RECENT,
    "/teacher/coaching/history": () => ({ success: true, items: [], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 0 }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "gs", subject: "General Science", lesson_count: 40 }] }),
    "/curriculum/chapters": () => ({ chapters: [
      { chapter_number: 1, chapter_title: "Plants: food and growth", pages_label: "p.1-28", lesson_count: 6 },
      { chapter_number: 2, chapter_title: "Inside The Animal World", pages_label: "p.29-46", lesson_count: 7 },
    ] }),
    "/curriculum/lps": () => ({ lessons: [
      { lesson_id: "g4s1", lp_type: "content", day_label: "Day 1", topic: "What do plants need to grow?", pages_label: "p.2", downloaded: true },
      { lesson_id: "g4s3", lp_type: "content", day_label: "Day 3", topic: "How plants make their own food", pages_label: "p.10", downloaded: false },
      { lesson_id: "g4sw", lp_type: "assessment", day_label: null, topic: "Worksheet", pages_label: null, downloaded: false },
      { lesson_id: "g4sr", lp_type: "revision", day_label: null, topic: "Revision", pages_label: null, downloaded: false },
    ] }),
  };
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const hit = Object.entries(answers).find(([k]) => url === k);
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit[1](cfg?.params) };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname}>{loc.pathname}{loc.search}</div>;
}

/** The main page, then the one screen: so Back has somewhere to go. */
function app() {
  return render(
    <MemoryRouter initialEntries={[COACHING_HOME, COACHING_NEW]} initialIndex={1}>
      <Routes>
        <Route path={COACHING_HOME} element={<CoachingHomePage />} />
        <Route path={COACHING_NEW} element={<NewObservationPage />} />
        {lessonRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const path = () => screen.getByTestId("where").dataset.path;
const back = () => fireEvent.click(screen.getByLabelText("Back"));
const m4a = () => new File(["a"], "lesson.m4a", { type: "audio/mp4" });

/** Her Grade 4 · General Science, and a recording, so there is something to lose. */
async function ready() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }, { timeout: 5000 }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
  fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
  await screen.findByTestId("dc-recording");
}
async function openTray() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${C.selectPlan}$`) }));
  return screen.findByRole("dialog", { name: new RegExp(C.picker.lessonPlan) });
}
async function toChapters() {
  const tray = await openTray();
  fireEvent.click(within(tray).getByRole("button", { name: new RegExp(C.picker.fromLibrary) }));
  await waitFor(() => expect(path()).toBe(`${LESSONS_HOME}/chapters`));
}
async function toLessons() {
  await toChapters();
  fireEvent.click(await screen.findByRole("link", { name: /Plants: food and growth/ }));
  await waitFor(() => expect(path()).toBe(`${LESSONS_HOME}/lessons`));
}
const attachedIntact = async (title: string) => {
  await waitFor(() => expect(path()).toBe(COACHING_NEW));
  expect(await screen.findByText(title)).toBeTruthy();
  expect(screen.getByTestId("dc-recording")).toBeTruthy();
  expect(screen.getAllByText("Grade 4 · General Science").length).toBeGreaterThan(0);
};

describe("From the library, for the class she picked", () => {
  it("opens that class's chapters, to choose a plan: no grade or subject to pick again", async () => {
    app();
    await ready();
    await toChapters();
    const q = new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1]);
    expect(q.get("grade")).toBe("4");
    expect(q.get("subject")).toBe("gs");
    expect(q.get("pick")).toBe("dc");
    expect(await screen.findByRole("heading", { name: L.choosePlan })).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Inside The Animal World/ })).toBeTruthy();
  });

  it("Back from the chapters is the one screen, as she left it", async () => {
    app();
    await ready();
    await toChapters();
    back();
    await waitFor(() => expect(path()).toBe(COACHING_NEW));
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
  });

  it("a tap on a lesson plan attaches it and goes back to the one screen; Back from there is the main page", async () => {
    app();
    await ready();
    await toLessons();
    fireEvent.click(await screen.findByRole("button", { name: /^LP #.*How plants make their own food/ }));
    await attachedIntact("How plants make their own food");
    back();
    await waitFor(() => expect(path()).toBe(COACHING_HOME)); // not the library
  });

  it("only lesson plans are offered: no Worksheet or Revision to attach", async () => {
    app();
    await ready();
    await toLessons();
    await screen.findAllByRole("button", { name: /How plants make their own food/ });
    expect(screen.queryByText("Worksheet")).toBeNull();
    expect(screen.queryByText("Revision")).toBeNull();
  });

  it("the eye opens a plan to read, with Use this lesson plan: it attaches and goes back", async () => {
    app();
    await ready();
    await toLessons();
    fireEvent.click(await screen.findByRole("button", { name: L.viewPlan("How plants make their own food") }));
    await waitFor(() => expect(path()).toBe(LESSONS_VIEWER));
    expect(screen.getByTestId("viewer").textContent).toBe("How plants make their own food");
    expect(screen.queryByRole("link", { name: new RegExp(L.startDc) })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: L.usePlan }));
    await attachedIntact("How plants make their own food");
  });

  it("the eye on the attached plan opens it to read (no Start DC there); Back is the one screen with the plan", async () => {
    app();
    await ready();
    await toLessons();
    fireEvent.click(await screen.findByRole("button", { name: /^LP #.*How plants make their own food/ }));
    await attachedIntact("How plants make their own food");
    fireEvent.click(screen.getByRole("button", { name: C.viewPlan }));
    await waitFor(() => expect(path()).toBe(LESSONS_VIEWER));
    expect(screen.queryByRole("link", { name: new RegExp(L.startDc) })).toBeNull();
    expect(screen.queryByRole("button", { name: L.usePlan })).toBeNull();
    back();
    await attachedIntact("How plants make their own food");
  });
});

describe("the tray's Recent are this class's only", () => {
  it("Grade 4 · General Science: her Grade 4 plan, not her Grade 5 one", async () => {
    app();
    await ready();
    const tray = await openTray();
    expect(await within(tray).findByText("How plants make food")).toBeTruthy();
    expect(within(tray).queryByText("Fractions of a whole")).toBeNull();
  });
});
