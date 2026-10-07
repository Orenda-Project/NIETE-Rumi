import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// bd-5rz1v.10 — the lesson keeps recording while the teacher uses the rest of
// the portal. "The digital coach audio recording needs to be continued while
// the user uses the rest of the application, because they might access lesson
// plans while teaching" (operator, 2026-10-03).
//
// Before: the record page owned the recorder and stopped it on unmount, so
// leaving the page ended the lesson, and Back was trapped on the page to stop
// that happening. Now the recording lives above the routes:
//
//   record page     a view onto the session: clock, Pause, Finish, "Lesson plans"
//   any other page  a dark bar above the menu: "Recording · 12:34", Return
//   Logout          asks first ("Stop recording?"), because it really would end it
//
// Labels, not sentences (operator, 2026-10-03).
//
// Mounted through the REAL PortalLayout and navigation, so the bar and the
// Logout buttons are the ones a teacher taps. The recorder and the network are
// mocked the way PortalCoachingRecord.test.tsx mocks them.

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getDashboard: vi.fn(),
    getCoachingSessions: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
    presignCoachingUpload: vi.fn(),
    uploadToR2: vi.fn(),
    startCoachingUpload: vi.fn(),
  },
  auth: { logout: vi.fn() },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../lib/recordingSupport")>()),
  canRecordHere: vi.fn(),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
const releaseScreen = vi.fn(async () => {});
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => releaseScreen) }));
vi.mock("../lib/recordingStore", () => ({
  latestUnsent: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));

const recorder = {
  id: "rec-live",
  start: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn().mockReturnValue(false),
  elapsedMs: vi.fn().mockReturnValue(12 * 60_000 + 34_000),
  stop: vi.fn(),
  discard: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { portal, auth } from "../services/api";
import { canRecordHere } from "../lib/recordingSupport";
import { latestUnsent } from "../lib/recordingStore";
import { keepScreenOn } from "../lib/keepAwake";
import { LessonRecorder } from "../lib/lessonRecorder";
import { RecordingSessionProvider } from "../lib/recordingSession";
import PortalLayout from "../components/PortalLayout";
import CoachingHome from "../components/coaching/CoachingHome";
import PortalCoachingRecord from "./PortalCoachingRecord";

type Mocked = { [k: string]: ReturnType<typeof vi.fn> };
const api = portal as unknown as Mocked;
const getUserMedia = vi.fn();

/** A route change that does not depend on any button: what the menu, a link or Back does. */
const GoTo = () => {
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => navigate("/portal/curriculum")}>test: go to curriculum</button>
      <button type="button" onClick={() => navigate("/portal/training")}>test: go to training</button>
    </div>
  );
};

const Curriculum = () => <PortalLayout><h1>Curriculum page</h1></PortalLayout>;
const Training = () => <PortalLayout><h1>Training page</h1></PortalLayout>;
const Coaching = () => <PortalLayout><CoachingHome /></PortalLayout>;
const Login = () => <h1>Login page</h1>;

