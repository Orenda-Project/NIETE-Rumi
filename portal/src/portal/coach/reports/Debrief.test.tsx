import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
vi.mock("../../components/coaching/coach/CoachRecorder", () => ({
  default: ({ label, onFinished }: any) => (
    <div><span>{label}</span><button type="button" onClick={() => onFinished({ blob: new Blob(["x"], { type: "audio/webm" }), id: "rec-1", type: { ext: ".webm" } })}>finish recording</button></div>
  ),
}));
import { leader, portal } from "../../services/api";
import Debrief from "./Debrief";

/**
 * bd-4404s7.5 — Debrief (Blueprint Coach_Debrief), step 3 of 5: the guide for her talk with the teacher (what went well,
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

describe("Debrief", () => {
  it("titled Debrief with Step 3 of 5, ~10 min and After class", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Debrief");
    await waitFor(() => expect(screen.getByTestId("page-crumb")).toHaveTextContent("Ayesha Bibi · Step 3 of 5"));
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

  it("the form not saved yet (409): says so and offers no recording", async () => {
    L.getTalkGuide.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    expect(await screen.findByText("Save the form first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
  });

  it("a guide that will not load still lets her record", async () => {
    L.getTalkGuide.mockRejectedValue(new Error("down"));
    renderPage();
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
