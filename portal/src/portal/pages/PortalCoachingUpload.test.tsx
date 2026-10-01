import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-7hyj7 — a teacher analyses her own lesson from the portal.
//
// She attaches a classroom recording (and, optionally, her lesson plan and up
// to three classroom photos), the files go straight to R2, the analysis runs
// through the same pipeline as WhatsApp, and she answers her one reflective
// question HERE — nothing about the debrief is sent to her chat.
//
// The network is mocked; the file rules (types, caps, photo count) are the
// real ones from lib/coachingUpload, so these tests also pin what the browser
// refuses before anything is uploaded.

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    presignCoachingUpload: vi.fn(),
    uploadToR2: vi.fn(),
    startCoachingUpload: vi.fn(),
    getCoachingProgress: vi.fn(),
    submitCoachingReflection: vi.fn(),
  },
}));
vi.mock("../lib/coachingUpload", async (orig) => ({
  ...(await orig<any>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));

import { portal } from "../services/api";
import { readAudioDuration } from "../lib/coachingUpload";
import PortalCoachingUpload from "./PortalCoachingUpload";

const api = portal as any;

function file(name: string, size = 1000, type = "") {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function renderAt(path = "/portal/coaching/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coaching/new" element={<PortalCoachingUpload />} />
      </Routes>
    </MemoryRouter>,
  );
}

function choose(testId: string, files: File[]) {
  fireEvent.change(screen.getByTestId(testId), { target: { files } });
}

/** The page waits for /config before rendering the form. */
async function renderForm(path?: string) {
  const out = renderAt(path);
  await screen.findByTestId("start-analysis");
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  // These tests cover the page with the feature ON (bd-3bvfj).
  api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: true } });
  (readAudioDuration as any).mockResolvedValue(1800);
  let n = 0;
  api.presignCoachingUpload.mockImplementation(async ({ kind }: any) => {
    n += 1;
    return { key: `${kind}-key-${n}`, uploadUrl: `https://r2.example/put/${n}`, contentType: `ct/${kind}` };
  });
  api.uploadToR2.mockResolvedValue(undefined);
  api.startCoachingUpload.mockResolvedValue({ coachingSessionId: "cs-1" });
  api.getCoachingProgress.mockResolvedValue({ id: "cs-1", stage: "transcribing", status: "transcribing", reflection: null, shortRecording: null });
});

describe("choosing files", () => {
  it("cannot start until a recording is chosen", async () => {
    await renderForm();
    expect(screen.getByTestId("start-analysis")).toBeDisabled();
    choose("recording-input", [file("period-3.m4a")]);
    expect(screen.getByTestId("start-analysis")).toBeEnabled();
  });

  it("refuses a file that is not a recording, before uploading anything", async () => {
    await renderForm();
    choose("recording-input", [file("lesson.pdf")]);
    expect(screen.getByTestId("recording-error")).toHaveTextContent(/audio recording/i);
    expect(screen.getByTestId("start-analysis")).toBeDisabled();
  });

  it("refuses a fourth classroom photo", async () => {
    await renderForm();
    choose("photos-input", [file("a.jpg"), file("b.jpg"), file("c.png"), file("d.jpg")]);
    expect(screen.getByTestId("photos-error")).toHaveTextContent(/3 photos/i);
  });

  it("warns — but does not block — when the recording is under 10 minutes", async () => {
    (readAudioDuration as any).mockResolvedValue(240);
    await renderForm();
    choose("recording-input", [file("short.m4a")]);
    await waitFor(() => expect(screen.getByTestId("short-warning")).toBeInTheDocument());
    expect(screen.getByTestId("start-analysis")).toBeEnabled();
  });
});

