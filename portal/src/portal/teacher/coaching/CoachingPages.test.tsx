import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fmf24g.4 — the teacher v2 Digital Coaching pages (v28 canvas Coaching, CoachingRecord, CoachingCheck).
 *
 *   hub     Select your class (her own classes only), Lesson plan (optional), Photos (one grid, a hint,
 *           No faces), Start recording / Upload recording (off until a class), Recent DC Observations
 *           (collapsed). Opened from a lesson plan (?grade&subject&plan=k5:|g612:&lang) it arrives filled in.
 *   send    one page for record → check and send → sent, on today's send flow (useSendFlow, sendLesson);
 *           what the hub chose (plan, photos) arrives with it and is what is sent.
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

// The registry first, as the app loads it: it pulls in every feature's routes (a page imported first
// would be mid-load when its own routes.tsx renders it).
import "../routes";
import api from "../../services/api";
import { handOffRecording } from "../../lib/lessonHandoff";
import { CoachingHomePage } from "./CoachingHome";
import { SendPage } from "./SendPage";
import coachingRoutes from "./routes";
import { clearDraft, holdDraft, readPrefill } from "./draft";
import { COACHING_HOME, COACHING_SEND } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

let answers: Record<string, () => unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  session.active = false;
  answers = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" },
      { grade: 5, gradeCode: "grade_5", subject: "Mathematics", subjectKey: "maths", source: "class" },
      { grade: null, gradeCode: "ece", subject: "Play", subjectKey: "play", source: "class" },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [
      { planKey: "k5:L3", kind: "k5", lessonId: "L3", found: true, title: "How plants make food", grade: 4, subject: "General Science",
        dayLabel: "Day 3", open: { lane: "k5", lessonId: "L3" } },
    ] }),
    "/teacher/coaching/history": () => ({ success: true, items: [
      { id: "s2", date: "2026-10-06", topic: "Parts of a plant", subject: "General Science", grade: 4, minutes: 34, percentage: null, reportReady: false },
      { id: "s1", date: "2026-10-02", topic: "Naming words", subject: "English", grade: null, minutes: 31, percentage: 63, reportReady: true },
    ], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 2 }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw new Error(`unexpected GET ${url}`);
    return { data: hit() };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-state={JSON.stringify(loc.state ?? null)}>{loc.pathname}{loc.search}</div>;
}