function renderApp(state: unknown = { start: "record" }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/portal/coaching" }, { pathname: "/portal/coaching/new", state }]} initialIndex={1}>
      <RecordingSessionProvider>
        <GoTo />
        <Routes>
          <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
          <Route path="/portal/coaching" element={<Coaching />} />
          <Route path="/portal/curriculum" element={<Curriculum />} />
          <Route path="/portal/training" element={<Training />} />
          <Route path="/portal/login" element={<Login />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

async function recording() {
  renderApp();
  await screen.findByText("Recording");
}

async function goToCurriculum() {
  fireEvent.click(screen.getByRole("button", { name: "test: go to curriculum" }));
  await screen.findByText("Curriculum page");
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getConfig.mockResolvedValue({ features: { selfObservation: true } });
  api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha", role: "teacher" } });
  api.getCoachingSessions.mockResolvedValue({ sessions: [] });
  api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
  vi.mocked(auth.logout).mockResolvedValue({ success: true });
  vi.mocked(canRecordHere).mockResolvedValue(true);
  vi.mocked(latestUnsent).mockResolvedValue(null);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(12 * 60_000 + 34_000);
  recorder.stop.mockResolvedValue({
    blob: new Blob(["rec"], { type: "audio/webm" }), durationMs: 12 * 60_000 + 34_000,
    type: { mimeType: "audio/webm;codecs=opus", ext: ".webm" }, id: "rec-live",
  });
  getUserMedia.mockResolvedValue({ getTracks: () => [] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
});

describe("bd-5rz1v.10 — the recording keeps going on other pages", () => {
  it("is not stopped when the record page goes away", async () => {
    await recording();
    await goToCurriculum();
    // Give any unmount clean-up its chance to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(recorder.discard).not.toHaveBeenCalled();
    expect(releaseScreen).not.toHaveBeenCalled();
  });

  it("keeps going across several pages, with one recorder and one microphone", async () => {
    await recording();
    await goToCurriculum();
    fireEvent.click(screen.getByRole("button", { name: "test: go to training" }));
    await screen.findByText("Training page");
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(LessonRecorder).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("bd-5rz1v.10 — the recording bar", () => {
  it("is not on the record page itself", async () => {
    await recording();
    expect(screen.queryByTestId("recording-bar")).not.toBeInTheDocument();
  });

  it("shows on every other page: red dot, the running time, and Return", async () => {
    await recording();
    await goToCurriculum();
    const bar = await screen.findByTestId("recording-bar");
    expect(bar).toHaveTextContent("Recording · 12:34");
    // Labels, not sentences: no explanatory line under the time.
    expect(bar).not.toHaveTextContent(/still recording/i);
    expect(bar).toHaveTextContent("Return");
    // A real button, big enough to hit: the whole bar is the tap target.
    expect(bar.tagName).toBe("BUTTON");
  });

  it("Return goes back to the live session — the same recording, not a new one", async () => {
    await recording();
    await goToCurriculum();
    fireEvent.click(await screen.findByTestId("recording-bar"));
    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(screen.getByText("12:34")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^finish$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    expect(screen.queryByTestId("recording-bar")).not.toBeInTheDocument();
    expect(LessonRecorder).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("goes away once the recording is finished", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: /^finish$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /yes, finish/i }));
    await screen.findByRole("button", { name: /send to digital coach/i });
    await goToCurriculum();
    expect(screen.queryByTestId("recording-bar")).not.toBeInTheDocument();
  });
});

describe("bd-5rz1v.10 — Pause and Finish after coming back", () => {
  it("Pause works after Return, the bar then says Paused, and Continue resumes", async () => {
    await recording();
    await goToCurriculum();
    fireEvent.click(await screen.findByTestId("recording-bar"));
    fireEvent.click(await screen.findByRole("button", { name: /^pause$/i }));
    expect(recorder.pause).toHaveBeenCalled();
    expect(await screen.findByText("Paused")).toBeInTheDocument();

    await goToCurriculum();
    expect(await screen.findByTestId("recording-bar")).toHaveTextContent("Paused · 12:34");

    fireEvent.click(screen.getByTestId("recording-bar"));
    fireEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
    expect(recorder.resume).toHaveBeenCalled();
    expect(await screen.findByText("Recording")).toBeInTheDocument();
  });

  it("Finish after Return still asks first, then leads to the unchanged check-and-send", async () => {
    await recording();
    await goToCurriculum();
    fireEvent.click(await screen.findByTestId("recording-bar"));
    fireEvent.click(await screen.findByRole("button", { name: /^finish$/i }));
    const dialog = await screen.findByRole("dialog", { name: /finish recording/i });
    expect(recorder.stop).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /yes, finish/i }));
    expect(await screen.findByRole("button", { name: /send to digital coach/i })).toBeInTheDocument();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(releaseScreen).toHaveBeenCalled();
  });
});

describe("bd-5rz1v.10 — the tip on the record screen", () => {
  it("one Lesson plans button (and a 'Recording continues' chip) goes to Curriculum while recording carries on", async () => {
    await recording();
    expect(screen.getByText("Recording continues")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^lesson plans$/i }));
    await screen.findByText("Curriculum page");
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(await screen.findByTestId("recording-bar")).toBeInTheDocument();
  });

  it("shows the menu while recording now — it no longer ends the lesson", async () => {
    await recording();
    expect(screen.getAllByText("Lesson Plans").length).toBeGreaterThan(0);
  });
});

describe("bd-5rz1v.10 — Back is no longer trapped", () => {
  it("puts no guard entry on the history, and a Back press does not ask to finish", async () => {
    await recording();
    await new Promise((r) => setTimeout(r, 20));
    expect(window.history.state && window.history.state.recordingGuard).toBeFalsy();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog", { name: /finish recording/i })).not.toBeInTheDocument();
  });

  it("the page's own Back arrow leaves the page while the recording carries on", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByTestId("send-a-lesson")).toBeInTheDocument();
    expect(await screen.findByTestId("recording-bar")).toBeInTheDocument();
    expect(recorder.stop).not.toHaveBeenCalled();
  });
});

