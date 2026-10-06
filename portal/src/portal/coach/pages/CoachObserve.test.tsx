import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getSchedule: vi.fn(), getVisit: vi.fn(), getPeople: vi.fn() },
  leader: { cancelSchedule: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObserve from "./CoachObserve";
import CoachObservePick from "./CoachObservePick";
import CoachVisit from "./CoachVisit";

/**
 * bd-o15qnr — Observe is always against a scheduled visit:
 * Take observation → pick the teacher (today + overdue; search by name or
 * phone, filter by school) → the Visit page asks Record live or Attach.
 * Record/Attach/Check-and-send are the existing pipeline pages.
 */
const C = coach as any;
const L = leader as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/observe" element={<CoachObserve />} />
        <Route path="/portal/coach/observe/pick" element={<CoachObservePick />} />
        <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
        <Route path="/portal/coach/schedule" element={<div>my schedule</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // bd-o15qnr.8: the visits below are dated; pin the clock to their day.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00+05:00"));
  C.getHome.mockResolvedValue({ success: true, home: { today: [{ id: VISIT_ID, teacherName: "Ayesha Bibi", scheduledSlot: "11:30", status: "upcoming", current: true }], counts: { week: 6, overdue: 1, waiting: 1, inProgress: 1, teachers: 24, schools: 12 } } });
  C.getSchedule.mockResolvedValue({
    success: true, from: "2026-10-06", to: "2026-10-06",
    overdue: [{ id: "o1", teacherName: "Sadia Noor", teacherExtId: "923001110005", schoolName: "IMCB G-9/4", schoolExtId: "niete:494", scheduledFor: "2026-10-02", scheduledSlot: "09:00", status: "upcoming", overdue: true }],
    visits: [
      { id: "v1", teacherName: "Mehwish Khan", teacherExtId: "923001110002", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "09:00", status: "done", overdue: false },
      { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
    ],
  });
  C.getVisit.mockResolvedValue({
    success: true,
    visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
    teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
    lastVisit: { date: "2026-09-14T09:00:00Z", score: 61 },
  });
  L.cancelSchedule.mockResolvedValue({ success: true, cancelled: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Observe hub", () => {
  it("two tiles: Take observation and Reports", async () => {
    renderAt("/portal/coach/observe");
    expect(await screen.findByRole("link", { name: /Take observation/ })).toHaveAttribute("href", "/portal/coach/observe/pick");
    expect(screen.getByRole("link", { name: /Reports/ })).toHaveAttribute("href", "/portal/coach/reports");
    expect(screen.getByRole("link", { name: /Reports/ })).toHaveTextContent("1 waiting");
    expect(screen.queryByText("Record live")).toBeNull();
  });
});

describe("Pick the teacher", () => {
  it("today's visits and, under Earlier, the overdue ones; a done one cannot be picked", async () => {
    renderAt("/portal/coach/observe/pick");
    expect((await screen.findByText("Ayesha Bibi")).closest("a")).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}`);
    fireEvent.click(screen.getByRole("button", { name: /Earlier/ }));
    expect(screen.getByText("Sadia Noor").closest("a")).toHaveAttribute("href", "/portal/coach/visit/o1");
    expect(screen.getByText("Mehwish Khan").closest("a")).toBeNull();
  });

  it("search by phone, and filter by school", async () => {
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "03001110005" } });
    expect(screen.queryByText("Ayesha Bibi")).toBeNull();
    expect(screen.getByText("Sadia Noor")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("School"), { target: { value: "niete:110" } });
    expect(screen.queryByText("Sadia Noor")).toBeNull();
    expect(screen.getByText("Ayesha Bibi")).toBeInTheDocument();
  });

  it("no scheduled visit: Schedule a visit first", async () => {
    renderAt("/portal/coach/observe/pick");
    expect(await screen.findByRole("link", { name: /Schedule a visit first/ })).toHaveAttribute("href", "/portal/coach/new-visit");
  });
});

describe("Visit — Record live or Attach", () => {
  it("the teacher's numbers, then the two ways, both tied to this visit", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Ayesha Bibi");
    const stats = within(screen.getByTestId("visit-stats"));
    expect(stats.getByText("61%")).toBeInTheDocument();
    expect(stats.getByText("12d")).toBeInTheDocument();
    const ret = encodeURIComponent(`/portal/coach/visit/${VISIT_ID}`);
    expect(screen.getByRole("link", { name: /Record live/ })).toHaveAttribute("href",
      `/portal/leader/observe/new?teacher=923001110001&school=niete%3A110&way=record&return=${ret}`);
    expect(screen.getByRole("link", { name: /Attach recording/ })).toHaveAttribute("href",
      `/portal/leader/observe/new?teacher=923001110001&school=niete%3A110&way=upload&return=${ret}`);
    expect(screen.getByRole("link", { name: /Teacher profile/ })).toHaveAttribute("href", "/portal/coach/teacher/923001110001");
  });

  it("Reschedule opens step 3 for this visit", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const link = await screen.findByRole("link", { name: /Reschedule/ });
    expect(link.getAttribute("href")).toContain(`visit=${VISIT_ID}`);
    expect(link.getAttribute("href")).toContain("teacher=923001110001");
  });

  it("Cancel asks first, then cancels and goes to My schedule", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: /^Cancel$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Cancel visit/ }));
    await waitFor(() => expect(L.cancelSchedule).toHaveBeenCalledWith(VISIT_ID));
    expect(await screen.findByText("my schedule")).toBeInTheDocument();
  });

  it("a done visit offers no Record/Attach", async () => {
    C.getVisit.mockResolvedValue({ success: true, visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "done" }, teacher: null, lastVisit: null });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: /Record live/ })).toBeNull();
  });
});
