import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-tymy1n (queue #179) — the classic "Send a lesson to your Digital Coach" page (coach v1 and principals off the
// principal app) keeps the files she picks the way coach Check and send did: production 18 Nov, a coach's photo picked
// in the Android app could no longer be opened by Send (8 sends, each stopped on photo 1, read as "internet"). Every
// file picked here (the recording, her plan, the board photos) is now read when she picks it and sent from those bytes.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    uploadToR2: vi.fn(),
    getRecentLessonPlans: vi.fn(),
    getLibraryGrades: vi.fn(),
    getLibrarySubjects: vi.fn(),
    getLibraryChapters: vi.fn(),
    getLibraryLessons: vi.fn(),
  },
  leader: {
    getTeachers: vi.fn(),
    getObservations: vi.fn(),
    getObserveRecentPlans: vi.fn(),
    presignObserveUpload: vi.fn(),
    startObservation: vi.fn(),
    startTalk: vi.fn(),
  },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({ ...(await orig<any>()), canRecordHere: vi.fn() }));
vi.mock("../lib/recordingStore", () => ({ latestUnsent: vi.fn(), deleteRecording: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/coachingUpload", async (orig) => ({ ...(await orig<any>()), readAudioDuration: vi.fn().mockResolvedValue(2400) }));
// A send can be made to fail as Send would on a file the phone could not read (everything else is the real pipeline).
const over = vi.hoisted(() => ({ send: null as null | (() => Promise<unknown>) }));
vi.mock("../lib/coachObserve", async (orig) => {
  const real = await orig<typeof import("../lib/coachObserve")>();
  return { ...real, sendObservation: (...a: Parameters<typeof real.sendObservation>) => (over.send ? over.send() : real.sendObservation(...a)) };
});

import { portal, leader } from "../services/api";
import { canRecordHere } from "../lib/recordingSupport";
import { latestUnsent } from "../lib/recordingStore";
import LeaderObserveRecord from "./LeaderObserveRecord";
import { readBytes } from "../lib/audioHash";
import { SendError } from "../lib/coachingSend";

const P = portal as any;
const L = leader as any;

const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

function file(name: string, size = 1000) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function renderPage(path = "/portal/leader/observe/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/leader/observe/new" element={<LeaderObserveRecord />} />
        <Route path="/portal/leader/observe/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  P.getConfig.mockResolvedValue({ features: { coachObservation: true } });
  vi.mocked(canRecordHere).mockResolvedValue(true);
  vi.mocked(latestUnsent).mockResolvedValue(null);
  L.getTeachers.mockResolvedValue({ teachers: [
    { teacherExtId: "923120004471", name: "Ayesha Bibi", schoolName: "IMSG F-7/2" },
    { teacherExtId: "923120009999", name: "Sadia Noor", schoolName: "IMCG G-9/4" },
  ] });
  L.getObservations.mockResolvedValue({ observations: { upcoming: [
    { id: "s1", teacherName: "Ayesha Bibi", schoolName: "IMSG F-7/2", schoolExtId: "niete:7", teacherExtId: "923120004471", scheduledFor: today, scheduledSlot: "09:30", overdue: false },
  ], pendingDebriefs: [], completed: [] } });
  L.getObserveRecentPlans.mockResolvedValue({ plans: [{ assetId: "a1", lessonId: "g4", topic: "Fractions: halves", grade: 4, subject: "Maths", chapterNumber: 5, dayLabel: "Day 2", pagesLabel: null, downloadedAt: null }] });
  P.getLibraryGrades.mockResolvedValue([]);
  let n = 0;
  L.presignObserveUpload.mockImplementation(async ({ kind }: any) => ({ key: `${kind}-key-${(n += 1)}`, uploadUrl: "https://r2/put", contentType: "audio/mp4" }));
  P.uploadToR2.mockResolvedValue(undefined);
  L.startObservation.mockResolvedValue({ coachingSessionId: "cs-77" });
});


const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 7, 7];
/** A file as the Android app hands it over: it opens while she picks it; `lose()` is the WebView letting go of it. */
function picked(name: string, type: string, bytes: number[]) {
  const f = new File([new Uint8Array(bytes)], name, { type });
  let open = true;
  Object.defineProperty(f, "arrayBuffer", {
    value: () => (open ? Promise.resolve(new Uint8Array(bytes).buffer)
      : Promise.reject(Object.assign(new Error("The requested file could not be read"), { name: "NotReadableError" }))),
  });
  return { file: f, lose: () => { open = false; } };
}
const bytesOf = (b: Blob) => readBytes(b).then((ab) => Array.from(new Uint8Array(ab)));

describe("LeaderObserveRecord — files are read when she picks them", () => {
  it("a recording, a plan file and a board photo the phone can no longer open by Send still go, from the bytes read at the pick", async () => {
    const m4a = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 9];
    const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d, 1];
    const rec = picked("Period 3.m4a", "audio/mp4", m4a);
    const plan = picked("plan.pdf", "application/pdf", pdf);
    const board = picked("IMG_2041.jpg", "image/jpeg", JPEG);
    renderPage();
    fireEvent.click(await screen.findByText("Sadia Noor"));
    await screen.findByRole("dialog", { name: "Record Sadia’s lesson" });
    fireEvent.change(screen.getByTestId("send-audio-input"), { target: { files: [rec.file] } });
    await screen.findByText("Period 3.m4a");
    fireEvent.click(screen.getByRole("button", { name: "Add the lesson plan" }));
    fireEvent.change(await screen.findByTestId("plan-file-input"), { target: { files: [plan.file] } });
    await screen.findByText("plan.pdf");
    fireEvent.change(screen.getByTestId("photos-input"), { target: { files: [board.file] } });
    await screen.findByRole("button", { name: "Remove IMG_2041.jpg" });
    rec.lose(); plan.lose(); board.lose();
    fireEvent.click(await screen.findByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText("Sent!", undefined, { timeout: 4000 })).toBeInTheDocument();
    const kinds = L.presignObserveUpload.mock.calls.map((c: any[]) => c[0].kind);
    const sent = await Promise.all(P.uploadToR2.mock.calls.map((c: any[]) => bytesOf(c[1])));
    expect(Object.fromEntries(kinds.map((k: string, i: number) => [k, sent[i]]))).toEqual({ audio: m4a, lesson_plan: pdf, photo: JPEG });
  });

  it("a photo that will not open is refused at the pick, not at Send", async () => {
    const rec = picked("Period 3.m4a", "audio/mp4", [1, 2, 3]);
    const bad = new File([new Uint8Array(JPEG)], "board.jpg", { type: "image/jpeg" });
    Object.defineProperty(bad, "arrayBuffer", { value: () => Promise.reject(Object.assign(new Error("x"), { name: "NotReadableError" })) });
    renderPage();
    fireEvent.click(await screen.findByText("Sadia Noor"));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByTestId("send-audio-input"), { target: { files: [rec.file] } });
    await screen.findByText("Period 3.m4a");
    fireEvent.change(screen.getByTestId("photos-input"), { target: { files: [bad] } });
    expect(await screen.findByText("Photo will not open", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove board.jpg" })).toBeNull();
  });
});