function at(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?")[1]}` : "", state }]}>
      <Routes>
        <Route path={COACHING_HOME} element={<><CoachingHomePage /><Where /></>} />
        <Route path={COACHING_SEND} element={<><SendPage /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("readPrefill (Start DC observation on a lesson plan)", () => {
  it("reads grade, subject and a grades 1–5 plan", () => {
    expect(readPrefill("?grade=4&subject=science&plan=k5:L3")).toEqual({
      grade: 4, subjectKey: "science", plan: "k5:L3", pick: { lessonId: "L3" },
    });
  });
  it("reads a grades 6–12 plan with its language", () => {
    expect(readPrefill("?grade=9&subject=physics&plan=g612:S9&lang=ur").pick).toEqual({ segmentId: "S9", lang: "ur" });
    expect(readPrefill("?plan=g612:S9").pick).toEqual({ segmentId: "S9", lang: "en" });
  });
  it("ignores what is not a plan key or a grade", () => {
    expect(readPrefill("?grade=nope&plan=lesson-3")).toEqual({ grade: null, subjectKey: null, plan: null, pick: null });
  });
});

describe("the hub", () => {
  it("her own classes only, NOTHING chosen yet: Start and Upload are off until she picks", async () => {
    at(COACHING_HOME);
    // The first test of the file also loads the page's module graph: room for a slow, loaded run.
    const trigger = await screen.findByRole("button", { name: new RegExp(`^${C.selectClass}$`) }, { timeout: 5000 });
    expect(trigger).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Grade 4 · General Science/ })).toBeNull();
    expect(screen.getByRole("heading", { name: C.yourClass })).toBeTruthy();
    expect((screen.getByRole("button", { name: C.startRecording }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: C.uploadRecording }) as HTMLButtonElement).disabled).toBe(true);
    // the grade-less class (early years) is not offered: DC needs a grade
    fireEvent.click(trigger);
    expect(screen.queryByText("Play")).toBeNull();
    // she picks (two classes: plain rows, one tap); Start and Upload come on
    fireEvent.click(await screen.findByRole("button", { name: /General Science/ }));
    expect(await screen.findByRole("button", { name: new RegExp(`${C.selectClass}.*Grade 4 · General Science`) })).toBeTruthy();
    expect((screen.getByRole("button", { name: C.startRecording }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: C.uploadRecording }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Photos: one grid, the hint, No faces; at most 3", async () => {
    at(COACHING_HOME);
    await screen.findByRole("button", { name: new RegExp(`^${C.selectClass}$`) });
    expect(screen.getByRole("heading", { name: new RegExp(C.photos) })).toBeTruthy();
    expect(screen.getByText(C.photosHint)).toBeTruthy();
    expect(screen.getByText(C.noFaces)).toBeTruthy();
    const input = screen.getByTestId("dc-photos-input") as HTMLInputElement;
    const img = (n: string) => new File(["x"], n, { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [img("a.jpg"), img("b.jpg")] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(2);
    fireEvent.change(input, { target: { files: [img("c.jpg"), img("d.jpg")] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(2);
    expect(screen.getByText(C.upToThree)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Remove photo/ })[0]);
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1);
  });

  it("from a lesson plan: class and plan arrive filled in (the plan named from her recent plans)", async () => {
    at(`${COACHING_HOME}?grade=4&subject=science&plan=k5:L3`);
    expect(await screen.findByRole("button", { name: new RegExp(`${C.selectClass}.*Grade 4 · General Science`) })).toBeTruthy();
    expect(await screen.findByText("How plants make food")).toBeTruthy();
  });

  it("Start recording hands the plan and photos to the send page and starts it", async () => {
    at(`${COACHING_HOME}?grade=4&subject=science&plan=k5:L3`);
    await screen.findByText("How plants make food");
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: C.startRecording }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_SEND));
    expect(session.start).toHaveBeenCalledWith({ returnTo: COACHING_SEND });
  });

  it("Recent DC Observations: collapsed; open shows her lessons, an unscored one as Analysing", async () => {
    at(COACHING_HOME);
    const toggle = await screen.findByRole("button", { name: new RegExp(C.recent) });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(await screen.findByText("Parts of a plant")).toBeTruthy();
    expect(screen.getByText(C.analysing)).toBeTruthy();
    expect(screen.getByText("Good")).toBeTruthy();
  });
});

describe("the send page", () => {
  it("no choice made (opened directly): back to the hub", async () => {
    at(COACHING_SEND);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
  });

  it("an uploaded file with the hub's plan and photos: Check and send lists them; Send sends exactly those", async () => {
    const photo = new File(["x"], "board.jpg", { type: "image/jpeg" });
    holdDraft({ combo: { grade: 4, subject: "General Science" }, plan: { kind: "library", pick: { lessonId: "L3" }, title: "How plants make food", chips: [] }, photos: [photo] });
    handOffRecording(new File(["a"], "lesson.m4a", { type: "audio/mp4" }));
    at(COACHING_SEND, { start: "file" });

    expect(await screen.findByRole("heading", { name: C.checkTitle })).toBeTruthy();
    const attached = screen.getByRole("region", { name: C.attached });
    expect(within(attached).getByText("How plants make food")).toBeTruthy();
    expect(within(attached).getByText(C.photosCount(1))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: C.send }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const [payload] = sendLesson.mock.calls[0] as unknown as [{ plan: unknown; photos: File[] }];
    expect(payload.plan).toEqual({ kind: "library", pick: { lessonId: "L3" } });
    expect(payload.photos).toEqual([photo]);
    expect(await screen.findByRole("heading", { name: C.sent })).toBeTruthy();
  });
});

describe("routes", () => {
  it("registers the hub as the feature's main page and the send page under it", () => {
    const paths = coachingRoutes.map((r) => r.path);
    expect(paths).toContain(COACHING_HOME);
    expect(paths).toContain(COACHING_SEND);
    expect(paths.every((p) => p.startsWith("/portal/teacher/coaching"))).toBe(true);
  });
});
