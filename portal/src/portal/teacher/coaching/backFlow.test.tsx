import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

/**
 * bd-fmf24g.68 — the operator's example: "if I go to coaching, click the lesson plan button and, on the lesson plan page,
 * click back, it takes me to the home. It should take me to my last page, which was the new observation page."
 *
 * Home → Digital Coaching (the hub) → Lesson plan → From library → Lessons → Back  =  the hub, with her class, plan
 * and photos where she left them. And the send page's Back is a step back, not a new hub on top of the history.
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
import { handOffRecording } from "../../lib/lessonHandoff";
import { clearDraft } from "./draft";
import { COACHING_HOME, COACHING_SEND } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

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
        <Route path={COACHING_SEND} element={<><SendPage /><Where /></>} />
        <Route path={teacherPath("lessons")} element={<><LessonsStandIn /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;
const back = () => fireEvent.click(screen.getByLabelText("Back"));

async function chooseClass() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${C.selectClass}$`) }, { timeout: 5000 }));
  fireEvent.click(await screen.findByRole("button", { name: /General Science/ }));
  await screen.findByRole("button", { name: new RegExp(`${C.selectClass}.*Grade 4 · General Science`) });
}

describe("Back goes to the last screen", () => {
  it("the operator's example: hub → Lesson plan → From library → Back is the hub again, class and photos intact", async () => {
    app([teacherPath("home")]);
    fireEvent.click(screen.getByRole("button", { name: "go to coaching" }));
    await chooseClass();
    const img = new File(["x"], "board.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [img] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.selectPlan) }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: new RegExp(C.picker.fromLibrary) }));
    expect(where()).toBe(teacherPath("lessons"));

    back();
    expect(where()).toBe(COACHING_HOME); // not Home
    // the draft survived the round trip
    expect(await screen.findByRole("button", { name: new RegExp(`${C.selectClass}.*Grade 4 · General Science`) })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1);
    expect((screen.getByRole("button", { name: C.startRecording }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a hub opened fresh from the menu (not by Back) starts empty", async () => {
    app([teacherPath("home")]);
    fireEvent.click(screen.getByRole("button", { name: "go to coaching" }));
    await chooseClass();
    back(); // hub → Home (nothing behind the hub but Home)
    expect(where()).toBe(teacherPath("home"));
    fireEvent.click(screen.getByRole("button", { name: "go to coaching" }));
    await screen.findByRole("button", { name: new RegExp(`^${C.selectClass}$`) });
    expect((screen.getByRole("button", { name: C.startRecording }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the hub's own Back goes to the screen before it", async () => {
    app([teacherPath("lessons"), COACHING_HOME], 1);
    await screen.findByRole("button", { name: new RegExp(`^${C.selectClass}$`) }, { timeout: 5000 });
    back();
    expect(where()).toBe(teacherPath("lessons")); // not the fixed Home
  });

  it("the send page's Back is a step back to the hub, so the hub's Back then leaves to Home (no hub on top of the history)", async () => {
    handOffRecording(new File(["a"], "lesson.m4a", { type: "audio/mp4" }));
    app([teacherPath("home"), COACHING_HOME, { pathname: COACHING_SEND, state: { start: "file" } }], 2);
    await screen.findByTestId("dc-send");
    back();
    expect(where()).toBe(COACHING_HOME);
    await screen.findByRole("button", { name: new RegExp(`^${C.selectClass}$`) }, { timeout: 5000 });
    back();
    expect(where()).toBe(teacherPath("home"));
  });
});
