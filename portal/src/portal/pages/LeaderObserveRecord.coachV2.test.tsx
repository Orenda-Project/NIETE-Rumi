import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr — coach v2's Take observation reuses this page. From the v2 Visit
 * page it arrives with the scheduled visit's teacher and school, and:
 *   way=record  → straight to recording (she already chose "Record live")
 *   way=upload  → the sheet, where "Upload Recording" opens the file picker
 *   return=…    → Back goes to that v2 page (only /portal/coach/… paths)
 * A coach in the v2 pilot can use it without portal_coach_observation.
 */

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
const recorderProps = vi.hoisted(() => ({ copy: null as any }));
vi.mock("../components/coaching/coach/CoachRecorder", async (orig) => ({
  ...(await orig<any>()),
  default: ({ label, copy }: any) => ((recorderProps.copy = copy), <div data-testid="recorder">{label}</div>),
}));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn(), uploadToR2: vi.fn(), getRecentLessonPlans: vi.fn(), getLibraryGrades: vi.fn() },
  leader: { getTeachers: vi.fn(), getObservations: vi.fn(), getObserveRecentPlans: vi.fn(), presignObserveUpload: vi.fn(), startObservation: vi.fn() },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({ ...(await orig<any>()), canRecordHere: vi.fn() }));
vi.mock("../lib/recordingStore", () => ({ latestUnsent: vi.fn(), deleteRecording: vi.fn().mockResolvedValue(undefined) }));

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

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/leader/observe/new" element={<LeaderObserveRecord />} />
        <Route path="/portal/leader/observations" element={<div>old observations</div>} />
        <Route path="/portal/coach/visit/:id" element={<div>v2 visit</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  P.getConfig.mockResolvedValue({ features: { coachObservation: false, coachV2: true } });
  vi.mocked(canRecordHere).mockResolvedValue(true);
  vi.mocked(latestUnsent).mockResolvedValue(null);
  L.getTeachers.mockResolvedValue({ teachers: [{ teacherExtId: "923120004471", name: "Ayesha Bibi", schoolName: "IMSG I-10/1" }] });
  L.getObservations.mockResolvedValue({ observations: { upcoming: [
    { id: "s1", teacherName: "Ayesha Bibi", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", teacherExtId: "923120004471", scheduledFor: today, scheduledSlot: "11:30", overdue: false },
  ], pendingDebriefs: [], completed: [] } });
});

describe("LeaderObserveRecord from coach v2", () => {
  it("a v2 coach without portal_coach_observation can use it", async () => {
    renderPage("/portal/leader/observe/new");
    expect((await screen.findAllByText("Ayesha Bibi")).length).toBeGreaterThan(0);
  });

  it("way=record goes straight to recording, no sheet", async () => {
    renderPage("/portal/leader/observe/new?teacher=923120004471&school=niete:110&way=record");
    expect(await screen.findByTestId("recorder")).toHaveTextContent("Ayesha");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the recorder's Finish sheet gets its words from this page (bd-fmf24g.41: none written into the recorder)", async () => {
    renderPage("/portal/leader/observe/new?teacher=923120004471&school=niete:110&way=record");
    await screen.findByTestId("recorder");
    expect(recorderProps.copy).toMatchObject({ finishTitle: "Finish recording?", yesFinish: "Yes, finish", keepRecording: "Keep recording" });
    expect(recorderProps.copy.recorded(12 * 60_000)).toBe("You recorded 12 minutes.");
    expect(recorderProps.copy.shortNote).toBe("That is short. The report works best on a whole lesson.");
  });

  it("way=upload opens the sheet with Upload Recording", async () => {
    renderPage("/portal/leader/observe/new?teacher=923120004471&school=niete:110&way=upload");
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Upload Recording");
  });

  it("return=/portal/coach/visit/s1: Back goes there", async () => {
    renderPage("/portal/leader/observe/new?return=%2Fportal%2Fcoach%2Fvisit%2Fs1");
    await screen.findAllByText("Ayesha Bibi");
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("v2 visit")).toBeInTheDocument());
  });

  it("a return outside /portal/coach is ignored", async () => {
    renderPage("/portal/leader/observe/new?return=https%3A%2F%2Fevil.example");
    await screen.findAllByText("Ayesha Bibi");
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("old observations")).toBeInTheDocument());
  });

  it("neither flag: not available, as before", async () => {
    P.getConfig.mockResolvedValue({ features: { coachObservation: false, coachV2: false } });
    renderPage("/portal/leader/observe/new");
    await waitFor(() => expect(screen.queryByText("Ayesha Bibi")).toBeNull());
  });
});
