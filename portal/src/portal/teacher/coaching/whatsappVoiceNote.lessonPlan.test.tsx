import { describe, it, expect, vi, beforeEach, beforeAll as preloadFirst } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-kijmb8 (queue #318) — the teacher's WhatsApp voice-message path: she sends the classroom voice note on WhatsApp, taps the
 * app link, lands on the one screen with it attached (?recording=whatsapp), picks her class and a plan (a photo of her own plan
 * here), and the plan opens OVER the page from the eye, for every plan kind. The report page then has the Lesson plan button
 * (SessionLessonPlanButton.test). With portal_lesson_plan_open off nothing about the plan row changes.
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
  submitCoachingReflection: vi.fn(),
  getCoachingSession: vi.fn(),
  answerClassCheck: vi.fn(),
  presignCoachingUpload: vi.fn(),
  uploadToR2: vi.fn(),
  startCoachingUpload: vi.fn(),
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

const sw = vi.hoisted(() => ({ on: false }));
vi.mock("../../lib/lessonPlanSwitch", () => ({ useLessonPlanOpen: () => sw.on }));
vi.mock("../../components/LessonPlanSheet", () => ({
  default: ({ view, recording }: { view: { source: { lane: string; fileKind?: string; lessonId?: string } }; recording: boolean }) => (
    <div data-testid="lesson-plan-sheet">{view.source.lane}:{view.source.fileKind || view.source.lessonId}:{recording ? "rec" : "idle"}</div>
  ),
}));

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import coachingRoutes from "./routes";
import { COACHING_HOME, COACHING_NEW, lessonPath } from "./paths";
import { clearDraft } from "./draft";
import { SendError } from "../../lib/coachingSend";
import { COACHING_V2_COPY as C } from "./copy";
import { preloadAll } from "@/lib/lazyPage";

// bd-sex15q.34 — these pages are their own chunks (lib/lazyPage); load them before stepping through them synchronously.
preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const KEY = "classroom_audio/u1/2026-10/portal_wa-0123456789abcdef-b2c3.ogg";
const ID = "portal_wa-0123456789abcdef-b2c3";
const OLDER = "portal_wa-fedcba9876543210-a1a1";
const waiting = (over: Record<string, unknown> = {}) => ({
  key: KEY, id: ID, seconds: 1812, receivedAt: new Date().toISOString(), listenUrl: "https://r2.example/get/a.ogg", duplicateOf: null, ...over,
});

let answers: Record<string, () => unknown>;
let posts: Record<string, (body: unknown) => unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  session.active = false;
  answers = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", featureKey: "general_science", source: "class", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [] }),
    "/teacher/coaching/history": () => ({ success: true, items: [], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 0 }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
    "/lp612/grades": () => ({ grades: [] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "general_science", subject: "General Science", lesson_count: 40 }] }),
    "/coaching-upload/pending": () => ({ success: true, recordings: [waiting()] }),
  };
  posts = { "/coaching-upload/check-duplicate": () => ({ success: true, duplicateOf: null }) };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
  http.post.mockImplementation(async (url: string, body: unknown) => {
    const hit = posts[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: await hit(body) };
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
async function pickClass() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
}


const waitingNow = { key: KEY, id: ID, seconds: 1812, receivedAt: new Date().toISOString(), listenUrl: "https://r2.example/get/a.ogg", duplicateOf: null };
async function pickClassAndPhotoPlan() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.selectPlan) }));
  const input = await screen.findByTestId("plan-photo-input");
  const photo = new File([new Uint8Array([1, 2, 3])], "plan.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [photo] } });
}

describe("the WhatsApp voice-message path", () => {
  beforeEach(() => { answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [waitingNow] }); });

  it("switch on: the photo plan opens over the page from its eye (not recording)", async () => {
    sw.on = true;
    at(`${COACHING_NEW}?recording=whatsapp`);
    await screen.findByTestId("dc-recording");
    await pickClassAndPhotoPlan();
    fireEvent.click(await screen.findByRole("button", { name: C.viewPlan }));
    expect((await screen.findByTestId("lesson-plan-sheet")).textContent).toBe("local:image:idle");
  });

  it("switch off: a photo plan has no eye and nothing opens (as before)", async () => {
    sw.on = false;
    at(`${COACHING_NEW}?recording=whatsapp`);
    await screen.findByTestId("dc-recording");
    await pickClassAndPhotoPlan();
    await waitFor(() => expect(screen.getByText("plan.jpg")).toBeTruthy());
    expect(screen.queryByRole("button", { name: C.viewPlan })).toBeNull();
    expect(screen.queryByTestId("lesson-plan-sheet")).toBeNull();
  });
});
