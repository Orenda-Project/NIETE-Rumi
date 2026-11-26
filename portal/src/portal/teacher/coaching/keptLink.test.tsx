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
  listKept: vi.fn(async (): Promise<unknown[]> => []),
  readKept: vi.fn(async (_id: string): Promise<unknown> => null),
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
import { COACHING_HOME, COACHING_NEW } from "./paths";
import { lastSavedAt } from "../../lib/keptOffer";
import { clearDraft, holdDraft } from "./draft";
import { COACHING_V2_COPY as C } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import * as lazyPage from "@/lib/lazyPage";

// preloadAll is newer than main's lazyPage: this test runs on every rung (bd-ma9jiy), so it is used only where it exists.
const preloadAll = (lazyPage as unknown as { preloadAll?: (o: { pages: boolean }) => Promise<unknown> }).preloadAll;
preloadFirst(() => (preloadAll ? preloadAll({ pages: true }) : undefined), 120_000);

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

/**
 * bd-ma9jiy (queue #262; the operator 26 Nov ~15:10, after #292: 62 teachers recorded a new lesson onto an old kept file):
 * "on the user's device we should note which observation is the one that's being recorded. So they can also store 2 at
 * a time as well." A teacher's DC recording belongs to the ATTEMPT made when she pressed Start (with its class): Continue
 * reopens only that attempt; a new lesson is always a fresh file, the old one kept and listed beside it; one kept before
 * this (no attempt) is unlinked: never reopened, offered to send on its own.
 */
