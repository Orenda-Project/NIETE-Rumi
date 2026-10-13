import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fmf24g.4 + bd-fmf24g.76 — the teacher v2 Digital Coaching pages, in the WhatsApp flow's order and with no class.
 *
 *   page    Record lesson / Upload recording first. Upload attaches in place; Record opens the recording page and comes
 *           back here with the recording. Once there is one: Listen / Redo / Change file, Lesson plan (optional),
 *           Photos (up to ten, No faces) and the one Submit, on with only a recording. Recent DC Observations
 *           (collapsed). Opened from a lesson plan (?plan=k5:|g612:&lang) the plan arrives filled in.
 *   send    the recording page, and the sending: Submit sends exactly what the page holds, and no class.
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

// The registry first, as the app loads it: it pulls in every feature's routes (a page imported first
// would be mid-load when its own routes.tsx renders it).
import "../routes";
import api from "../../services/api";
import { CoachingHomePage } from "./CoachingHome";
import { SendPage } from "./SendPage";
import coachingRoutes from "./routes";
import type { Audio } from "../../newui/coaching/useSendFlow";
import { SendError } from "../../lib/coachingSend";
import { clearDraft, holdDraft, peekDraft, readPrefill } from "./draft";
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

const audioOf = (name = "lesson.m4a"): Audio => ({
  blob: new Blob(["a"]), filename: name, durationMs: 1_800_000, recordingId: null, source: "file", size: 1, startedAt: null,
});
const m4a = (name = "lesson.m4a") => new File(["a"], name, { type: "audio/mp4" });
const jpg = (n: string) => new File(["x"], n, { type: "image/jpeg" });
const recordBtn = () => screen.getByRole("button", { name: C.recordTitle });
const uploadBtn = () => screen.getByRole("button", { name: C.uploadRecording });

/** She uploads a recording on the page; resolves once it is attached. */
async function attach(name = "lesson.m4a") {
  fireEvent.change(screen.getByTestId("dc-audio-input"), { target: { files: [m4a(name)] } });
  await screen.findByTestId("dc-recording");
}

