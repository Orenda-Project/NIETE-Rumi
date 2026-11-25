import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-oe6r47 (queue #278): these tests cover the in-app recorder, so upload-only (default ON) is switched off here.
vi.mock("../observe/uploadOnly", () => ({ useUploadOnly: () => false, uploadOnlyOn: () => false }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn() },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../../lib/recordingSupport", () => ({ canRecordHere: () => Promise.resolve(true) }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn().mockResolvedValue(undefined) }));
const recorderProps = vi.hoisted(() => ({ copy: null as any }));
vi.mock("../../components/coaching/coach/CoachRecorder", () => ({
  default: ({ label, onFinished, copy }: any) => (
    recorderProps.copy = copy,
    <div><span>{label}</span><button type="button" onClick={() => onFinished({ blob: new Blob(["x"], { type: "audio/webm" }), id: "rec-1", type: { ext: ".webm" } })}>finish recording</button></div>
  ),
}));
import { leader, portal } from "../../services/api";
import Debrief, { GUIDE_RETRY_MS } from "./Debrief";
import { isHeld } from "../../lib/pickedRead";

/**
 * bd-4404s7.5 — Debrief (Blueprint Coach_Debrief), step 3 of 4: the guide for her talk with the teacher (what went well,
 * one thing to grow, one action, the question to end on), then Start recording or Upload recording on the kit's
 * RecordUploadPair. The talk goes to R2 and is attached to the observation (presign → upload → talk), then she is back on
 * the observation page, where her Digital Coach listens and writes her feedback.
 */
const L = leader as any;
const P = portal as any;
const GUIDE = {
  intro: "Open with what worked.",
  sections: {
    strengths: { title: "Strengths", body: "Students answered by name and felt safe to try.", say_this: "Your questions were open." },
    growth: { title: "Growth", body: "Group transitions took three minutes." },
    action: { title: "Action", body: "Try a 10-second countdown before group work." },
  },
  reflection_question: "What will you try in tomorrow's lesson?",
};
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/debrief"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/debrief" element={<Debrief />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);
const audio = (name = "talk.mp3") => new File(["audio"], name, { type: "audio/mpeg" });
const chooseFile = (file: File) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW("talk"));
  L.getTalkGuide.mockResolvedValue({ guide: GUIDE });
  L.presignObserveUpload.mockResolvedValue({ uploadUrl: "https://r2/put", contentType: "audio/mpeg", key: "k/talk.mp3" });
  P.uploadToR2.mockResolvedValue(undefined);
  L.startTalk.mockResolvedValue({ success: true });
  L.retryTalk.mockResolvedValue({ success: true });
});

/**
 * bd-ewbzns.4.5 (queue #54, Urdu walk 7 Nov, obs dae7c48c) — writing the guide took 31.5 s and the first ask came back
 * 502 at 30.7 s, so the coach read "Guide did not load" though the guide was built and saved. A 5xx now keeps "Writing
 * your guide" and asks again (after GUIDE_RETRY_MS): the saved guide comes back at once. 409 still means the form is
 * not saved yet, with no second ask.
 */
