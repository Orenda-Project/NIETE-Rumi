import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v.6 — "Send a lesson to your Digital Coach", for a COACH observing one
// of her teachers. Option B (B3, deep green): the button on Observations names
// the goal; this page asks who, then offers the two ways in a sheet — Record
// Live Lecture | Upload Recording — then her lesson plan and the board photos.

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

import { portal, leader } from "../services/api";
import { canRecordHere } from "../lib/recordingSupport";
import { latestUnsent } from "../lib/recordingStore";
import LeaderObserveRecord from "./LeaderObserveRecord";

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

describe("LeaderObserveRecord", () => {
  it("is dark when the flag is off for her", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: false } });
    renderPage();
    expect(await screen.findByText(/isn't available on your account yet/i)).toBeInTheDocument();
    expect(L.getTeachers).toHaveBeenCalled();
  });

  it("asks who first: today's visit on top, then her teachers, with a search", async () => {
    renderPage();
    expect(await screen.findByText("Who are you observing?")).toBeInTheDocument();
    await screen.findByText("Your visit at 09:30");
    expect(screen.getByText("Today")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search by name or school"), { target: { value: "g-9" } });
    const names = screen.getAllByText(/Bibi|Noor/).map((n) => n.textContent);
    // Ayesha still shows once (today's visit); the search keeps only Sadia in the list.
    expect(names).toEqual(["Ayesha Bibi", "Sadia Noor"]);
  });

  it("picking a teacher opens the sheet with the two ways, in the B3 words", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Sadia Noor"));
    const sheet = await screen.findByRole("dialog", { name: "Send Sadia’s lesson" });
    expect(within(sheet).getByText("Record Live Lecture")).toBeInTheDocument();
    expect(within(sheet).getByText("Upload Recording")).toBeInTheDocument();
  });

  it("without a working microphone the sheet offers only the upload", async () => {
    vi.mocked(canRecordHere).mockResolvedValue(false);
    renderPage();
    fireEvent.click(await screen.findByText("Sadia Noor"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByText("Record Live Lecture")).toBeNull();
  });

  it("sends her lesson with her plan from HER recent plans, for that teacher, then opens the observation", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Your visit at 09:30"));
    await screen.findByRole("dialog", { name: "Send Ayesha’s lesson" });
    fireEvent.change(screen.getByTestId("send-audio-input"), { target: { files: [file("Period 3.m4a", 30_000_000)] } });
    expect(await screen.findByText("Period 3.m4a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add her lesson plan" }));
    fireEvent.click(await screen.findByText("Her recent plans and our library"));
    expect(await screen.findByText("Her recent plans")).toBeInTheDocument();
    expect(L.getObserveRecentPlans).toHaveBeenCalledWith("923120004471", "niete:7");
    expect(P.getRecentLessonPlans).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Fractions: halves"));

    fireEvent.click(await screen.findByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText("Sent!")).toBeInTheDocument();
    expect(screen.getByText(/her draft report is ready here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open this observation" }));
    expect(await screen.findByText("observation page")).toBeInTheDocument();
    expect(L.startObservation).toHaveBeenCalledWith({
      key: "audio-key-1", photoKeys: [], lessonPlan: { assetId: "a1" }, teacherExtId: "923120004471", schoolExtId: "niete:7",
    });
  });

  it("a visit opened from the schedule arrives with the teacher chosen", async () => {
    renderPage("/portal/leader/observe/new?teacher=923120004471&school=niete:7");
    expect(await screen.findByRole("dialog", { name: "Send Ayesha’s lesson" })).toBeInTheDocument();
  });

  it("a teacher no longer in her schools is said so, and she picks again", async () => {
    L.startObservation.mockRejectedValue({ response: { status: 400, data: { reason: "not_your_teacher" } } });
    renderPage();
    fireEvent.click(await screen.findByText("Sadia Noor"));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByTestId("send-audio-input"), { target: { files: [file("a.m4a")] } });
    fireEvent.click(await screen.findByRole("button", { name: "Send to Digital Coach" }));
    expect(await screen.findByText(/not in your schools any more/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Who are you observing?")).toBeInTheDocument());
  });
});