describe("the page: no class, the recording first", () => {
  it("opens with Record lesson and Upload recording; no class picker, her classes never read, nothing else yet", async () => {
    at(COACHING_HOME);
    // The first test of the file also loads the page's module graph: room for a slow, loaded run.
    await waitFor(() => expect(recordBtn()).toBeTruthy(), { timeout: 5000 });
    expect(uploadBtn()).toBeTruthy();
    expect(screen.queryByText(/class/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: C.lessonPlan })).toBeNull();
    expect(screen.queryByRole("heading", { name: new RegExp(C.photos) })).toBeNull();
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
    expect(http.get).not.toHaveBeenCalledWith("/me/grade-subjects", expect.anything());
  });

  it("Upload attaches the file in place: the recording (Listen, Change file), then Lesson plan, Photos and ONE Submit, in that order, on with only a recording", async () => {
    at(COACHING_HOME);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    await attach("period3.m4a");
    expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME); // she never left the page
    const card = screen.getByTestId("dc-recording");
    expect(within(card).getByText("period3.m4a")).toBeTruthy();
    expect(within(card).getByRole("button", { name: C.listen })).toBeTruthy();
    expect(within(card).getByRole("button", { name: C.changeFile })).toBeTruthy();
    expect(screen.queryByRole("button", { name: C.recordTitle })).toBeNull(); // Record / Upload are replaced by her recording
    expect(screen.queryByRole("button", { name: new RegExp(C.recent) })).toBeNull(); // Recent steps aside while she sends one off

    const plan = screen.getByRole("heading", { name: new RegExp(C.lessonPlan) });
    const photos = screen.getByRole("heading", { name: new RegExp(C.photos) });
    const submit = screen.getByRole("button", { name: C.submit }) as HTMLButtonElement;
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(card, plan)).toBe(true);
    expect(before(plan, photos)).toBe(true);
    expect(before(photos, submit)).toBe(true);
    expect(screen.getAllByRole("button", { name: C.submit })).toHaveLength(1);
    expect(submit.disabled).toBe(false); // the plan and the photos are optional
  });

  it("a file that is not a recording, or is too big, is SAID and not attached (it used to be dropped without a word)", async () => {
    at(COACHING_HOME);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    fireEvent.change(screen.getByTestId("dc-audio-input"), { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
    expect((await screen.findByRole("alert")).textContent).toBe(C.notAudio);
    expect(screen.queryByTestId("dc-recording")).toBeNull();
    expect(uploadBtn()).toBeTruthy();
  });

  it("Change file keeps hers when the new one is refused", async () => {
    at(COACHING_HOME);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    await attach("first.m4a");
    fireEvent.change(screen.getByTestId("dc-audio-input"), { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
    expect((await screen.findByRole("alert")).textContent).toBe(C.notAudio);
    expect(within(screen.getByTestId("dc-recording")).getByText("first.m4a")).toBeTruthy();
    fireEvent.change(screen.getByTestId("dc-audio-input"), { target: { files: [m4a("second.m4a")] } });
    expect(await screen.findByText("second.m4a")).toBeTruthy();
  });

  it("Photos: one grid, the hint, Up to 10 and No faces; ten fit, the eleventh is refused", async () => {
    at(COACHING_HOME);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    await attach();
    const heading = screen.getByRole("heading", { name: new RegExp(C.photos) });
    expect(within(heading).getByText(C.upToPhotos(10))).toBeTruthy();
    expect(within(heading).getByText(C.noFaces)).toBeTruthy();
    expect(screen.getByText(C.photosHint)).toBeTruthy();
    const input = screen.getByTestId("dc-photos-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: Array.from({ length: 4 }, (_, i) => jpg(`a${i}.jpg`)) } });
    fireEvent.change(input, { target: { files: Array.from({ length: 4 }, (_, i) => jpg(`b${i}.jpg`)) } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(8);
    fireEvent.change(input, { target: { files: [jpg("c0.jpg"), jpg("c1.jpg")] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(10);
    expect(screen.queryByRole("button", { name: C.addPhoto })).toBeNull(); // full: no more room
    fireEvent.change(input, { target: { files: [jpg("d0.jpg")] } });
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(10);
    expect((await screen.findByRole("alert")).textContent).toBe(C.upToPhotos(10));
    fireEvent.click(screen.getAllByRole("button", { name: /Remove photo/ })[0]);
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(9);
  });

  it("from a lesson plan: the plan arrives filled in (named from her recent plans) once there is a recording; no class is taken from the link", async () => {
    at(`${COACHING_HOME}?grade=4&subject=science&plan=k5:L3`);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    await attach();
    expect(await screen.findByText("How plants make food")).toBeTruthy();
    expect(http.get).not.toHaveBeenCalledWith("/me/grade-subjects", expect.anything());
  });

  it("Submit with ONLY a recording sends it with NO class, and the page says Sent", async () => {
    at(COACHING_HOME);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    await attach();
    fireEvent.click(screen.getByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const [payload] = sendLesson.mock.calls[0] as unknown as [{ audio: { filename: string }; plan: unknown; photos: File[]; teacherClass: unknown }];
    expect(payload.audio.filename).toBe("lesson.m4a");
    expect(payload.plan).toBeNull();
    expect(payload.photos).toEqual([]);
    expect(payload.teacherClass).toBeNull(); // the server resolves the subject, as for a WhatsApp recording
    expect(await screen.findByRole("heading", { name: C.sent })).toBeTruthy();
    expect(peekDraft()).toBeNull(); // sent: nothing held
  });

  it("Submit sends the recording, the plan and TEN photos together", async () => {
    at(`${COACHING_HOME}?plan=k5:L3`);
    await waitFor(() => expect(uploadBtn()).toBeTruthy(), { timeout: 5000 });
    await attach();
    await screen.findByText("How plants make food");
    const photos = Array.from({ length: 10 }, (_, i) => jpg(`p${i}.jpg`));
    fireEvent.change(screen.getByTestId("dc-photos-input"), { target: { files: photos } });
    fireEvent.click(screen.getByRole("button", { name: C.submit }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const [payload] = sendLesson.mock.calls[0] as unknown as [{ plan: unknown; photos: File[]; teacherClass: unknown }];
    expect(payload.plan).toEqual({ kind: "library", pick: { lessonId: "L3" } });
    expect(payload.photos).toEqual(photos);
    expect(payload.teacherClass).toBeNull();
  });

  it("Record lesson opens the recording page and starts it; Stop, Yes finish brings her BACK here with the recording attached", async () => {
    at(COACHING_HOME);
    await waitFor(() => expect(recordBtn()).toBeTruthy(), { timeout: 5000 });
    session.start.mockImplementationOnce(async () => { session.active = true; return "recording"; });
    fireEvent.click(recordBtn());
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_SEND));
    expect(session.start).toHaveBeenCalledWith({ returnTo: COACHING_SEND });
    session.finish.mockImplementationOnce((async () => {
      session.active = false;
      return { blob: new Blob(["rec"]), type: { ext: "webm" }, durationMs: 1_200_000, id: "rec-1" };
    }) as never);
    fireEvent.click(await screen.findByRole("button", { name: C.stop }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: C.finishTitle })).getByRole("button", { name: C.yesFinish }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
    const card = await screen.findByTestId("dc-recording");
    expect(within(card).getByText(C.yourRecording)).toBeTruthy();
    expect(within(card).getByRole("button", { name: C.redo })).toBeTruthy(); // made here: Redo
    expect(screen.getByRole("button", { name: C.submit })).toBeTruthy();
    expect(sendLesson).not.toHaveBeenCalled(); // finishing does not send: Submit does
  });

  it("Redo deletes the phone copy and she is back to Record lesson / Upload recording", async () => {
    holdDraft({ audio: { ...audioOf(), source: "recorded", recordingId: "rec-9" }, plan: null, photos: [] });
    at(COACHING_HOME, { keep: true });
    fireEvent.click(await within(await screen.findByTestId("dc-recording", {}, { timeout: 5000 })).findByRole("button", { name: C.redo }));
    await waitFor(() => expect(recordBtn()).toBeTruthy());
    const store = await import("../../lib/recordingStore");
    expect(store.deleteRecording).toHaveBeenCalledWith("rec-9");
    expect(screen.queryByRole("button", { name: C.submit })).toBeNull();
  });

  it("Recent DC Observations: collapsed; open shows her lessons, an unscored one as Analysing", async () => {
    at(COACHING_HOME);
    const toggle = await screen.findByRole("button", { name: new RegExp(C.recent) }, { timeout: 5000 });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(await screen.findByText("Parts of a plant")).toBeTruthy();
    expect(screen.getByText(C.analysing)).toBeTruthy();
    expect(screen.getByText("Good")).toBeTruthy();
  });
});

describe("the send page", () => {
  it("no choice made (opened directly): back to the page", async () => {
    at(COACHING_SEND);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
  });

  it("Submit with nothing held goes back to the page rather than sending", async () => {
    at(COACHING_SEND, { start: "submit" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
    expect(sendLesson).not.toHaveBeenCalled();
  });

  it("Submit sends exactly what the page holds, with no class, then Sent and the ways on", async () => {
    const photo = jpg("board.jpg");
    holdDraft({ audio: audioOf(), plan: { kind: "library", pick: { lessonId: "L3" }, title: "How plants make food", chips: [] }, photos: [photo] });
    at(COACHING_SEND, { start: "submit" });
    await waitFor(() => expect(sendLesson).toHaveBeenCalled());
    const [payload] = sendLesson.mock.calls[0] as unknown as [{ plan: unknown; photos: File[]; teacherClass: unknown }];
    expect(payload.plan).toEqual({ kind: "library", pick: { lessonId: "L3" } });
    expect(payload.photos).toEqual([photo]);
    expect(payload.teacherClass).toBeNull();
    expect(await screen.findByRole("heading", { name: C.sent })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.openLesson })).toBeTruthy();
  });

  it("a network failure: No internet, Try again resends the same files (still no class)", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("network"));
    holdDraft({ audio: { ...audioOf(), source: "recorded", recordingId: "rec-2" }, plan: null, photos: [] });
    at(COACHING_SEND, { start: "submit" });
    expect(await screen.findByText(C.noInternet)).toBeTruthy();
    expect(screen.getByText(C.savedOnPhone)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.tryAgain }));
    await waitFor(() => expect(sendLesson).toHaveBeenCalledTimes(2));
    expect((sendLesson.mock.calls[1] as unknown as [{ teacherClass: unknown }])[0].teacherClass).toBeNull();
  });

  it("Not accepted: Try again goes back to the page with the recording, plan and photos still on it", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("refused"));
    const photo = jpg("board.jpg");
    holdDraft({ audio: audioOf(), plan: null, photos: [photo] });
    at(COACHING_SEND, { start: "submit" });
    fireEvent.click(await screen.findByRole("button", { name: C.tryAgain }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1);
  });

  it("Lesson plan not used: Change lesson plan drops that plan, goes back to the page and opens its plan sheet", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("plan_not_ready"));
    holdDraft({ audio: audioOf(), plan: { kind: "library", pick: { segmentId: "S9", lang: "en" }, title: "Not written yet", chips: [] }, photos: [] });
    at(COACHING_SEND, { start: "submit" });
    expect(await screen.findByText(C.planNotUsed)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.changePlan }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(COACHING_HOME));
    expect(await screen.findByRole("dialog")).toBeTruthy(); // the plan sheet
    expect(screen.queryByText("Not written yet")).toBeNull();
    expect(peekDraft()?.plan).toBeNull();
  });

  it("another lesson analysing: Open DC observation, or back to the page with the draft kept", async () => {
    sendLesson.mockRejectedValueOnce(new SendError("in_progress", "sess-7"));
    holdDraft({ audio: audioOf(), plan: null, photos: [] });
    at(COACHING_SEND, { start: "submit" });
    expect(await screen.findByText(C.busy)).toBeTruthy();
    expect(screen.getByRole("link", { name: C.openThat }).getAttribute("href")).toContain("sess-7");
    fireEvent.click(screen.getByRole("link", { name: C.title }));
    expect(await screen.findByTestId("dc-recording")).toBeTruthy();
  });
});

/** The kit's ConfirmTray actions: full width, 56px, stacked in one column with a gap (never flex-1). Their labels, in order. */
function stackedActions(dialog: HTMLElement) {
  const box = within(dialog).getByTestId("confirm-tray-actions");
  expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-3"]));
  const buttons = within(box).getAllByRole("button");
  for (const b of buttons) {
    expect(b.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "min-h-[56px]"]));
    expect(b.className.split(/\s+/)).not.toContain("flex-1");
  }
  return buttons.map((b) => b.textContent);
}

describe("the send page: Stop asks first (the kit's ConfirmTray)", () => {
  it("Finish lesson: how long, then Yes, finish over Keep recording, both full size; Keep recording closes and keeps recording", async () => {
    session.active = true;
    at(COACHING_SEND);
    fireEvent.click(await screen.findByRole("button", { name: C.stop }));
    const sheet = await screen.findByRole("dialog", { name: C.finishTitle });
    expect(stackedActions(sheet)).toEqual([C.yesFinish, C.keepRecording]);
    expect([...sheet.querySelectorAll("[data-chip]")].map((c) => c.textContent)).toEqual([C.minutes(1)]);
    fireEvent.click(within(sheet).getByRole("button", { name: C.keepRecording }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(session.finish).not.toHaveBeenCalled();
  });

  it("Yes, finish ends the recording", async () => {
    session.active = true;
    at(COACHING_SEND);
    fireEvent.click(await screen.findByRole("button", { name: C.stop }));
    const sheet = await screen.findByRole("dialog", { name: C.finishTitle });
    fireEvent.click(within(sheet).getByRole("button", { name: C.yesFinish }));
    await waitFor(() => expect(session.finish).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
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