describe("uploading and starting", () => {
  it("uploads the recording straight to R2 with the signed content type, then starts", async () => {
    await renderForm();
    const rec = file("period-3.m4a", 31_000_000);
    choose("recording-input", [rec]);
    fireEvent.click(screen.getByTestId("start-analysis"));

    await waitFor(() => expect(api.startCoachingUpload).toHaveBeenCalled());
    expect(api.presignCoachingUpload).toHaveBeenCalledWith({ filename: "period-3.m4a", sizeBytes: 31_000_000, kind: "audio" });
    expect(api.uploadToR2).toHaveBeenCalledWith("https://r2.example/put/1", rec, "ct/audio", expect.any(Function));
    expect(api.startCoachingUpload).toHaveBeenCalledWith({ key: "audio-key-1", lessonPlanKey: undefined, photoKeys: [] });
    await waitFor(() => expect(screen.getByTestId("progress-view")).toBeInTheDocument());
  });

  it("sends the lesson plan and photos with the recording", async () => {
    await renderForm();
    choose("recording-input", [file("p.m4a")]);
    choose("lesson-plan-input", [file("plan.pdf")]);
    choose("photos-input", [file("board.jpg"), file("books.png")]);
    fireEvent.click(screen.getByTestId("start-analysis"));

    await waitFor(() => expect(api.startCoachingUpload).toHaveBeenCalled());
    const kinds = api.presignCoachingUpload.mock.calls.map((c: any[]) => c[0].kind).sort();
    expect(kinds).toEqual(["audio", "lesson_plan", "photo", "photo"]);
    const started = api.startCoachingUpload.mock.calls[0][0];
    expect(started.lessonPlanKey).toMatch(/^lesson_plan-key-/);
    expect(started.photoKeys).toHaveLength(2);
  });

  it("does not start when an upload fails, and says so", async () => {
    api.uploadToR2.mockRejectedValue(new Error("network"));
    await renderForm();
    choose("recording-input", [file("p.m4a")]);
    fireEvent.click(screen.getByTestId("start-analysis"));
    await waitFor(() => expect(screen.getByTestId("upload-error")).toBeInTheDocument());
    expect(api.startCoachingUpload).not.toHaveBeenCalled();
  });

  it("when a recording is already being analysed, follows THAT one instead of starting another", async () => {
    const err: any = new Error("conflict");
    err.response = { status: 409, data: { status: "in_progress", coachingSessionId: "cs-old" } };
    api.startCoachingUpload.mockRejectedValue(err);
    await renderForm();
    choose("recording-input", [file("p.m4a")]);
    fireEvent.click(screen.getByTestId("start-analysis"));
    await waitFor(() => expect(api.getCoachingProgress).toHaveBeenCalledWith("cs-old"));
    expect(screen.getByTestId("already-running")).toBeInTheDocument();
  });
});

describe("following the analysis", () => {
  it("resumes from the URL after a reload", async () => {
    renderAt("/portal/coaching/new?session=cs-7");
    await waitFor(() => expect(api.getCoachingProgress).toHaveBeenCalledWith("cs-7"));
    expect(screen.getByTestId("progress-view")).toBeInTheDocument();
  });

  it("shows her question when it is ready, in its own text direction, and sends her answer", async () => {
    api.getCoachingProgress.mockResolvedValue({
      id: "cs-1", stage: "reflection", status: "conducting_conversation",
      reflection: { questionNumber: 1, question: "جب کلاس خاموش ہوئی تو آپ نے کیا محسوس کیا؟" },
    });
    api.submitCoachingReflection.mockResolvedValue({ done: true, acknowledgement: "شکریہ" });
    renderAt("/portal/coaching/new?session=cs-1");

    const q = await screen.findByTestId("reflection-question");
    expect(q).toHaveTextContent("جب کلاس خاموش");
    expect(q).toHaveAttribute("dir", "auto");
    expect(screen.getByTestId("reflection-answer")).toHaveAttribute("dir", "auto");

    fireEvent.change(screen.getByTestId("reflection-answer"), { target: { value: "  میں نے انتظار کیا  " } });
    fireEvent.click(screen.getByTestId("reflection-submit"));
    await waitFor(() => expect(api.submitCoachingReflection).toHaveBeenCalledWith("cs-1", "میں نے انتظار کیا"));
    expect(await screen.findByTestId("reflection-ack")).toHaveTextContent("شکریہ");
  });

  it("will not send an empty answer", async () => {
    api.getCoachingProgress.mockResolvedValue({
      id: "cs-1", stage: "reflection", status: "conducting_conversation", reflection: { questionNumber: 1, question: "Q?" },
    });
    renderAt("/portal/coaching/new?session=cs-1");
    await screen.findByTestId("reflection-question");
    expect(screen.getByTestId("reflection-submit")).toBeDisabled();
  });

  it("links to the report when it is done", async () => {
    api.getCoachingProgress.mockResolvedValue({ id: "cs-1", stage: "done", status: "completed", reflection: null, reportReady: true });
    renderAt("/portal/coaching/new?session=cs-1");
    const link = await screen.findByTestId("view-report");
    expect(link).toHaveAttribute("href", "/portal/coaching/session/cs-1");
  });

  it("says plainly when the analysis stopped", async () => {
    api.getCoachingProgress.mockResolvedValue({ id: "cs-1", stage: "stopped", status: "failed", reflection: null });
    renderAt("/portal/coaching/new?session=cs-1");
    expect(await screen.findByTestId("analysis-stopped")).toBeInTheDocument();
  });
});

describe("behind the feature flag (bd-3bvfj)", () => {
  it("shows no form, and uploads nothing, when the feature is off for her", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: false } });
    renderAt();
    expect(await screen.findByTestId("self-observation-off")).toBeInTheDocument();
    expect(screen.queryByTestId("start-analysis")).toBeNull();
    expect(screen.queryByTestId("recording-input")).toBeNull();
  });

  it("does not poll a session when the feature is off", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: false } });
    renderAt("/portal/coaching/new?session=cs-1");
    await screen.findByTestId("self-observation-off");
    expect(api.getCoachingProgress).not.toHaveBeenCalled();
  });
});