const MINUTE = 60_000;
const kept = (id: string, over: { link?: Record<string, unknown> | null; finished?: boolean; agoMin?: number; elapsedMin?: number } = {}) => {
  const last = Date.now() - (over.agoMin ?? 2) * MINUTE;
  const elapsedMs = (over.elapsedMin ?? 27) * MINUTE;
  return {
    meta: { id, mimeType: "audio/webm", ext: ".webm", startedAt: new Date(last - elapsedMs).toISOString(), elapsedMs, finished: !!over.finished, ...(over.link ? { link: over.link } : {}) },
    blob: BYTES, nextSeq: 5, parts: 1, beats: [{ t: last, st: over.finished ? "i" : "r" }],
  };
};
const dc = (attemptId: string) => ({ kind: "dc", attemptId, grade: 4, subject: "General Science" });
function phone(list: ReturnType<typeof kept>[]) {
  store.latestUnsent.mockImplementation(async (accept?: (m: any) => boolean) => list.find((k) => !accept || accept(k.meta)) ?? null);
  store.listKept.mockImplementation(async () => list.map((k) => ({ meta: k.meta, beats: k.beats })));
  store.readKept.mockImplementation(async (id: string) => list.find((k) => k.meta.id === id) ?? null);
}
function openAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}
async function recordLesson() {
  await pickClass();
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${C.recording}$`) }));
  fireEvent.click(await screen.findByRole("button", { name: C.recordTitle }));
  await waitFor(() => expect(session.start).toHaveBeenCalledTimes(1));
  return (session.start.mock.calls[0] as unknown as [{ beat: { kind: string; attemptId?: string } }])[0].beat;
}

describe("a teacher's kept recording belongs to its own attempt", () => {
  it("the 62-teacher case: an old STOPPED lesson on the phone + today's lesson = two separate files", async () => {
    sw.on = true;
    const old = kept("rec-old", { link: dc("att-old-0001"), finished: true, agoMin: 180, elapsedMin: 29 });
    phone([old]);
    openAt(COACHING_NEW);
    // not reopened, not pulled into this lesson: it waits as its own card
    expect(await screen.findByTestId("dc-kept-unsent")).toBeInTheDocument();
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    const beat = await recordLesson();
    expect(beat.kind).toBe("dc");
    expect(beat.attemptId).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    expect(beat.attemptId).not.toBe("att-old-0001");
    expect(session.restore).not.toHaveBeenCalled();
    expect(lastSavedAt(old)).toBeLessThan(Date.now()); // the old file untouched (no write in this test's store)
  });

  it("a lesson cut minutes ago: its class on the Continue block; Continue reopens THAT attempt's file", async () => {
    sw.on = true;
    phone([kept("rec-a", { link: dc("att-a-000001") })]);
    openAt(COACHING_NEW);
    expect(await screen.findByText("Your recording was paused abruptly.")).toBeInTheDocument();
    expect(screen.getByTestId("paused-label").textContent).toContain("General Science");
    fireEvent.click(screen.getByRole("button", { name: "Continue recording" }));
    await waitFor(() => expect(session.restore).toHaveBeenCalledTimes(1));
    const arg = session.restore.mock.calls[0][0] as unknown as { kept: { meta: { id: string } }; beat: { attemptId?: string } };
    expect(arg.kept.meta.id).toBe("rec-a");
    expect(arg.beat.attemptId).toBe("att-a-000001");
  });

  it("Record a different lesson: a fresh file with a new attempt; the paused one is not touched", async () => {
    sw.on = true;
    phone([kept("rec-a", { link: dc("att-a-000001") })]);
    openAt(COACHING_NEW);
    fireEvent.click(await screen.findByRole("button", { name: "Record a different lesson" }));
    const beat = await recordLesson();
    expect(beat.attemptId).not.toBe("att-a-000001");
    expect(session.restore).not.toHaveBeenCalled();
  });

  it("a fresh lesson with nothing kept carries its new attempt id from Start", async () => {
    sw.on = true;
    phone([]);
    openAt(COACHING_NEW);
    const beat = await recordLesson();
    expect(beat).toMatchObject({ kind: "dc" });
    expect(typeof beat.attemptId).toBe("string");
  });

  it("one kept before this (no attempt), cut minutes ago: never reopened; offered on its own card, sent on its own", async () => {
    sw.on = true;
    phone([kept("rec-legacy", { link: null })]);
    openAt(COACHING_NEW);
    const card = await screen.findByTestId("dc-kept-unlinked");
    expect(card.textContent).toMatch(/Unlinked recording from \d{1,2}:\d{2}/);
    expect(screen.queryByRole("button", { name: "Continue recording" })).toBeNull();
    fireEvent.click(card);
    expect(await screen.findByTestId("dc-recording")).toBeInTheDocument(); // attached as this screen's recording
    expect(session.restore).not.toHaveBeenCalled();
  });

  it("the DC page lists each kept recording on its own card, each opening its own", async () => {
    sw.on = true;
    phone([
      kept("rec-a", { link: dc("att-a-000001") }),
      kept("rec-b", { link: dc("att-b-000002"), finished: true, agoMin: 90, elapsedMin: 29 }),
      kept("rec-legacy", { link: null, finished: true, agoMin: 600, elapsedMin: 31 }),
    ]);
    openAt(COACHING_HOME);
    const paused = await screen.findByTestId("dc-kept-paused");
    const unsent = await screen.findByTestId("dc-kept-unsent");
    const unlinked = await screen.findByTestId("dc-kept-unlinked");
    expect(paused.getAttribute("href")).toBe(`${COACHING_NEW}?kept=rec-a`);
    expect(unsent.getAttribute("href")).toBe(`${COACHING_NEW}?kept=rec-b`);
    expect(unlinked.getAttribute("href")).toBe(`${COACHING_NEW}?kept=rec-legacy`);
    expect(paused.textContent).toContain("General Science");
  });

  it("opened for one kept recording (?kept=): a stopped one comes attached as this screen's recording", async () => {
    sw.on = true;
    phone([kept("rec-a", { link: dc("att-a-000001") }), kept("rec-b", { link: dc("att-b-000002"), finished: true, agoMin: 90, elapsedMin: 29 })]);
    openAt(`${COACHING_NEW}?kept=rec-b`);
    const card = await screen.findByTestId("dc-recording");
    expect(card.textContent).toContain(C.minutes(29));
    expect(screen.queryByText("Your recording was paused abruptly.")).toBeNull();
  });

  it("an old-recorder take (before 25 Nov 22:52) of 10 min, cut long ago: still found, on its own card", async () => {
    sw.on = true;
    phone([kept("rec-old10", { link: null, agoMin: 26 * 60, elapsedMin: 10 })]);
    openAt(COACHING_HOME);
    expect(await screen.findByTestId("dc-kept-unlinked")).toBeInTheDocument();
  });
});
