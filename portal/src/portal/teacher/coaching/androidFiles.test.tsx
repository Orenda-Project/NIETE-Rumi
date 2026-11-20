import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-bsc0ox (queue #200) — the teacher's Digital Coaching in the Android app lost the recording she PICKED.
 *
 * Production, 18 Nov: a teacher on the one screen (/portal/teacher/coaching/new, the NIETE Android app) picked a
 * 3.7 MB recording; Submit stopped 8 times in 3 minutes on reading it (NotReadableError, nothing sent) and it went only
 * once she picked it again. Queue #189 counted 315 such "unreadable" failures in the app in 14 days and none in
 * WhatsApp's browser. Photos have been read at the pick since bd-r2uzg1.9; the coach's files since bd-tymy1n (#179).
 * So a recording she picks, and a lesson-plan file she picks, are read the moment she picks them and the page keeps
 * those bytes; a file the phone will not open is refused right there ("File will not open"), with its reason in the
 * logs; and a file that would not open at Submit is never called "No internet".
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async (..._a: unknown[]) => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(async () => ({ id: "sess-1", status: "analysing", stage: "analysing", reflection: null })),
  submitCoachingReflection: vi.fn(async () => ({ acknowledgement: "Thank you" })),
  getCoachingSession: vi.fn(),
  answerClassCheck: vi.fn(async (..._a: unknown[]) => ({ next: "analysis" })),
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
const reportSendFailure = vi.hoisted(() => vi.fn());
vi.mock("../../lib/dcUploadReport", async (orig) => ({ ...(await orig<typeof import("../../lib/dcUploadReport")>()), reportSendFailure }));

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import type { Audio } from "../../newui/coaching/useSendFlow";
import { isHeld } from "../../lib/pickedRead";
import { readBytes } from "../../lib/audioHash";
import coachingRoutes from "./routes";
import { COACHING_NEW, COACHING_SEND } from "./paths";
import { clearDraft, holdDraft, isSavedAudio, peekDraft } from "./draft";
import { SendError, type SendDetail } from "../../lib/coachingSend";
import { COACHING_V2_COPY as C } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import * as lazyPages from "@/lib/lazyPage";

// Sandbox and staging preload every lazy page first (lazyPage.preloadAll); main's lazyPage has no such helper yet, and
// this one file is carried to all three branches.
const preloadAll = (lazyPages as { preloadAll?: (o: { pages: boolean }) => Promise<unknown> }).preloadAll;
if (preloadAll) preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  session.active = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => true);
  const answers: Record<string, () => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", featureKey: "general_science", source: "class", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [] }),
    "/teacher/coaching/history": () => ({ success: true, items: [], kpis: {}, trend: { bucketDays: 1, points: [] }, total: 0 }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
    "/lp612/grades": () => ({ grades: [] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "general_science", subject: "General Science", lesson_count: 40 }] }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit() };
  });
  http.post.mockResolvedValue({ data: { duplicateOf: null } });
});
afterEach(() => { vi.restoreAllMocks(); });

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}
function at(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const M4A = [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 7, 7];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 7, 7];
const notReadable = () => Object.assign(new Error("The requested file could not be read"), { name: "NotReadableError" });

/**
 * A file as the Android app hands it over: it opens while she is picking it, and `lose()` is the WebView letting go of
 * it a little later (what production showed by Submit).
 */
function picked(name: string, type: string, bytes: number[]) {
  const f = new File([new Uint8Array(bytes)], name, { type });
  let open = true;
  Object.defineProperty(f, "arrayBuffer", {
    value: () => (open ? Promise.resolve(new Uint8Array(bytes).buffer) : Promise.reject(notReadable())),
  });
  return { file: f, lose: () => { open = false; } };
}
/** A file this phone never opens. */
function neverOpens(name: string, type: string, bytes: number[]) {
  const f = new File([new Uint8Array(bytes)], name, { type });
  Object.defineProperty(f, "arrayBuffer", { value: () => Promise.reject(notReadable()) });
  return f;
}
/** jsdom's Blob has no arrayBuffer(): the app's own reader (FileReader when needed). */
const bytesOf = async (b: Blob) => Array.from(new Uint8Array(await readBytes(b)));

async function pickClass() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
}
async function openPlanTray() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.selectPlan) }));
  return screen.findByRole("dialog", { name: new RegExp(C.lessonPlan) });
}
type Sent = { audio: { blob: Blob }; plan: { kind: string; file?: File } | null };
const sentPayload = () => sendLesson.mock.calls[0][0] as unknown as Sent;

describe("the one screen reads the recording she picks when she picks it (bd-bsc0ox)", () => {
  it("Submit sends the page's own copy of the recording, even once the phone has let go of the picked file", async () => {
    const rec = picked("lesson.m4a", "audio/mp4", M4A);
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [rec.file] } });
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    rec.lose();
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const { blob } = sentPayload().audio;
    expect(isHeld(blob)).toBe(true);
    expect(await bytesOf(blob)).toEqual(M4A);
    expect(reportSendFailure).not.toHaveBeenCalled();
  });

  it("a recording the phone will not open is refused at the pick: File will not open, nothing attached, the logs say why", async () => {
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [neverOpens("lesson.m4a", "audio/mp4", M4A)] } });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toBe(C.fileWontOpen);
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({
      stage: "pick", kind: "audio", reason: "unreadable", errName: "NotReadableError", sentBytes: 0, sentAs: "none",
    }));
  });

  it("picking another recording that opens clears the line and attaches it", async () => {
    at(COACHING_NEW);
    await pickClass();
    const input = await screen.findByTestId("dc-audio-input");
    fireEvent.change(input, { target: { files: [neverOpens("lesson.m4a", "audio/mp4", M4A)] } });
    await screen.findByRole("alert", undefined, { timeout: 4000 });
    fireEvent.change(input, { target: { files: [picked("lesson2.m4a", "audio/mp4", M4A).file] } });
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    expect(screen.queryByText(C.fileWontOpen)).toBeNull();
  });
});

