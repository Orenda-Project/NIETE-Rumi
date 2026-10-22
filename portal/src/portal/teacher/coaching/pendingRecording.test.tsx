import { createHash } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-c5reix — a classroom recording she sent on WhatsApp waits for her in Digital Coaching.
 *
 *   AC7  a waiting recording is on the main page and on the one screen; opening it attaches it (Listen / Change);
 *        Submit with her class sends its KEY — no audio presign or upload
 *   AC8  the same recording again, wherever it comes in:
 *          a waiting one she has sent before → says so, Open report, never Submit
 *          a file she picks that she has sent before → says so BEFORE anything is uploaded
 *          a saved recording sent twice (409 already_sent) → says so, Open that DC observation
 *   The link from WhatsApp opens the one screen with the newest waiting recording attached (?recording=whatsapp).
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

import "../routes";
import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import coachingRoutes from "./routes";
import { COACHING_HOME, COACHING_NEW, lessonPath } from "./paths";
import { clearDraft } from "./draft";
import { SendError } from "../../lib/coachingSend";
import { COACHING_V2_COPY as C } from "./copy";

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

describe("the main page", () => {
  it("a recording waiting from WhatsApp is shown, and opens the one screen with it", async () => {
    at(COACHING_HOME);
    const banner = await screen.findByTestId("dc-waiting");
    expect(banner.textContent).toContain(C.fromWhatsApp);
    expect(banner.textContent).toContain(C.minutes(30));
    expect(banner.textContent).toContain(C.addDetailsSend);
    expect(banner.getAttribute("href")).toBe(`${COACHING_NEW}?recording=${ID}`);
  });

  it("one she has sent before says so and opens that report — never the one screen", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [waiting({ duplicateOf: { sessionId: "cs-0", date: "2026-10-01T09:00:00Z" } })] });
    at(COACHING_HOME);
    const banner = await screen.findByTestId("dc-waiting");
    expect(banner.textContent).toContain(C.sentBefore);
    expect(banner.getAttribute("href")).toBe(lessonPath("cs-0"));
  });

  it("nothing waiting (or the list could not load): nothing shown, the page as before", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [] });
    at(COACHING_HOME);
    await screen.findByRole("link", { name: new RegExp(C.startObservation) });
    expect(screen.queryByTestId("dc-waiting")).toBeNull();
    delete answers["/coaching-upload/pending"];
    at(COACHING_HOME);
    await screen.findAllByRole("link", { name: new RegExp(C.startObservation) });
    expect(screen.queryByTestId("dc-waiting")).toBeNull();
  });
});

