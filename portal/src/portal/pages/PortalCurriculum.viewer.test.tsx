import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v.10 — lesson plans open INSIDE the portal.
//
// Before: every lesson plan open was window.open(presigned R2 url). In the
// Android app (a Capacitor WebView with no PDF viewer of its own) that hands the
// PDF to another app: the portal goes to the background, and Android silences
// the microphone of a background app — so a teacher who opened her lesson plan
// mid-lesson lost the rest of her recording.
//
// Now a lesson plan opens in the portal's own viewer (pdf.js, loaded only when
// it is needed), fed by the portal's own server, so nothing leaves the app.
// The operator made that the default for everyone (2026-10-03), recording or
// not. Today's way stays as "Open in another app", and as the automatic
// fallback when the viewer cannot show the file.
//
// Every place a lesson plan opens is covered: grades 1-5 (lesson + answer key),
// a ready 6-12 lesson, a 6-12 lesson that finishes writing while she waits, and
// "My lesson plans".

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
const runtime = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/runtime", async (orig) => ({
  ...(await orig<typeof import("@/lib/runtime")>()),
  isNativeApp: () => runtime.native,
}));
// For the "while recording" cases: a real session, with the browser's recorder stood in for.
vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../lib/recordingSupport")>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
const recorder = {
  id: "rec-live", start: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn().mockReturnValue(false), elapsedMs: vi.fn().mockReturnValue(60_000),
  stop: vi.fn(), discard: vi.fn(),
};
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import api, { portal } from "../services/api";
import { loadPdfjs } from "../lib/pdfjs";
import { IN_APP_LESSON_PLANS, shouldOpenInApp } from "../lib/lessonPlanOpen";
import { RecordingSessionProvider, useRecordingSession } from "../lib/recordingSession";
import PortalCurriculum from "./PortalCurriculum";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PRESIGNED = "https://acct.r2.cloudflarestorage.com/bucket/lp-cache/v8/g4/abc.pdf?X-Amz-Signature=sig";
const PRESIGNED_612 = "https://acct.r2.cloudflarestorage.com/bucket/lp612/v9.2/en/g9.pdf?X-Amz-Signature=sig";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // "%PDF"

// pdf.js, stood in for: a 3-page document whose pages "render".
const page = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  cleanup: vi.fn(),
};
const doc = { numPages: 3, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
const pdfjs = { getDocument: vi.fn(() => ({ promise: Promise.resolve(doc), destroy: vi.fn() })) };

let openSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  // What jsdom lacks for Radix Select and a <canvas>.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
});

