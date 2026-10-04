import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// bd-5rz1v.7 — Option B3. The old page had a "Record your class" button that
// only led to a second page with the real Record button. Now one button names
// the goal, and a sheet offers the two ways to reach it:
//
//   [ Send a lesson to your Digital Coach ]          deep green, chalkboard
//        └─ sheet "Send a lesson"
//             Record Live Lecture   → the recorder, already recording
//             Upload Recording      → the phone's picker, then Check and send
//
// A recording that was never sent is offered here too, with Continue.

vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }) }; });
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getCoachingSessions: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
  },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({ ...(await orig<any>()), canRecordHere: vi.fn() }));
vi.mock("../lib/recordingStore", () => ({
  latestUnsent: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
}));

import { portal } from "../services/api";
import { canRecordHere } from "../lib/recordingSupport";
import { latestUnsent, deleteRecording } from "../lib/recordingStore";
import { takeHandedOffRecording } from "../lib/lessonHandoff";
import PortalCoaching from "./PortalCoaching";

const api = portal as any;

/** Stands in for the record page: shows what Coaching asked it to do. */
const RecordPage = () => {
  const loc = useLocation();
  return <div data-testid="record-page">{JSON.stringify(loc.state)}</div>;
};

function renderPage(state: unknown = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/portal/coaching", state }]}>
      <Routes>
        <Route path="/portal/coaching" element={<PortalCoaching />} />
        <Route path="/portal/coaching/new" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function file(name: string, size = 1000) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

async function openSheet() {
  renderPage();
  fireEvent.click(await screen.findByTestId("send-a-lesson"));
  return screen.findByRole("dialog", { name: /send a lesson/i });
}

const UNSENT = {
  meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T08:00:00Z", elapsedMs: 12 * 60_000, finished: false },
  blob: new Blob(["old"], { type: "audio/webm" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  takeHandedOffRecording();
  api.getConfig.mockResolvedValue({ features: { selfObservation: true } });
  api.getCoachingSessions.mockResolvedValue({ sessions: [], pagination: {} });
  api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
  vi.mocked(canRecordHere).mockResolvedValue(true);
  vi.mocked(latestUnsent).mockResolvedValue(null);
});

describe("Coaching — one button that names the goal", () => {
  it("is a deep-green 'Send a lesson to your Digital Coach' button, not a link to another page of choices", async () => {
    renderPage();
    const cta = await screen.findByTestId("send-a-lesson");
    expect(cta.tagName).toBe("BUTTON");
    expect(cta).not.toHaveAttribute("href");
    expect(cta.className).toMatch(/#2e7d57/);
    expect(within(cta).getByText("Send a lesson to your Digital Coach")).toBeInTheDocument();
    expect(within(cta).getByText("Record it in class, or send one you already have.")).toBeInTheDocument();
    expect(screen.queryByText("Record your class")).not.toBeInTheDocument();
  });

  // bd-5rz1v.9 — it reads as a button: a white arrow at the end, and tapping
  // anywhere on it (the arrow included) still opens the sheet.
  it("ends in a white arrow, and tapping the arrow opens the Send a lesson sheet", async () => {
    renderPage();
    const cta = await screen.findByTestId("send-a-lesson");
    const arrow = within(cta).getByTestId("send-lesson-arrow");
    expect(cta.querySelector("[class*='animate-rec-wave']")).toBeNull();
    fireEvent.click(arrow);
    expect(await screen.findByRole("dialog", { name: /send a lesson/i })).toBeInTheDocument();
  });

  it("opens a 'Send a lesson' sheet with Record Live Lecture and Upload Recording, and Cancel closes it", async () => {
    const sheet = await openSheet();
    expect(await within(sheet).findByRole("button", { name: /record live lecture/i })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /upload recording/i })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("in an app that cannot use the microphone, the sheet offers Upload Recording only", async () => {
    vi.mocked(canRecordHere).mockResolvedValue(false);
    const sheet = await openSheet();
    await waitFor(() => expect(canRecordHere).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(within(sheet).getByRole("button", { name: /upload recording/i })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /record live lecture/i })).not.toBeInTheDocument();
  });
});

describe("Coaching — the two ways", () => {
  it("Record Live Lecture opens the recorder, told to start recording", async () => {
    const sheet = await openSheet();
    fireEvent.click(await within(sheet).findByRole("button", { name: /record live lecture/i }));
    expect(await screen.findByTestId("record-page")).toHaveTextContent('{"start":"record"}');
  });

  it("Upload Recording refuses a file that is not a recording, in the sheet, and goes nowhere", async () => {
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByTestId("send-audio-input"), { target: { files: [file("notes.pdf")] } });
    expect(await within(sheet).findByText(/not a recording/i)).toBeInTheDocument();
    expect(screen.queryByTestId("record-page")).not.toBeInTheDocument();
    expect(takeHandedOffRecording()).toBeNull();
  });

  it("Upload Recording takes a recording straight on to Check and send", async () => {
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByTestId("send-audio-input"), { target: { files: [file("Period 3.m4a", 24_000_000)] } });
    expect(await screen.findByTestId("record-page")).toHaveTextContent('{"start":"file"}');
    expect(takeHandedOffRecording()?.name).toBe("Period 3.m4a");
  });

  it("comes back with the sheet already open when the record page sends her here", async () => {
    renderPage({ sendSheet: true });
    expect(await screen.findByRole("dialog", { name: /send a lesson/i })).toBeInTheDocument();
  });
});

describe("Coaching — a recording that was never sent", () => {
  it("is offered here with Continue (it does not send yet) and Delete", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT as any);
    renderPage();
    expect(await screen.findByText(/a recording that was not sent/i)).toBeInTheDocument();
    expect(screen.getByText(/12 minutes/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send it/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByTestId("record-page")).toHaveTextContent('{"start":"resume"}');
  });

  it("Delete removes it from the phone", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT as any);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(deleteRecording).toHaveBeenCalledWith("rec-old"));
    expect(screen.queryByText(/a recording that was not sent/i)).not.toBeInTheDocument();
  });
});
