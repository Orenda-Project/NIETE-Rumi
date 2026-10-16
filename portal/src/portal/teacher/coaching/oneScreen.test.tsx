import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

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
import { SendError } from "../../lib/coachingSend";
import { DC_MIN_SECONDS, readAudioDuration } from "../../lib/coachingUpload";
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
/** The phone's Back (Android / the browser): one step back in history. */
function PhoneBack() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>phone back</button>;
}
/** The main page, then the one screen: so Back has somewhere to go. */
function fromMainPage() {
  return render(
    <MemoryRouter initialEntries={[COACHING_HOME, COACHING_NEW]} initialIndex={1}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
      <PhoneBack />
    </MemoryRouter>,
  );
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

/** Step 3: the Recording card opens its tray (operator, 16 Oct: "open in tray and then asks for two options"). */
const recordingCard = () => screen.findByRole("button", { name: new RegExp(`^${C.recording}`) });
async function openRecording() {
  fireEvent.click(await recordingCard());
  return screen.getByRole("dialog", { name: C.recording });
}

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
    expect(await recordingCard()).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("Start recording records on this screen: the clock, Pause and Stop, no new page", async () => {
    // A real session reports itself active once it starts.
    session.start.mockImplementationOnce(async () => { session.active = true; return "recording"; });
    at(COACHING_NEW);
    await pickClass();
    fireEvent.click(within(await openRecording()).getByRole("button", { name: C.recordTitle }));
    await waitFor(() => expect(session.start).toHaveBeenCalledWith({ returnTo: COACHING_NEW }));
    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.pause) })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.stop) })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW);
  });

  it("a recording opens Lesson plan, Photos and Submit; Submit sends the class, then progress on the second screen", async () => {
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
    // no "Back to Digital Coaching" (operator, 16 Oct): the header's Back is the way out
    expect(screen.queryByRole("link", { name: /Back to Digital Coaching/ })).toBeNull();
    expect(screen.getByRole("note")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(`${COACHING_NEW}?sent=sess-1`);
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

describe("Recording opens in a tray, as Grade and subject does (operator, 16 Oct)", () => {
  it("one Recording card on the screen; the two choices are only in its tray, full size", async () => {
    at(COACHING_NEW);
    await pickClass();
    const card = await recordingCard();
    expect(card.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("button", { name: C.recordTitle })).toBeNull();
    expect(screen.queryByRole("button", { name: C.uploadRecording })).toBeNull();
    const tray = await openRecording();
    const rec = within(tray).getByRole("button", { name: C.recordTitle });
    expect(rec.className).toContain("min-h-[176px]");
    expect(within(tray).getByRole("button", { name: C.uploadRecording })).toBeTruthy();
  });

  it("Upload recording closes the tray and opens the file chooser", async () => {
    at(COACHING_NEW);
    await pickClass();
    const input = (await screen.findByTestId("dc-audio-input")) as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(within(await openRecording()).getByRole("button", { name: C.uploadRecording }));
    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: C.recording })).toBeNull();
  });
});

describe("Lesson plan before the recording (operator, 16 Oct)", () => {
  it("once a class is picked, Lesson plan (step 2) comes before Recording (step 3), and a plan can be chosen before recording", async () => {
    at(COACHING_NEW);
    await pickClass();
    const plan = await screen.findByRole("heading", { name: new RegExp(C.lessonPlan) });
    const rec = screen.getByRole("heading", { name: new RegExp(C.recording) });
    expect(!!(plan.compareDocumentPosition(rec) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // her recent plans are in the Lesson plan tray, not on the screen (operator, 16 Oct); one tap there, no recording yet
    await expect(screen.findByRole("button", { name: "How plants make food" }, { timeout: 600 })).rejects.toThrow();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(C.selectPlan) }));
    const tray = await screen.findByRole("dialog", { name: new RegExp(C.lessonPlan) });
    fireEvent.click(await within(tray).findByRole("button", { name: /How plants make food/ }));
    expect(await screen.findByText("How plants make food")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: new RegExp(C.lessonPlan) })).toBeNull();
    expect(await recordingCard()).toBeTruthy();
    expect(screen.queryByRole("heading", { name: new RegExp(C.photos) })?.getAttribute("data-step-state")).toBe("upcoming");
  });
});

describe("Submit moves to a second screen (operator, 16 Oct)", () => {
  /** Nothing she could change is on the second screen. */
  const noEditors = () => {
    expect(screen.queryByRole("button", { name: new RegExp(C.gradeAndSubject) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`^${C.recording}`) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(C.selectPlan) })).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    expect(screen.queryByTestId("dc-photos-input")).toBeNull();
  };
  const submitted = async () => {
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
  };

  it("the upload runs on the second screen: its % is there and nothing she can edit", async () => {
    sendLesson.mockImplementationOnce((..._a: unknown[]) => { (_a[2] as (n: number) => void)(40); return new Promise(() => {}); });
    at(COACHING_NEW);
    await submitted();
    expect(await screen.findByText("40%")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(`${COACHING_NEW}?sent=uploading`);
    noEditors();
  });

  it("once sent, the address names the lesson; Back goes to the main page, never to the screen she edited", async () => {
    fromMainPage();
    await submitted();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`${COACHING_NEW}?sent=sess-1`));
    expect(await screen.findByRole("region", { name: C.progress })).toBeTruthy();
    noEditors();
    fireEvent.click(screen.getByRole("button", { name: "phone back" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
  });

  it("opened again (a reload) it shows that lesson's progress, not the editors", async () => {
    at(`${COACHING_NEW}?sent=sess-1`);
    expect(await screen.findByRole("region", { name: C.progress })).toBeTruthy();
    noEditors();
  });

  it("reloaded mid-upload (that upload is gone): the main page, not an empty editor", async () => {
    at(`${COACHING_NEW}?sent=uploading`);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
  });

  it("a send that fails comes back to her screen, everything she chose still there, to try again", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("network"));
    at(COACHING_NEW);
    await submitted();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW);
    expect(screen.getByTestId("dc-recording")).toBeTruthy();
    expect(screen.getByRole("button", { name: C.submit })).toBeTruthy();
  });
});

describe("recordings must be at least 15 minutes (operator, 16 Oct: a few seconds got a full report)", () => {
  it("Recording says the minimum before she records or uploads", async () => {
    at(COACHING_NEW);
    await pickClass();
    const step = await screen.findByRole("heading", { name: new RegExp(C.recording) });
    expect(step.textContent).toContain(C.atLeastMinutes);
    expect(C.atLeastMinutes).toMatch(/15/);
    expect(DC_MIN_SECONDS).toBe(900);
  });

  it("a recording under 15 minutes cannot be submitted: no Submit, a short line, Redo / Change file still there", async () => {
    vi.mocked(readAudioDuration).mockResolvedValueOnce(14 * 60 + 59);
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
    expect(await screen.findByText(C.tooShort)).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    expect(screen.getByTestId("dc-recording")).toBeTruthy();
    expect(screen.getByRole("button", { name: C.changeFile })).toBeTruthy();
    expect(sendLesson).not.toHaveBeenCalled();
  });

  it("15 minutes exactly can be submitted, with no warning", async () => {
    vi.mocked(readAudioDuration).mockResolvedValueOnce(15 * 60);
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
    expect(await screen.findByRole("button", { name: C.submit })).toBeTruthy();
    expect(screen.queryByText(C.tooShort)).toBeNull();
  });
});