describe("Debrief — a slow guide is asked for again, not given up on", () => {
  const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
  afterEach(() => { vi.useRealTimers(); });

  it("a 502 then the guide: the guide shows, and 'did not load' never does", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getTalkGuide.mockRejectedValueOnce(fail(502)).mockResolvedValueOnce({ guide: GUIDE });
    renderPage();
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Writing your guide")).toBeInTheDocument();
    expect(screen.queryByText("Guide did not load")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(GUIDE_RETRY_MS[0] + 100); });
    expect(await screen.findByTestId("talk-guide")).toBeInTheDocument();
    expect(L.getTalkGuide).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Guide did not load")).toBeNull();
  });

  it("5xx every time: 'did not load' after the last ask", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getTalkGuide.mockRejectedValue(fail(502));
    renderPage();
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    for (const ms of GUIDE_RETRY_MS) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 100); });
    expect(await screen.findByText("Guide did not load")).toBeInTheDocument();
    expect(L.getTalkGuide).toHaveBeenCalledTimes(GUIDE_RETRY_MS.length + 1);
  });

  /**
   * bd-tfya0m (queue #205) — production 19 Nov: a coach's guide ask came back 502 at 10 s while the bot restarted for a
   * deploy; the coach left, and the teacher's report was never sent. "Guide did not load" now carries Try again, which asks
   * once more (the guide is kept on the observation once written, so it comes back at once).
   */
  it("'did not load' has Try again, which asks again and shows the guide", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getTalkGuide.mockRejectedValue(fail(502));
    renderPage();
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    for (const ms of GUIDE_RETRY_MS) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 100); });
    const note = await screen.findByText("Guide did not load");
    L.getTalkGuide.mockResolvedValueOnce({ guide: GUIDE });
    const again = within(note.closest("[data-testid='guide-failed']") as HTMLElement).getByRole("button", { name: "Try again" });
    fireEvent.click(again);
    expect(await screen.findByTestId("talk-guide")).toBeInTheDocument();
    expect(L.getTalkGuide).toHaveBeenCalledTimes(GUIDE_RETRY_MS.length + 2);
    expect(screen.queryByText("Guide did not load")).toBeNull();
  });

  it("409 (the form is not saved yet): said at once, no second ask", async () => {
    L.getTalkGuide.mockRejectedValue(fail(409));
    renderPage();
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Save the form first")).toBeInTheDocument();
    expect(L.getTalkGuide).toHaveBeenCalledTimes(1);
  });
});

/**
 * bd-w0zbbe (queue #147, production 16 Nov, visit df9d3f17) — the coach saw "Writing your guide" beside Start recording
 * and Upload recording, left after 4 s, and read it as "the debrief notes never came" (the guide came 17 s later and was
 * kept). While the guide is being written the page now says how long it takes and that she can leave (the portal's line
 * for every waiting screen), and offers no recording until the guide is there.
 */
describe("Debrief — while the guide is being written", () => {
  it("says under a minute and that she can leave, and offers no recording yet", async () => {
    let answer: (v: unknown) => void = () => {};
    L.getTalkGuide.mockReturnValue(new Promise((r) => { answer = r; }));
    renderPage();
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Writing your guide")).toBeInTheDocument();
    expect(screen.getByText(/Under a minute/)).toBeInTheDocument();
    expect(screen.getByText("You can leave. We'll tell you here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload recording" })).toBeNull();

    await act(async () => { answer({ guide: GUIDE }); });
    expect(await screen.findByTestId("talk-guide")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.queryByText(/Under a minute/)).toBeNull();
  });
});