function notFound() {
  return Object.assign(new Error("404"), { response: { status: 404, data: { available: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.native = false;
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  vi.mocked(portal.getConfig).mockResolvedValue({ features: { assessmentGenerator: false } } as Awaited<ReturnType<typeof portal.getConfig>>);
  vi.mocked(loadPdfjs).mockResolvedValue(pdfjs as unknown as Awaited<ReturnType<typeof loadPdfjs>>);
  pdfjs.getDocument.mockImplementation(() => ({ promise: Promise.resolve(doc), destroy: vi.fn() }));
  recorder.elapsedMs.mockReturnValue(60_000);
  recorder.stop.mockResolvedValue({ blob: new Blob(["x"]), durationMs: 60_000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-live" });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true,
  });
  http.post.mockImplementation(async (url: string) => {
    if (url === "/lp612/request") return { data: { state: "ready", renderId: "R1" } };
    throw new Error(`unexpected POST ${url}`);
  });
  http.get.mockImplementation(async (url: string) => {
    switch (url) {
      case "/curriculum/grades": return { data: { grades: [{ grade: 4 }] } };
      case "/lp612/grades": return { data: { grades: [{ grade: 9 }] } };
      case "/curriculum/subjects": return { data: { subjects: [{ subject_key: "english", subject: "English", lesson_count: 12 }] } };
      case "/curriculum/chapters": return { data: { chapters: [{ chapter_number: 1, chapter_title: "My school", pages_label: "p. 1-6", lesson_count: 3 }] } };
      case "/curriculum/lps": return { data: { lessons: [{ lesson_id: "grade_4_english_ch1_seg2", topic: "Describing my school", day_label: "Day 2", downloaded: false }] } };
      case "/lp612/subjects": return { data: { subjects: [{ subject: "Physics", lesson_count: 4 }] } };
      case "/lp612/chapters": return { data: { chapters: [{ chapter_key: "c02", chapter_number: 2, chapter_title: "Motion", lesson_count: 1 }] } };
      case "/lp612/lessons": return { data: { lessons: [{ segment_id: "grade_9_physics.c02.p010", title: "Speed and velocity", ready: true }] } };
      case "/lp612/mine": return { data: { lessons: [] } };
      case "/curriculum/lp/grade_4_english_ch1_seg2/file": return { data: PDF_BYTES };
      case "/lp612/file/R1": return { data: PDF_BYTES };
      case "/lp612/file/R7": return { data: PDF_BYTES };
      case "/curriculum/lp/grade_4_english_ch1_seg2/pdf": return { data: { available: true, url: PRESIGNED } };
      case "/lp612/status/R1": return { data: { state: "ready", url: PRESIGNED_612 } };
      case "/lp612/status/R7": return { data: { state: "ready", url: PRESIGNED_612 } };
      default: throw new Error(`unexpected GET ${url}`);
    }
  });
});

/** Starts a lesson recording through the real session, as the record page would. */
const StartRecording = () => {
  const session = useRecordingSession();
  return (
    <button type="button" onClick={() => { void session?.start({ returnTo: "/portal/coaching/new" }); }}>
      test: start recording {session?.active ? "(on)" : "(off)"}
    </button>
  );
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/curriculum"]}>
      <RecordingSessionProvider>
        <StartRecording />
        <Routes>
          <Route path="/portal/curriculum" element={<PortalCurriculum />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

async function startRecording() {
  fireEvent.click(screen.getByRole("button", { name: /test: start recording/i }));
  await screen.findByRole("button", { name: "test: start recording (on)" });
}

async function choose(index: number, option: RegExp) {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getAllByRole("combobox")[index]).not.toBeDisabled());
  await user.click(screen.getAllByRole("combobox")[index]);
  await user.click(await screen.findByRole("option", { name: option }));
}

async function pickK5() {
  await choose(0, /grade 4/i);
  await choose(1, /english/i);
  await choose(2, /my school/i);
  await choose(3, /describing my school/i);
  await screen.findByRole("heading", { name: "Describing my school" });
}

async function pick612() {
  await choose(0, /grade 9/i);
  await choose(1, /physics/i);
  await choose(2, /motion/i);
  await choose(3, /speed and velocity/i);
  await screen.findByRole("heading", { name: "Speed and velocity" });
}

async function viewer() {
  return screen.findByTestId("lesson-plan-viewer");
}

function fileCall(url: string) {
  return http.get.mock.calls.find(([u]) => u === url);
}

describe("bd-5rz1v.10 — grades 1-5: the lesson plan opens inside the portal", () => {
  it("opens in the portal's viewer, from the portal's own server, and nothing leaves the app", async () => {
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));

    const v = await viewer();
    expect(within(v).getByRole("heading", { name: "Describing my school" })).toBeInTheDocument();
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(1));
    const call = fileCall("/curriculum/lp/grade_4_english_ch1_seg2/file");
    expect(call?.[1]).toMatchObject({ params: { kind: "lesson" }, responseType: "arraybuffer" });
    expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array), isEvalSupported: false }));
    expect(openSpy).not.toHaveBeenCalled();
    // Today's way, kept for saving and printing.
    expect(within(v).getByRole("button", { name: /open in another app/i })).toBeInTheDocument();
  });

  it("the answer key opens the same way", async () => {
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /answer key/i }));
    const v = await viewer();
    expect(within(v).getByRole("heading", { name: /answer key/i })).toBeInTheDocument();
    await waitFor(() => expect(fileCall("/curriculum/lp/grade_4_english_ch1_seg2/file")?.[1]).toMatchObject({ params: { kind: "answer_key" } }));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("in the Android app it is the same viewer — no hand-off to another app", async () => {
    runtime.native = true;
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    await viewer();
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(1));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("Back closes the viewer and the chosen lesson is still chosen", async () => {
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    fireEvent.click(within(v).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByTestId("lesson-plan-viewer")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Describing my school" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open lesson plan/i })).toBeInTheDocument();
  });

  it("Open in another app is today's way: the signed link, in a new window", async () => {
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    fireEvent.click(within(v).getByRole("button", { name: /open in another app/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(PRESIGNED, "_blank", "noopener"));
  });

  it("a lesson not published yet says so, as before, and the viewer closes", async () => {
    const base = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === "/curriculum/lp/grade_4_english_ch1_seg2/file") throw notFound();
      return base(url, cfg);
    });
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not ready yet" })));
    await waitFor(() => expect(screen.queryByTestId("lesson-plan-viewer")).not.toBeInTheDocument());
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("bd-5rz1v.10 — when the viewer cannot show it, today's way takes over", () => {
  it("pdf.js cannot load (an old WebView): opens the signed link the old way, by itself", async () => {
    vi.mocked(loadPdfjs).mockRejectedValue(new Error("SyntaxError: Unexpected token"));
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(PRESIGNED, "_blank", "noopener"));
    expect(within(v).getByText(/could not be shown here/i)).toBeInTheDocument();
    expect(within(v).getByRole("button", { name: /open in another app/i })).toBeInTheDocument();
  });

  it("a broken PDF falls back the same way", async () => {
    pdfjs.getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error("Invalid PDF structure")), destroy: vi.fn() }));
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    await viewer();
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(PRESIGNED, "_blank", "noopener"));
  });

  it("the download failing (network) falls back the same way", async () => {
    const base = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === "/curriculum/lp/grade_4_english_ch1_seg2/file") throw new Error("Network Error");
      return base(url, cfg);
    });
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    await viewer();
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(PRESIGNED, "_blank", "noopener"));
  });
});