describe("LeaderObserveRecord — a file the phone could not read at Send is not 'The internet stopped'", () => {
  const unreadable = (part: { kind: "audio" | "lesson_plan" | "photo"; photo: number }) =>
    () => Promise.reject(new SendError("network", undefined, undefined, { part, offline: false, unreadable: true }));
  async function toFailure(part: { kind: "audio" | "lesson_plan" | "photo"; photo: number }) {
    renderPage();
    fireEvent.click(await screen.findByText("Sadia Noor"));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByTestId("send-audio-input"), { target: { files: [picked("Period 3.m4a", "audio/mp4", [1, 2]).file] } });
    await screen.findByText("Period 3.m4a");
    fireEvent.change(screen.getByTestId("photos-input"), { target: { files: [picked("IMG_1.jpg", "image/jpeg", JPEG).file, picked("IMG_2.jpg", "image/jpeg", JPEG).file] } });
    await screen.findByRole("button", { name: "Remove IMG_2.jpg" });
    over.send = unreadable(part);
    fireEvent.click(screen.getByRole("button", { name: "Send to Digital Coach" }));
  }
  beforeEach(() => { over.send = null; });

  it("photo 1: says so; Remove it takes that photo out and goes back to Send", async () => {
    await toFailure({ kind: "photo", photo: 1 });
    expect(await screen.findByText("Photo 1 will not open")).toBeInTheDocument();
    expect(screen.queryByText("The internet stopped")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove it" }));
    expect(await screen.findByRole("button", { name: "Send to Digital Coach" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove IMG_1.jpg" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove IMG_2.jpg" })).toBeInTheDocument();
  });

  it("the recording: says so; Choose it again goes back to pick it", async () => {
    await toFailure({ kind: "audio", photo: 0 });
    expect(await screen.findByText("The recording will not open")).toBeInTheDocument();
    expect(screen.queryByText("The internet stopped")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose it again" }));
    expect(await screen.findByRole("dialog", { name: "Record Sadia’s lesson" })).toBeInTheDocument();
  });
});
