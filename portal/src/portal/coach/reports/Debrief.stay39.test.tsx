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
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
vi.mock("../report/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getCoachReport: vi.fn(async () => ({ id: "cs-1", header: { teacher: "Ayesha Bibi" }, done: 3, total: 8 })) }));
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
import Debrief from "./Debrief";
import i18n from "i18next";

/**
 * bd-o15qnr.39 (queue #204; the operator 22 Nov ~00:40: "After adding the debrief audio, the ui is confusing. I got thrown
 * back to the previous page. ... I couldn't tell if my audio got submitted and is being analyzed.") — on the v6/v7 switch
 * the Debrief page never bounces back: once the recording is in it says Uploaded, then "The Digital Coach is listening to
 * your debrief", about 3 minutes, that she can leave (it shows on the visit), and plays her recording in place; when the
 * feedback is written it shows the debrief report's card right there. Coach and principal; record and attach alike.
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

const TALK_URL = "https://r2.example/talk.webm?sig=1";
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
const LISTENING = (extra: Record<string, unknown> = {}) => VIEW("listening", { talk: { guide: GUIDE, recordedAt: "2026-11-22T05:00:00Z", audioUrl: TALK_URL, feedback: null }, ...extra });

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW("talk"));
  L.getTalkGuide.mockResolvedValue({ guide: GUIDE });
  L.presignObserveUpload.mockResolvedValue({ uploadUrl: "https://r2/put", contentType: "audio/mpeg", key: "k/talk.mp3" });
  P.uploadToR2.mockResolvedValue(undefined);
  L.startTalk.mockResolvedValue({ success: true });
});

describe("Debrief after the recording is in (bd-o15qnr.39, v7)", () => {
  it("an attached file: stays on the Debrief, says Uploaded and that the Digital Coach is listening, plays it in place", async () => {
    renderPage();
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    L.getObservation.mockResolvedValue(LISTENING());
    await act(async () => { chooseFile(audio()); });
    const card = await screen.findByTestId("stage-debrief-listening", {}, { timeout: 8000 });
    expect(screen.queryByText("observation page")).toBeNull();
    expect(card).toHaveTextContent("Uploaded");
    expect(card).toHaveTextContent("The Digital Coach is listening to your debrief");
    expect(card).toHaveTextContent("About 3 minutes. You can leave; it will show on the visit.");
    expect(within(card).getByRole("link", { name: "Back to the visit" })).toHaveAttribute("href", "/portal/coach/observation/cs-1");
    const player = await screen.findByTestId("debrief-recording");
    expect(within(player).getByRole("slider", { name: "Position" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload recording/ })).toBeNull();
    expect(L.startTalk).toHaveBeenCalled();
  });

  it("a recording made here: the same (no bounce back)", async () => {
    renderPage();
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    L.getObservation.mockResolvedValue(LISTENING());
    // bd-o15qnr.49 (#254): v7's Record is the floating Record debrief
    fireEvent.click(await screen.findByRole("button", { name: "Record debrief" }));
    await act(async () => { fireEvent.click(await screen.findByText("finish recording")); });
    expect(await screen.findByTestId("stage-debrief-listening", {}, { timeout: 8000 })).toHaveTextContent("Uploaded");
    expect(screen.queryByText("observation page")).toBeNull();
  });

  it("opened again while it listens: the listening card and the recording, no Record buttons, no new guide asked for", async () => {
    L.getObservation.mockResolvedValue(LISTENING());
    renderPage();
    const card = await screen.findByTestId("stage-debrief-listening", {}, { timeout: 8000 });
    expect(card).not.toHaveTextContent("Uploaded");
    expect(screen.getByTestId("debrief-recording")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start recording|Record debrief/ })).toBeNull();
    expect(L.getTalkGuide).not.toHaveBeenCalled();
  });

  it("the feedback written: the debrief report's card shows right here and opens the report", async () => {
    L.getObservation.mockResolvedValue(VIEW("report", { talk: { guide: GUIDE, recordedAt: "2026-11-22T05:00:00Z", audioUrl: TALK_URL, feedback: { harmful: false } } }));
    renderPage();
    const fb = await screen.findByTestId("visit-feedback", {}, { timeout: 8000 });
    await waitFor(() => expect(fb).toHaveTextContent("38%"));
    expect(fb.closest("a")).toHaveAttribute("href", "/portal/coach/report/cs-1");
    expect(screen.queryByTestId("stage-debrief-listening")).toBeNull();
    expect(screen.getByTestId("debrief-recording")).toBeInTheDocument();
  });

  it("Urdu: the listening card's words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservation.mockResolvedValue(LISTENING());
    renderPage();
    expect(await screen.findByTestId("stage-debrief-listening", {}, { timeout: 8000 })).toHaveTextContent("ڈیجیٹل کوچ آپ کا ڈی بریف سن رہا ہے");
  });

  it("switch off: back on the observation page after the upload, as on production", async () => {
    flow.on = false;
    renderPage();
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    await act(async () => { chooseFile(audio()); });
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });
});
