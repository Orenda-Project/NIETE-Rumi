import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

/**
 * bd-fmf24g.68 — the operator's example: "if I go to coaching, click the lesson plan button and, on the lesson plan page,
 * click back, it takes me to the home. It should take me to my last page, which was the new observation page."
 *
 * Home → Digital Coaching → Start DC observation (the one screen) → Lesson plan → From library → Lessons → Back  =  the
 * one screen, with her class, recording and photos where she left them. And the recording page's Back is a step back,
 * not a new hub on top of the history.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
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
import TeacherPage from "../TeacherPage";
import { teacherPath } from "../routes";
import { CoachingHomePage } from "./CoachingHome";
import { SendPage } from "./SendPage";
import { NewObservationPage } from "./NewObservation";
import { clearDraft } from "./draft";
import { COACHING_HOME, COACHING_NEW, COACHING_SEND } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

// bd-sex15q.34 — these pages are their own chunks (lib/lazyPage); load them before stepping through them synchronously.
preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  session.active = false;
  const answers: Record<string, unknown> = {
    "/me/grade-subjects": { success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" },
      { grade: 5, gradeCode: "grade_5", subject: "Mathematics", subjectKey: "maths", source: "class" },
    ] },
    "/lesson-plans/recent": { plans: [] },
    "/teacher/coaching/history": { success: true, items: [], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 0 },
  };
  http.get.mockImplementation(async (url: string) => {
    if (!(url in answers)) throw new Error(`unexpected GET ${url}`);
    return { data: answers[url] };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}
/** The Lessons page, as the real one frames itself: a TeacherPage whose fixed parent is Home. */
function LessonsStandIn() {
  return <TeacherPage feature="lessons" crumb="Home" title="Lesson Plans" backTo={teacherPath("home")}><p>lessons body</p></TeacherPage>;
}
function ToCoaching() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(COACHING_HOME)}>go to coaching</button>;
}

function app(entries: (string | { pathname: string; state: unknown })[], index?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path={teacherPath("home")} element={<><ToCoaching /><Where /></>} />
        <Route path={COACHING_HOME} element={<><CoachingHomePage /><Where /></>} />
        <Route path={COACHING_NEW} element={<><NewObservationPage /><Where /></>} />
        <Route path={COACHING_SEND} element={<><SendPage /><Where /></>} />
        <Route path={teacherPath("lessons")} element={<><LessonsStandIn /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;
const back = () => fireEvent.click(screen.getByLabelText("Back"));

const m4a = () => new File(["a"], "lesson.m4a", { type: "audio/mp4" });
/** From the main page: Start DC observation, then her Grade 4 · General Science. */
async function start() {
  fireEvent.click(await screen.findByRole("link", { name: new RegExp(C.startObservation) }, { timeout: 5000 }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }, { timeout: 5000 }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
}
/** On the one screen: upload a recording, so the lesson plan row and the photos are there. */
async function attach() {
  // the Recording card is there once the class is picked (Record / Upload are in its tray since 16 Oct)
  await waitFor(() => expect(screen.getByRole("button", { name: new RegExp(`^${C.recording}`) })).toBeTruthy(), { timeout: 5000 });
  fireEvent.change(screen.getByTestId("dc-audio-input"), { target: { files: [m4a()] } });
  await screen.findByTestId("dc-recording");
}

describe("Back goes to the last screen", () => {
  it("the operator's example: one screen → Lesson plan → From library → Back is the one screen again, all intact", async () => {
    app([teacherPath("home")]);
    fireEvent.click(screen.getByRole("button", { name: "go to coaching" }));
    await start();
    await attach();
    const img = new File(["x"], "board.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [img] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${C.selectPlan}$`) }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: new RegExp(C.picker.fromLibrary) }));
    expect(where()).toBe(teacherPath("lessons"));

    back();
    expect(where()).toBe(COACHING_NEW); // not Home
    // the draft survived the round trip, her class too
    expect(await screen.findByText("Grade 4 · General Science")).toBeTruthy();
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    expect(within(screen.getByTestId("dc-recording")).getByText("lesson.m4a")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1);
    expect((screen.getByRole("button", { name: C.submit }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the one screen opened fresh (Start DC observation, not by Back) starts empty", async () => {
    app([teacherPath("home")]);
    fireEvent.click(screen.getByRole("button", { name: "go to coaching" }));
    await start();
    await attach();
    back(); // one screen → the main page
    expect(where()).toBe(COACHING_HOME);
    fireEvent.click(await screen.findByRole("link", { name: new RegExp(C.startObservation) }));
    expect(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) })).toBeTruthy();
    expect(screen.queryByText("Grade 4 · General Science")).toBeNull();
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("the hub's own Back goes to the screen before it", async () => {
    app([teacherPath("lessons"), COACHING_HOME], 1);
    await screen.findByRole("link", { name: new RegExp(C.startObservation) }, { timeout: 5000 });
    back();
    expect(where()).toBe(teacherPath("lessons")); // not the fixed Home
  });

  it("the recording page's Back is a step back to the hub, so the hub's Back then leaves to Home (no hub on top of the history)", async () => {
    session.start.mockImplementationOnce(async () => { session.active = true; return "recording"; });
    app([teacherPath("home"), COACHING_HOME, { pathname: COACHING_SEND, state: { start: "record" } }], 2);
    await screen.findByTestId("dc-send");
    back();
    expect(where()).toBe(COACHING_HOME);
    await screen.findByRole("link", { name: new RegExp(C.startObservation) }, { timeout: 5000 });
    back();
    expect(where()).toBe(teacherPath("home"));
  });
});