describe("the one screen reads a lesson-plan file she picks when she picks it (bd-bsc0ox)", () => {
  it("Submit sends the page's own copy of her plan, even once the phone has let go of it", async () => {
    const plan = picked("my plan.pdf", "application/pdf", PDF);
    at(COACHING_NEW);
    await pickClass();
    const tray = await openPlanTray();
    fireEvent.change(within(tray).getByTestId("plan-file-input"), { target: { files: [plan.file] } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: new RegExp(C.lessonPlan) })).toBeNull());
    expect(await screen.findByText("my plan.pdf")).toBeTruthy();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [picked("lesson.m4a", "audio/mp4", M4A).file] } });
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    plan.lose();
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const sent = sentPayload().plan;
    expect(sent?.kind).toBe("file");
    expect(isHeld(sent?.file as File)).toBe(true);
    expect(await bytesOf(sent?.file as File)).toEqual(PDF);
  });

  it("a plan file the phone will not open: File will not open, no plan attached, the logs say lesson_plan at the pick", async () => {
    at(COACHING_NEW);
    await pickClass();
    const tray = await openPlanTray();
    fireEvent.change(within(tray).getByTestId("plan-file-input"), { target: { files: [neverOpens("my plan.pdf", "application/pdf", PDF)] } });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toBe(C.fileWontOpen);
    expect(screen.queryByText("my plan.pdf")).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(C.selectPlan) })).toBeTruthy();
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "lesson_plan", reason: "unreadable" }));
  });
});

const failed = (detail: SendDetail) => new SendError("network", undefined, undefined, detail);
const audioPart = { kind: "audio" as const, photo: 0 };

describe("a file that would not open at Submit is never called 'No internet' (bd-bsc0ox)", () => {
  it("the one screen, phone offline too: Recording not sent and File will not open, with Change file", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: audioPart, offline: true, unreadable: true }));
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [picked("lesson.m4a", "audio/mp4", M4A).file] } });
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    const card = await screen.findByRole("alert");
    expect(within(card).getByText(C.recordingNotSent)).toBeTruthy();
    expect(within(card).getByText(C.fileWontOpen)).toBeTruthy();
    expect(within(card).getByRole("button", { name: C.changeFile })).toBeTruthy();
    expect(screen.queryByText(C.noInternet)).toBeNull();
  });
});

const audioOf = (over: Partial<Audio> = {}): Audio => ({
  blob: new Blob(["a"], { type: "audio/mp4" }), filename: "lesson.m4a", durationMs: 1_800_000,
  recordingId: null, source: "file", size: 1, startedAt: null, ...over,
});

describe("the send page reads a recording she picks when she picks it (bd-bsc0ox)", () => {
  it("Microphone blocked → Upload recording: the recording the page keeps is its own copy", async () => {
    session.start.mockImplementationOnce(async () => "blocked");
    const rec = picked("lesson.m4a", "audio/mp4", M4A);
    at(COACHING_SEND, { start: "record" });
    expect(await screen.findByText(C.micBlocked)).toBeTruthy();
    fireEvent.change(screen.getByTestId("dc-send-audio-input"), { target: { files: [rec.file] } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW));
    rec.lose();
    const kept = peekDraft()?.audio;
    expect(kept && !isSavedAudio(kept) && isHeld(kept.blob)).toBe(true);
    expect(await bytesOf((kept as Audio).blob)).toEqual(M4A);
  });

  it("a recording the phone will not open: File will not open, she stays to pick another, the logs say why", async () => {
    session.start.mockImplementationOnce(async () => "blocked");
    at(COACHING_SEND, { start: "record" });
    expect(await screen.findByText(C.micBlocked)).toBeTruthy();
    fireEvent.change(screen.getByTestId("dc-send-audio-input"), { target: { files: [neverOpens("lesson.m4a", "audio/mp4", M4A)] } });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toBe(C.fileWontOpen);
    expect(screen.getByTestId("where").textContent).toBe(COACHING_SEND);
    expect(screen.getByRole("button", { name: C.uploadRecording })).toBeTruthy();
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "audio", reason: "unreadable" }));
  });

  it("Submit's recording would not open: Recording not sent and File will not open, with Change file, not No internet", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: audioPart, offline: false, unreadable: true }));
    holdDraft({ audio: audioOf(), plan: null, photos: [] });
    at(COACHING_SEND, { start: "submit" });
    expect(await screen.findByText(C.recordingNotSent)).toBeTruthy();
    expect(screen.getByText(C.fileWontOpen)).toBeTruthy();
    expect(screen.queryByText(C.noInternet)).toBeNull();
    const click = vi.spyOn(screen.getByTestId("dc-send-audio-input"), "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: C.changeFile }));
    expect(click).toHaveBeenCalled();
  });

  it("Submit's photo would not open: Photo 2 not sent and File will not open; back to the page, its draft kept", async () => {
    sendLesson.mockRejectedValueOnce(failed({ part: { kind: "photo", photo: 2 }, offline: false, unreadable: true }));
    holdDraft({ audio: audioOf(), plan: null, photos: [] });
    at(COACHING_SEND, { start: "submit" });
    expect(await screen.findByText(C.photoNotSent(2))).toBeTruthy();
    expect(screen.getByText(C.fileWontOpen)).toBeTruthy();
    expect(screen.queryByText(C.noInternet)).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: C.title }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW));
    expect(peekDraft()?.audio).toBeTruthy();
  });
});