describe("the one screen", () => {
  it("the WhatsApp link (?recording=whatsapp) attaches the newest waiting recording, before she picks a class", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [waiting(), waiting({ id: OLDER, key: KEY.replace(ID, OLDER), seconds: 2400 })] });
    at(`${COACHING_NEW}?recording=whatsapp`);
    const card = await screen.findByTestId("dc-recording");
    expect(card.textContent).toContain(C.fromWhatsApp);
    expect(card.textContent).toContain(C.minutes(30));
  });

  it("AC7 — with her class, Submit sends the saved recording's key: nothing to upload", async () => {
    at(`${COACHING_NEW}?recording=${ID}`);
    await screen.findByTestId("dc-recording");
    await pickClass();
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalledTimes(1));
    const args = sendLesson.mock.calls[0][0] as { audio: unknown; teacherClass: unknown };
    expect(args.audio).toEqual({ key: KEY });
    expect(args.teacherClass).toEqual(expect.objectContaining({ grade: 4, subject: "General Science" }));
  });

  it("a waiting recording is offered on the one screen too; choosing it attaches it", async () => {
    at(COACHING_NEW);
    await pickClass();
    fireEvent.click(await screen.findByTestId("dc-waiting"));
    expect((await screen.findByTestId("dc-recording")).textContent).toContain(C.fromWhatsApp);
  });

  it("Change lets go of it: the recording choices come back", async () => {
    at(`${COACHING_NEW}?recording=${ID}`);
    await pickClass();
    fireEvent.click(within(await screen.findByTestId("dc-recording")).getByRole("button", { name: new RegExp(C.change) }));
    await waitFor(() => expect(screen.queryByTestId("dc-recording")).toBeNull());
    expect(await screen.findByRole("button", { name: C.recording })).toBeTruthy();
    // and it is still waiting, to take again
    expect(screen.getByTestId("dc-waiting")).toBeTruthy();
  });

  it("AC8 — a waiting recording she has sent before: the repeat note and Open report, nothing attached, no Submit", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [waiting({ duplicateOf: { sessionId: "cs-0", date: "2026-10-01T09:00:00Z" } })] });
    at(`${COACHING_NEW}?recording=whatsapp`);
    const note = await screen.findByTestId("dc-repeat");
    expect(note.textContent).toContain(C.duplicateBeforeLead);
    expect(within(note).getByRole("link", { name: C.openReport }).getAttribute("href")).toBe(lessonPath("cs-0"));
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    await pickClass();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("AC8 — a file she has sent before is caught BEFORE any upload: the repeat note, nothing attached", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [] });
    const asked: unknown[] = [];
    posts["/coaching-upload/check-duplicate"] = (body) => { asked.push(body); return { success: true, duplicateOf: { sessionId: "cs-0", date: "2026-10-01T09:00:00Z" } }; };
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [new File(["same lesson"], "lesson.m4a", { type: "audio/mp4" })] } });
    const note = await screen.findByTestId("dc-repeat");
    expect(note.textContent).toContain(C.duplicateBeforeLead);
    // The bytes' sha256, as the bot's dedupe hashes them (audio-hash-cache computeAudioHash).
    expect(asked).toEqual([{ sha256: createHash("sha256").update("same lesson").digest("hex") }]);
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    expect(portal.presignCoachingUpload).not.toHaveBeenCalled();
    expect(sendLesson).not.toHaveBeenCalled();
  });

  it("AC8 — beside Open report, an explicit Select another recording opens the picker", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [] });
    posts["/coaching-upload/check-duplicate"] = () => ({ success: true, duplicateOf: { sessionId: "cs-0", date: "2026-10-01T09:00:00Z" } });
    at(COACHING_NEW);
    await pickClass();
    const input = await screen.findByTestId("dc-audio-input");
    fireEvent.change(input, { target: { files: [new File(["same lesson"], "lesson.m4a", { type: "audio/mp4" })] } });
    const note = await screen.findByTestId("dc-repeat");
    expect(within(note).getByRole("link", { name: C.openReport })).toBeTruthy();
    const click = vi.spyOn(input as HTMLInputElement, "click");
    fireEvent.click(within(note).getByRole("button", { name: C.selectAnother }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("AC8 — a repeat file picked after another one was attached: the earlier one is let go, Submit is not armed", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [] });
    at(COACHING_NEW);
    await pickClass();
    const input = await screen.findByTestId("dc-audio-input");
    fireEvent.change(input, { target: { files: [new File(["new lesson"], "first.m4a", { type: "audio/mp4" })] } });
    expect(await screen.findByRole("button", { name: C.submit })).toBeTruthy();
    posts["/coaching-upload/check-duplicate"] = () => ({ success: true, duplicateOf: { sessionId: "cs-0", date: "2026-10-01T09:00:00Z" } });
    fireEvent.change(input, { target: { files: [new File(["same lesson"], "second.m4a", { type: "audio/mp4" })] } });
    expect(await screen.findByTestId("dc-repeat")).toBeTruthy();
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("while a picked file is checked: Checking…, and no Submit until the answer", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [] });
    let answer: (v: unknown) => void = () => {};
    posts["/coaching-upload/check-duplicate"] = () => new Promise((resolve) => { answer = resolve; });
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [new File(["new lesson"], "lesson.m4a", { type: "audio/mp4" })] } });
    expect(await screen.findByText(C.checking)).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    await waitFor(() => expect(http.post).toHaveBeenCalledWith("/coaching-upload/check-duplicate", expect.anything()));
    expect(screen.getByText(C.checking)).toBeTruthy();
    answer({ success: true, duplicateOf: null });
    expect(await screen.findByRole("button", { name: C.submit })).toBeTruthy();
    expect(screen.queryByText(C.checking)).toBeNull();
  });

  it("a file she has not sent before is attached as always", async () => {
    answers["/coaching-upload/pending"] = () => ({ success: true, recordings: [] });
    at(COACHING_NEW);
    await pickClass();
    fireEvent.change(await screen.findByTestId("dc-audio-input"), { target: { files: [new File(["new lesson"], "lesson.m4a", { type: "audio/mp4" })] } });
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    expect(screen.queryByTestId("dc-repeat")).toBeNull();
  });

  it("AC8 — a saved recording already sent (409 already_sent): says so, Open that DC observation", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("already_sent" as never, "cs-first"));
    at(`${COACHING_NEW}?recording=${ID}`);
    await screen.findByTestId("dc-recording");
    await pickClass();
    fireEvent.click(await screen.findByRole("button", { name: C.submit }));
    expect(await screen.findByText(C.alreadySent)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.openThat }).getAttribute("href")).toBe(lessonPath("cs-first"));
  });
});