describe("Debrief", () => {
  it("titled Debrief with Step 3 of 4, ~10 min and After class", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Debrief");
    await waitFor(() => expect(screen.getByTestId("page-crumb")).toHaveTextContent("Ayesha Bibi · Step 3 of 4"));
    expect(screen.getByText("~10 min")).toBeInTheDocument();
    expect(screen.getByText("After class")).toBeInTheDocument();
  });

  it("the guide: went well, one thing to grow, one action, ask this last", async () => {
    renderPage();
    const guide = within(await screen.findByTestId("talk-guide"));
    expect(guide.getByText("Went well")).toBeInTheDocument();
    expect(guide.getByText("Students answered by name and felt safe to try.")).toBeInTheDocument();
    expect(guide.getByText(/Your questions were open/)).toBeInTheDocument();
    expect(guide.getByText("One thing to grow")).toBeInTheDocument();
    expect(guide.getByText("Group transitions took three minutes.")).toBeInTheDocument();
    expect(guide.getByText("One action")).toBeInTheDocument();
    expect(guide.getByText("Ask this last")).toBeInTheDocument();
    expect(guide.getByText("What will you try in tomorrow's lesson?")).toBeInTheDocument();
  });

  // The rubric-shaped notes (went well · work on first · a moment · six lines in rubric order): the guide the bot now
  // writes for ur/en coaches. The wait cues come from the app, on lines 3, 5 and 6.
  it("the rubric-shaped guide: went well, work on first, the moment, six numbered lines with their cues", async () => {
    L.getTalkGuide.mockResolvedValue({ guide: {
      intro: "Notes for your talk.",
      went_well: ["Pair work: every child answered in pairs."],
      work_on_first: { title: "Asking why", seen: "most questions were closed.", next_step: "add a why after a right answer." },
      moment: { time: "12:40", text: "You asked if it was common or proper." },
      conversation: ["I liked the pair work.", "Let us look at 12:40.", "What were you hoping for?", "One thing: a why.", "What will you try?", "Say it to me now."],
      outro: "No number to hand over.",
    } });
    renderPage();
    const guide = within(await screen.findByTestId("talk-guide"));
    expect(guide.getByText("Went well")).toBeInTheDocument();
    expect(guide.getByText("Pair work: every child answered in pairs.")).toBeInTheDocument();
    expect(guide.getByText(/Work on first/)).toHaveTextContent("Work on first: Asking why");
    expect(guide.getByText(/most questions were closed/)).toHaveTextContent("What you saw: most questions were closed.");
    expect(guide.getByText(/add a why after a right answer/)).toHaveTextContent("The next step: add a why after a right answer.");
    expect(guide.getByText(/A moment to raise/)).toHaveTextContent("A moment to raise (12:40)");
    const lines = guide.getAllByTestId("guide-line");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toHaveTextContent("I liked the pair work.");
    expect(lines[2]).toHaveTextContent("Wait in silence");
    expect(lines[4]).toHaveTextContent("Teacher names it");
    expect(lines[5]).toHaveTextContent("Wait 3–5 seconds");
    expect(lines[0]).not.toHaveTextContent(/Wait/);
    expect(guide.queryByText("Ask this last")).toBeNull();
  });

  // bd-rlxkkt.8: the model judges the student's answer at the moment; a wrong one is labelled for the coach.
  it("the moment says when the student's answer was wrong", async () => {
    L.getTalkGuide.mockResolvedValue({ guide: {
      went_well: ["Clear aim: stated."],
      work_on_first: { title: "Feedback on answers", next_step: "correct it kindly." },
      moment: { time: "14:06", text: "A student said Hazrat Umar.", answer: "wrong" },
      conversation: ["1", "2", "3", "4", "5", "6"],
    } });
    renderPage();
    const guide = within(await screen.findByTestId("talk-guide"));
    expect(guide.getByText(/A moment to raise/)).toHaveTextContent("A moment to raise (14:06): A wrong answer");
  });

  it("Start recording and Upload recording are the kit's pair", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
  });

  it("an uploaded file goes to R2, is attached to the observation, and she is back on its page", async () => {
    renderPage();
    await screen.findByTestId("talk-guide");
    chooseFile(audio());
    await waitFor(() => expect(L.startTalk).toHaveBeenCalledWith("cs-1", "k/talk.mp3"));
    expect(L.presignObserveUpload).toHaveBeenCalledWith(expect.objectContaining({ filename: "talk.mp3", kind: "audio" }));
    expect(P.uploadToR2).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("Start recording: the recorder is told whose talk it is; finishing sends it and clears the phone's copy", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("Your debrief with Ayesha")).toBeInTheDocument();
    // bd-fmf24g.41: the recorder's Finish sheet takes its words from here (English and Urdu), none written into it.
    expect(recorderProps.copy).toMatchObject({ finishTitle: "Finish recording?", yesFinish: "Yes, finish", keepRecording: "Keep recording" });
    expect(recorderProps.copy.recorded(12 * 60_000)).toBe("You recorded 12 minutes.");
    fireEvent.click(screen.getByRole("button", { name: "finish recording" }));
    await waitFor(() => expect(L.startTalk).toHaveBeenCalledWith("cs-1", "k/talk.mp3"));
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("a file that is not a recording is refused where she is", async () => {
    renderPage();
    await screen.findByTestId("talk-guide");
    chooseFile(new File(["x"], "photo.png", { type: "image/png" }));
    expect(await screen.findByText("Not a recording")).toBeInTheDocument();
    expect(P.uploadToR2).not.toHaveBeenCalled();
  });

  it("the internet stopping says the recording is safe, and Try again sends it again", async () => {
    P.uploadToR2.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    await screen.findByTestId("talk-guide");
    chooseFile(audio());
    expect(await screen.findByText("The internet stopped")).toBeInTheDocument();
    expect(screen.getByText("The recording is safe")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(L.startTalk).toHaveBeenCalledTimes(1));
  });

  /**
   * bd-tymy1n (queue #179) — the Android app lets go of a file it picked a little later (production 18 Nov: a coach's
   * photo would not open by Send). An uploaded talk is read the moment she picks it; what goes up, and what Try again
   * sends again, is that copy, never the picked file.
   */
  it("an uploaded talk is read when she picks it: the upload and Try again send that copy", async () => {
    P.uploadToR2.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    await screen.findByTestId("talk-guide");
    const bytes = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70];
    const f = new File([new Uint8Array(bytes)], "talk.m4a", { type: "audio/mp4" });
    let open = true;
    Object.defineProperty(f, "arrayBuffer", {
      value: () => (open ? Promise.resolve(new Uint8Array(bytes).buffer) : Promise.reject(Object.assign(new Error("x"), { name: "NotReadableError" }))),
    });
    chooseFile(f);
    expect(await screen.findByText("The internet stopped")).toBeInTheDocument();
    open = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(L.startTalk).toHaveBeenCalledTimes(1));
    expect(P.uploadToR2).toHaveBeenCalledTimes(2);
    for (const call of P.uploadToR2.mock.calls) {
      expect(call[1]).not.toBe(f);
      expect(isHeld(call[1])).toBe(true);
    }
  });

  it("a talk file the phone will not open is refused where she is, never 'The internet stopped'", async () => {
    renderPage();
    await screen.findByTestId("talk-guide");
    const f = new File(["x"], "talk.m4a", { type: "audio/mp4" });
    Object.defineProperty(f, "arrayBuffer", { value: () => Promise.reject(Object.assign(new Error("x"), { name: "NotReadableError" })) });
    chooseFile(f);
    expect(await screen.findByText("File will not open", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(P.uploadToR2).not.toHaveBeenCalled();
    expect(screen.queryByText("The internet stopped")).toBeNull();
  });

  it("the form not saved yet (409): says so and offers no recording", async () => {
    L.getTalkGuide.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    expect(await screen.findByText("Save the form first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
  });

  it("a guide that will not load still lets her record", async () => {
    // bd-ewbzns.4.5: a failed ask is tried again (GUIDE_RETRY_MS) before the page says it did not load.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getTalkGuide.mockRejectedValue(new Error("down"));
    renderPage();
    await waitFor(() => expect(L.getTalkGuide).toHaveBeenCalledTimes(1));
    for (const ms of GUIDE_RETRY_MS) await act(async () => { await vi.advanceTimersByTimeAsync(ms + 100); });
    vi.useRealTimers();
    expect(await screen.findByText("Guide did not load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("a talk the Digital Coach could not use shows why, and a failed one can be tried again", async () => {
    L.getObservation.mockResolvedValue(VIEW("talk", { problem: "failed" }));
    renderPage();
    expect(await screen.findByText("Could not listen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(L.retryTalk).toHaveBeenCalledWith("cs-1"));
  });

  it("read back after the talk: the guide kept on the observation, nothing to record, no new guide asked for", async () => {
    L.getObservation.mockResolvedValue(VIEW("sent", { talk: { guide: GUIDE, recordedAt: "x", feedback: null } }));
    renderPage();
    expect(await screen.findByTestId("talk-guide")).toBeInTheDocument();
    expect(L.getTalkGuide).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
  });
});
