import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

// bd-5rz1v.10 — the lesson is saved to the phone as it is recorded, on EVERY
// page. The REAL LessonRecorder runs here: only MediaRecorder (the browser) and
// IndexedDB (recordingStore) are stood in for, so a chunk that arrives while the
// teacher reads her lesson plan has to travel the real path to the store.

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../lib/recordingSupport")>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
vi.mock("../lib/recordingStore", () => ({
  latestUnsent: vi.fn().mockResolvedValue(null),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn().mockResolvedValue(undefined),
  appendChunk: vi.fn().mockResolvedValue(undefined),
  markFinished: vi.fn().mockResolvedValue(undefined),
}));

/** The browser's MediaRecorder: hands over whatever the test gives it. */
const made: FakeMediaRecorder[] = [];
class FakeMediaRecorder {
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { made.push(this); }
  static isTypeSupported() { return true; }
  start() { this.state = "recording"; }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}

import { portal } from "../services/api";
import { appendChunk, createRecording } from "../lib/recordingStore";
import { RecordingSessionProvider } from "../lib/recordingSession";
import PortalCoachingRecord from "./PortalCoachingRecord";

const GoTo = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/portal/curriculum")}>test: go to curriculum</button>;
};

beforeEach(() => {
  vi.clearAllMocks();
  made.length = 0;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  vi.mocked(portal.getConfig).mockResolvedValue({ features: { selfObservation: true } } as Awaited<ReturnType<typeof portal.getConfig>>);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    configurable: true,
  });
});

describe("bd-5rz1v.10 — chunks are still saved while she is on another page", () => {
  it("writes each chunk to the phone after the record page has gone away", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/portal/coaching/new", state: { start: "record" } }]}>
        <RecordingSessionProvider>
          <GoTo />
          <Routes>
            <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
            <Route path="/portal/curriculum" element={<h1>Curriculum page</h1>} />
          </Routes>
        </RecordingSessionProvider>
      </MemoryRouter>,
    );
    await screen.findByText("Recording");
    expect(createRecording).toHaveBeenCalledTimes(1);
    const id = vi.mocked(createRecording).mock.calls[0][0].id;

    fireEvent.click(screen.getByRole("button", { name: "test: go to curriculum" }));
    await screen.findByText("Curriculum page");
    await new Promise((r) => setTimeout(r, 20));

    // The browser is still recording: nobody stopped it on the way out.
    expect(made).toHaveLength(1);
    expect(made[0].state).toBe("recording");

    const chunk = new Blob(["five seconds of class"], { type: "audio/webm" });
    made[0].ondataavailable?.({ data: chunk });
    made[0].ondataavailable?.({ data: new Blob(["five more"], { type: "audio/webm" }) });

    expect(appendChunk).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appendChunk).mock.calls[0][0]).toBe(id);
    expect(vi.mocked(appendChunk).mock.calls[0][1]).toBe(0);
    expect(vi.mocked(appendChunk).mock.calls[0][2]).toBe(chunk);
    expect(vi.mocked(appendChunk).mock.calls[1][1]).toBe(1);
  });
});