describe("bd-5rz1v.10 — grades 6-12 open inside the portal too", () => {
  it("a lesson that is ready opens in the viewer", async () => {
    renderPage();
    await pick612();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    expect(within(v).getByRole("heading", { name: "Speed and velocity" })).toBeInTheDocument();
    await waitFor(() => expect(fileCall("/lp612/file/R1")?.[1]).toMatchObject({ responseType: "arraybuffer" }));
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(1));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("My lesson plans → Open opens the viewer", async () => {
    const base = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === "/lp612/mine") {
        return { data: { lessons: [{ renderId: "R7", segmentId: "grade_9_physics.c03", state: "ready", title: "Forces", grade: 9, subject: "Physics", lang: "en" }] } };
      }
      return base(url, cfg);
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));
    const v = await viewer();
    expect(within(v).getByRole("heading", { name: "Forces" })).toBeInTheDocument();
    await waitFor(() => expect(fileCall("/lp612/file/R7")).toBeTruthy());
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("a 6-12 lesson that cannot be shown falls back to its signed link", async () => {
    vi.mocked(loadPdfjs).mockRejectedValue(new Error("no worker"));
    renderPage();
    await pick612();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    await viewer();
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(PRESIGNED_612, "_blank", "noopener,noreferrer"));
  });

  it("a lesson written while she waits opens in the viewer when it is ready", async () => {
    let polls = 0;
    const base = http.get.getMockImplementation()!;
    http.post.mockResolvedValue({ data: { state: "authoring", renderId: "R1" } });
    http.get.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === "/lp612/lessons") return { data: { lessons: [{ segment_id: "grade_9_physics.c02.p010", title: "Speed and velocity", ready: false }] } };
      if (url === "/lp612/status/R1") { polls += 1; return { data: polls > 1 ? { state: "ready", url: PRESIGNED_612 } : { state: "authoring" } }; }
      return base(url, cfg);
    });
    renderPage();
    await pick612();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole("button", { name: /write this lesson plan/i }));
      await screen.findByText(/writing your lesson plan/i);
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      const v = await viewer();
      expect(within(v).getByRole("heading", { name: "Speed and velocity" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("bd-5rz1v.10 — while a lesson is recording", () => {
  it("the viewer says the recording continues, and offers no way out of the app", async () => {
    renderPage();
    await startRecording();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    expect(within(v).getByText("Opened inside the app, so recording continues")).toBeInTheDocument();
    await waitFor(() => expect(doc.getPage).toHaveBeenCalledWith(1));
    expect(within(v).queryByRole("button", { name: /open in another app/i })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("if the viewer fails, it does NOT hand off by itself — it asks, and says the recording may go silent", async () => {
    vi.mocked(loadPdfjs).mockRejectedValue(new Error("no worker"));
    renderPage();
    await startRecording();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    expect(await within(v).findByText(/could not be shown here/i)).toBeInTheDocument();
    expect(within(v).getByText(/your recording may go silent/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(openSpy).not.toHaveBeenCalled();
    fireEvent.click(within(v).getByRole("button", { name: /open in another app/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(PRESIGNED, "_blank", "noopener"));
  });

  it("not recording: no recording note in the viewer", async () => {
    renderPage();
    await pickK5();
    fireEvent.click(screen.getByRole("button", { name: /open lesson plan/i }));
    const v = await viewer();
    expect(within(v).queryByText(/recording continues/i)).not.toBeInTheDocument();
  });
});

describe("bd-5rz1v.10 — the one switch", () => {
  it("is set to open every lesson plan in the portal (operator, 2026-10-03)", () => {
    expect(IN_APP_LESSON_PLANS).toBe("always");
  });

  it("'while-recording' would open in the portal only while a lesson records; 'never' is today's way everywhere", () => {
    expect(shouldOpenInApp(false, "always")).toBe(true);
    expect(shouldOpenInApp(true, "always")).toBe(true);
    expect(shouldOpenInApp(true, "while-recording")).toBe(true);
    expect(shouldOpenInApp(false, "while-recording")).toBe(false);
    expect(shouldOpenInApp(true, "never")).toBe(false);
    expect(shouldOpenInApp(false, "never")).toBe(false);
  });
});
