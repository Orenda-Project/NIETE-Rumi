import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-ma9jiy (queue #262; the operator 25 Nov ~19:45: "Teachers' DC gets the same behind your teacher switch") — with
 * portal_recording_resume on for her, the recording this phone kept is not the "Recording not sent" card: it comes back
 * as THIS screen's recording, PAUSED (the app's recording session `restore`), its clock at the saved length, with Resume
 * and Stop as any paused lesson; Resume carries on in the same recording. Switch off (no row, the default): the card,
 * exactly as before. Harness copied from unsentRecording.test.tsx.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null as string | null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(), setChunkListener: vi.fn(),
  restore: vi.fn((o: { kept: { meta: { id: string } } }) => { session.active = true; session.paused = true; session.recordingId = o.kept.meta.id; }),
}));
const sw = vi.hoisted(() => ({ on: false as boolean | null }));
vi.mock("../../lib/recordingResume", () => ({ useRecordingResume: () => sw.on }));
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
const store = vi.hoisted(() => ({
  latestUnsent: vi.fn(async (): Promise<unknown> => null),
  deleteRecording: vi.fn(async (_id: string) => undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../../lib/recordingStore", () => store);
// The header patch is lib/webmDuration's own business (and its own test's): here the bytes pass through.
vi.mock("../../lib/webmDuration", () => ({ withDuration: vi.fn(async (b: Blob) => b) }));

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import coachingRoutes from "./routes";
import { COACHING_NEW } from "./paths";
import { clearDraft, holdDraft } from "./draft";
import { COACHING_V2_COPY as C } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const REC = "rec-0f1e2d3c";
const BYTES = new Blob(["lesson-bytes"], { type: "audio/webm" });
const stored = (over: Record<string, unknown> = {}) => ({
  meta: {
    id: REC, mimeType: "audio/webm", ext: ".webm", startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    elapsedMs: 27 * 60_000, finished: false, ...over,
  },
  blob: BYTES,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  session.active = false;
  session.paused = false;
  session.recordingId = null;
  sw.on = false;
  store.latestUnsent.mockImplementation(async () => stored());
  const answers: Record<string, () => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", featureKey: "general_science", source: "class", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [] }),
    "/teacher/coaching/history": () => ({ success: true, items: [], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 0 }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
    "/lp612/grades": () => ({ grades: [] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "general_science", subject: "General Science", lesson_count: 40 }] }),
    "/coaching-upload/pending": () => ({ success: true, recordings: [] }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
  http.post.mockImplementation(async (url: string) => {
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});

function open() {
  return render(
    <MemoryRouter initialEntries={[COACHING_NEW]}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}
async function pickClass() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
}

describe("portal_recording_resume: a kept DC recording reopens as the PAUSED recording", () => {
  it("switch ON: the session restores it paused (same id); the screen shows Paused with Resume and Stop; no Not sent card", async () => {
    sw.on = true;
    open();
    await waitFor(() => expect(session.restore).toHaveBeenCalledTimes(1));
    const arg = session.restore.mock.calls[0][0] as { returnTo: string; kept: { meta: { id: string } }; beat: { kind: string } };
    expect(arg.returnTo).toBe(COACHING_NEW);
    expect(arg.kept.meta.id).toBe(REC);
    expect(arg.beat).toEqual({ kind: "dc" });
    expect(await screen.findByTestId("dc-record-clock")).toBeInTheDocument();
    expect(screen.getAllByText(C.paused).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: C.resume })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: C.stop })).toBeInTheDocument();
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
  });

  it("switch ON, Resume: the session carries on (session.resume)", async () => {
    sw.on = true;
    open();
    fireEvent.click(await screen.findByRole("button", { name: C.resume }));
    expect(session.resume).toHaveBeenCalledTimes(1);
  });

  it("switch OFF (the default): nothing restored, no paused recording: the screen as before", async () => {
    open();
    await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) });
    await new Promise((r) => setTimeout(r, 50));
    expect(session.restore).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dc-record-clock")).toBeNull();
  });

  it("switch ON but an MP4 kept (an iPhone): not reopened (only WebM parts can be joined)", async () => {
    sw.on = true;
    store.latestUnsent.mockImplementation(async () => stored({ ext: ".m4a", mimeType: "audio/mp4" }));
    open();
    await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) });
    await new Promise((r) => setTimeout(r, 50));
    expect(session.restore).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dc-record-clock")).toBeNull();
  });
});
