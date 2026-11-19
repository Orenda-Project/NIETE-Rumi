import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-r2uzg1.18.8 — ICT DC row 154: a teacher recorded a class on the one screen, and the recording was gone.
 *
 * The recorder writes every chunk to the phone as it records (lib/lessonRecorder → lib/recordingStore), but the one
 * screen only ever looked at the copy it held in memory (draft.ts). A new page load (WhatsApp's browser closed, the
 * phone ended the page, a fresh link), or opening the screen again from the main page, and the screen came up empty:
 * the recording was still on the phone and nothing ever offered it.
 *
 *   A  a recording left on this phone, not sent, is offered on the screen: "Recording not sent · 27 min · Today"
 *   B  choosing it attaches it (Listen / Redo) — before she picks a class too; Submit sends it, then it leaves the phone
 *   C  Redo throws it away: off the phone, and not offered again
 *   D  the recording running now, or the one already on the screen, is never offered as "not sent"
 *   E  nothing on the phone, or no phone storage: the screen as before
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null as string | null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(), setChunkListener: vi.fn(),
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

// main: the coaching pages are static imports here (no lazyPage chunks), so nothing to preload.

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
  session.recordingId = null;
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

describe("a recording left on the phone, not sent (ICT DC row 154)", () => {
  it("A — opening the screen offers it, with its length and day, before she picks anything", async () => {
    open();
    const offer = await screen.findByTestId("dc-unsent");
    expect(offer.textContent).toContain(C.recordingNotSent);
    expect(offer.textContent).toContain(C.minutes(27));
    expect(offer.textContent).toContain(C.addDetailsSend);
  });

  it("A — the screen opened afresh (the main page's Start, not Back) still finds it: the copy in memory was replaced", async () => {
    // What the screen held before she left it; a fresh open starts empty and holds nothing.
    holdDraft({ audio: null, plan: null, photos: [], cls: null });
    open();
    expect(await screen.findByTestId("dc-unsent")).toBeTruthy();
  });

  it("B — choosing it attaches it, before a class; with her class Submit sends those bytes, then it leaves the phone", async () => {
    open();
    fireEvent.click(await screen.findByTestId("dc-unsent"));
    const card = await screen.findByTestId("dc-recording");
    expect(card.textContent).toContain(C.yourRecording);
    expect(card.textContent).toContain(C.minutes(27));
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
    await pickClass();
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalledTimes(1));
    const args = sendLesson.mock.calls[0][0] as { audio: { blob: Blob; filename: string } };
    expect(args.audio.blob).toBe(BYTES);
    expect(args.audio.filename).toMatch(/\.webm$/);
    await waitFor(() => expect(store.deleteRecording).toHaveBeenCalledWith(REC));
  });

  it("C — Redo throws it away: off the phone, and not offered again", async () => {
    open();
    fireEvent.click(await screen.findByTestId("dc-unsent"));
    const card = await screen.findByTestId("dc-recording");
    fireEvent.click(within(card).getByRole("button", { name: new RegExp(C.redo) }));
    await waitFor(() => expect(store.deleteRecording).toHaveBeenCalledWith(REC));
    await waitFor(() => expect(screen.queryByTestId("dc-recording")).toBeNull());
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
  });

  it("D — the recording running now is never offered as not sent", async () => {
    session.active = true;
    session.recordingId = REC;
    open();
    await screen.findByTestId("dc-new");
    await waitFor(() => expect(store.latestUnsent).toHaveBeenCalled());
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
  });

  it("D — the recording already on the screen (Back from the library) is shown once, as the recording, not offered again", async () => {
    holdDraft({
      audio: { blob: BYTES, filename: "Lesson.webm", durationMs: 27 * 60_000, recordingId: REC, source: "recorded", size: BYTES.size, startedAt: null },
      plan: null, photos: [], cls: { grade: 4, subject: "General Science", subjectKey: "science" },
    });
    render(
      <MemoryRouter initialEntries={[{ pathname: COACHING_NEW, state: { keep: true } }]}>
        <Routes>
          {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    await waitFor(() => expect(store.latestUnsent).toHaveBeenCalled());
    fireEvent.click(within(screen.getByTestId("dc-recording")).getByRole("button", { name: new RegExp(C.redo) }));
    await waitFor(() => expect(store.deleteRecording).toHaveBeenCalledWith(REC));
    await waitFor(() => expect(screen.queryByTestId("dc-recording")).toBeNull());
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
  });

  it("E — nothing on the phone, or no phone storage: nothing offered", async () => {
    store.latestUnsent.mockImplementation(async () => null);
    const first = open();
    await screen.findByTestId("dc-new");
    await waitFor(() => expect(store.latestUnsent).toHaveBeenCalled());
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
    first.unmount();
    store.latestUnsent.mockImplementation(async () => { throw new Error("IndexedDB is not available"); });
    open();
    await screen.findByTestId("dc-new");
    await waitFor(() => expect(store.latestUnsent).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("dc-unsent")).toBeNull();
  });
});