describe("bd-5rz1v.10 — Logout while recording asks first", () => {
  async function openOtherSheet() {
    await userEvent.setup().click(screen.getByTestId("mobile-nav-more"));
    return screen.findByRole("dialog", { name: "Other" });
  }

  it("the mobile menu's Logout asks; Keep recording keeps it going and stays signed in", async () => {
    await recording();
    await goToCurriculum();
    const sheet = await openOtherSheet();
    await userEvent.setup().click(within(sheet).getByTestId("mobile-nav-logout"));
    const ask = await screen.findByRole("dialog", { name: /stop recording\?/i });
    expect(within(ask).getByRole("button", { name: /stop & log out/i })).toBeInTheDocument();
    expect(auth.logout).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole("button", { name: /keep recording/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /stop recording\?/i })).not.toBeInTheDocument());
    expect(auth.logout).not.toHaveBeenCalled();
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId("recording-bar")).toBeInTheDocument();
  });

  it("Stop & log out keeps the recording on the phone, then logs out", async () => {
    await recording();
    await goToCurriculum();
    // The desktop header's Logout, this time.
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    const ask = await screen.findByRole("dialog", { name: /stop recording\?/i });
    fireEvent.click(within(ask).getByRole("button", { name: /stop & log out/i }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(recorder.discard).not.toHaveBeenCalled();
    // Stopped first, then logged out.
    expect(recorder.stop.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(auth.logout).mock.invocationCallOrder[0]);
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("when nothing is recording, Logout does not ask", async () => {
    api.getConfig.mockResolvedValue({ features: { selfObservation: false } });
    renderApp({ start: "record" });
    await screen.findByText(/isn.t available on your account yet/i);
    await goToCurriculum();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: /stop recording\?/i })).not.toBeInTheDocument();
  });
});

describe("bd-5rz1v.10 — the session owns the screen hold and the leave guard", () => {
  it("keeps the screen on, and guards a reload, while on another page", async () => {
    await recording();
    expect(keepScreenOn).toHaveBeenCalledTimes(1);
    await goToCurriculum();
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(releaseScreen).not.toHaveBeenCalled();
  });

  it("remembers that the screen went off while she was away, and says so on the record page", async () => {
    await recording();
    await goToCurriculum();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    fireEvent.click(await screen.findByTestId("recording-bar"));
    expect(await screen.findByText(/screen went off/i)).toBeInTheDocument();
  });
});

describe("bd-5rz1v.10 — Coaching while a lesson is recording", () => {
  it("does not offer to Continue or Delete the recording that is still running", async () => {
    vi.mocked(latestUnsent).mockResolvedValue({
      meta: { id: "rec-live", mimeType: "audio/webm", ext: ".webm", startedAt: new Date().toISOString(), elapsedMs: 60_000, finished: false },
      blob: new Blob(["x"]),
    });
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByTestId("send-a-lesson");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/you have a recording that was not sent/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("Send a lesson goes back to the lesson being recorded instead of starting a second one", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByTestId("send-a-lesson"));
    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(LessonRecorder).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("bd-5rz1v.10 — nothing new where recording is not possible", () => {
  it("feature off: no recording, no bar, no tip", async () => {
    api.getConfig.mockResolvedValue({ features: { selfObservation: false } });
    renderApp({ start: "record" });
    await screen.findByText(/isn.t available on your account yet/i);
    expect(screen.queryByText("Recording continues")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^lesson plans$/i })).not.toBeInTheDocument();
    await goToCurriculum();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("recording-bar")).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("an app build that cannot record: Coaching offers no Record, and no bar appears anywhere", async () => {
    vi.mocked(canRecordHere).mockResolvedValue(false);
    // Opened with no choice, the record page hands her to Coaching with the sheet open.
    renderApp(null);
    const sheet = await screen.findByRole("dialog", { name: "Send a lesson" });
    expect(within(sheet).queryByRole("button", { name: /record live lecture/i })).not.toBeInTheDocument();
    await goToCurriculum();
    expect(screen.queryByTestId("recording-bar")).not.toBeInTheDocument();
  });
});
