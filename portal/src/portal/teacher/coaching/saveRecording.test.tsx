import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-bmc9a0.2 — ICT IAB Experience View row 31: "If a teacher records or uploads a lesson but doesn't want to proceed
 * to the reflection or feedback page yet, there should be a 'Save Recording' button so they can save it and continue
 * later." The mockup ICT saw: a full-width outlined «ریکارڈنگ محفوظ کریں» under the class-recording card, then
 * «ریکارڈنگ محفوظ ہو گئی۔ بعد میں یہیں سے Reflection اور فیڈ بیک پر جائیں۔».
 *
 * Save sends the lesson as Submit does (the recording goes to the server and the analysis starts, so nothing on the
 * phone can lose it) with saveForLater, and the screen says it is saved instead of walking her through the progress
 * and the reflection. The lesson is then on the main page; its own page carries the reflection and the report.
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
const duration = vi.hoisted(() => ({ seconds: 1800 }));
vi.mock("../../lib/coachingUpload", async (orig) => ({
  ...(await orig<typeof import("../../lib/coachingUpload")>()),
  readAudioDuration: vi.fn(async () => duration.seconds),
}));

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import coachingRoutes from "./routes";
import { COACHING_NEW } from "./paths";
import { clearDraft } from "./draft";
import { SendError } from "../../lib/coachingSend";
import { COACHING_V2_COPY as C, COACHING_V2_COPY_UR as UR } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

preloadFirst(() => preloadAll({ pages: true }), 120_000);

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const W = C as unknown as Record<string, string>;
const WUR = UR as unknown as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  resetLessonPlans();
  session.active = false;
  duration.seconds = 1800;
  const answers: Record<string, () => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", featureKey: "general_science", source: "class", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [] }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 1 }] }),
    "/lp612/grades": () => ({ grades: [] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "general_science", subject: "General Science", lesson_count: 40 }] }),
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
function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {coachingRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const m4a = () => new File(["a"], "lesson.m4a", { type: "audio/mp4" });
async function pickClass() {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) }));
  const tray = screen.getByRole("dialog", { name: C.gradeAndSubject });
  fireEvent.click(await within(tray).findByRole("radio", { name: /^Grade 4/ }));
  fireEvent.click(await within(tray).findByRole("button", { name: /Grade 4 · General Science/ }));
}
async function attachRecording() {
  fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
  await screen.findByText(C.photos);
}
const saveButton = () => screen.queryByRole("button", { name: W.saveRecording });

describe("row 31 — the Save recording button", () => {
  it("says what ICT approved, in both languages", () => {
    expect(W.saveRecording).toBe("Save recording");
    expect(WUR.saveRecording).toBe("ریکارڈنگ محفوظ کریں");
    expect(W.recordingSaved).toBe("Recording saved. Come back here later for the reflection and feedback.");
    expect(WUR.recordingSaved).toBe("ریکارڈنگ محفوظ ہو گئی۔ بعد میں یہیں سے Reflection اور فیڈ بیک پر جائیں۔");
  });

  it("is not there before a grade and subject and a recording", async () => {
    at(COACHING_NEW);
    await screen.findByRole("button", { name: new RegExp(C.gradeAndSubject) });
    expect(saveButton()).toBeNull();
    await pickClass();
    await screen.findByRole("button", { name: new RegExp(`^${C.recording}`) });
    expect(saveButton()).toBeNull();
  });

  it("is under the class-recording card once the recording is in, before Photos", async () => {
    at(COACHING_NEW);
    await pickClass();
    await attachRecording();
    const save = await screen.findByRole("button", { name: W.saveRecording });
    const changeFile = screen.getByRole("button", { name: new RegExp(C.changeFile) });
    const photos = screen.getByText(C.photos);
    // eslint-disable-next-line no-bitwise
    expect(changeFile.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(save.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not offered for a recording under 15 minutes (the same rule as Submit)", async () => {
    duration.seconds = 600;
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [m4a()] } });
    await screen.findByText(C.tooShort);
    expect(saveButton()).toBeNull();
  });
});

describe("row 31 — tapping Save", () => {
  it("sends the lesson with her class and saveForLater, then says it is saved — no progress, no question", async () => {
    at(COACHING_NEW);
    await pickClass();
    await attachRecording();
    fireEvent.click(await screen.findByRole("button", { name: W.saveRecording }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalledTimes(1));
    const args = sendLesson.mock.calls[0][0] as { teacherClass: unknown; saveForLater?: boolean };
    expect(args.saveForLater).toBe(true);
    expect(args.teacherClass).toEqual(expect.objectContaining({ grade: 4, subject: "General Science" }));
    expect(await screen.findByText(W.recordingSaved)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(W.recordingSaved);
    expect(screen.queryByRole("region", { name: C.progress })).toBeNull();
    expect(screen.queryByRole("textbox", { name: C.yourAnswer })).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    expect(saveButton()).toBeNull();
    expect(portal.getCoachingProgress).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe(`${COACHING_NEW}?saved=sess-1`);
  });

  it("Submit is unchanged: it sends no saveForLater", async () => {
    at(COACHING_NEW);
    await pickClass();
    await attachRecording();
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalledTimes(1));
    expect((sendLesson.mock.calls[0][0] as { saveForLater?: boolean }).saveForLater).toBeUndefined();
  });

  it("a save that fails comes back to her screen with what she chose, as Submit does", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("network"));
    at(COACHING_NEW);
    await pickClass();
    await attachRecording();
    fireEvent.click(await screen.findByRole("button", { name: W.saveRecording }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(W.recordingSaved)).toBeNull();
    expect(await screen.findByRole("button", { name: W.saveRecording })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe(COACHING_NEW);
  });
});
