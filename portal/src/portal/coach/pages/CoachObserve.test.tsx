import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getSchedule: vi.fn(), getVisit: vi.fn(), getPeople: vi.fn() },
  leader: { cancelSchedule: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import { resetSender } from "../observe/sender";
import CoachObserve from "./CoachObserve";
import CoachObservePick from "./CoachObservePick";
import CoachVisit from "./CoachVisit";

/**
 * bd-o15qnr — Observe is always against a scheduled visit:
 * Take observation → pick the teacher (today + overdue, grouped by day; NO search, one School button) → the Visit page
 * asks Start recording or Upload recording, then the v2 Record / Upload / Check-and-send steps (bd-o15qnr.9).
 * bd-4404s7.4 — rebuilt on the kit; English and Urdu.
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

beforeEach(async () => {
  vi.clearAllMocks();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
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
    expect(await screen.findByText("1 waiting")).toBeInTheDocument();
    expect(screen.queryByText("Record live")).toBeNull();
  });

  it("'N left today' only from her real visits today (the API's home.today), never made up", async () => {
    renderAt("/portal/coach/observe");
    expect(await screen.findByText("1 left today")).toBeInTheDocument();
    cleanup();
    C.getHome.mockResolvedValue({ success: true, home: { today: [], next: null, counts: { week: 0, overdue: 0, waiting: 0, inProgress: 0, teachers: 0, schools: 0 } } });
    renderAt("/portal/coach/observe");
    await screen.findByRole("link", { name: /Take observation/ });
    expect(screen.queryByText(/left today/)).toBeNull();
    expect(screen.queryByText(/waiting|in progress/)).toBeNull();
  });

  it("Next visit: her next visit with the time (TimeStamp), the school and how soon", async () => {
    C.getHome.mockResolvedValue({
      success: true,
      home: {
        today: [], counts: { week: 6, overdue: 0, waiting: 0, inProgress: 0, teachers: 24, schools: 12 },
        next: { id: VISIT_ID, teacherName: "Ayesha Bibi", schoolName: "IMSG I-10/1", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming" },
      },
    });
    renderAt("/portal/coach/observe");
    const row = await screen.findByTestId("next-visit-card");
    expect(within(row).getByRole("link")).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}`);
    expect(row).toHaveTextContent("Ayesha Bibi");
    expect(row).toHaveTextContent("IMSG I-10/1");
    expect(within(row).getByRole("img", { name: "11:30 AM" })).toBeInTheDocument();
    expect(row).toHaveTextContent("In 2 h");
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt("/portal/coach/observe");
    expect(await screen.findByRole("link", { name: /مشاہدہ لیں/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /رپورٹس/ })).toBeInTheDocument();
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

  it("no search box (operator, 9 Oct): the list is grouped, and one School button narrows it", async () => {
    renderAt("/portal/coach/observe/pick");
    await screen.findByText("Ayesha Bibi");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText("Name or phone")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^School, / }));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("IMCB G-9/4"));
    expect(screen.queryByText("Ayesha Bibi")).toBeNull();
    // a school filter opens Earlier, so a match is never hidden behind the fold
    expect(screen.getByText("Sadia Noor")).toBeInTheDocument();
  });

  it("times are TimeStamps and a visit's status uses the status chips", async () => {
    renderAt("/portal/coach/observe/pick");
    const row = (await screen.findByText("Ayesha Bibi")).closest("a") as HTMLElement;
    expect(within(row).getByRole("img", { name: "11:30 AM" })).toBeInTheDocument();
    expect(row).toHaveTextContent("Next");
    fireEvent.click(screen.getByRole("button", { name: /Earlier/ }));
    expect(screen.getByText("4 days late")).toBeInTheDocument();
  });

  it("no scheduled visit: Schedule a visit first", async () => {
    renderAt("/portal/coach/observe/pick");
    expect(await screen.findByRole("link", { name: /Schedule a visit first/ })).toHaveAttribute("href", "/portal/coach/new-visit");
  });
});

describe("Visit — Start recording or Upload recording", () => {
  it("the teacher's numbers, then the two ways, both tied to this visit", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Ayesha Bibi");
    const stats = within(screen.getByTestId("visit-stats"));
    expect(stats.getByText("61%")).toBeInTheDocument();
    expect(stats.getByText("12d")).toBeInTheDocument();
    // bd-o15qnr.9 — the visit's own v2 steps, never the old page and its second Record/Upload sheet.
    expect(screen.getByRole("link", { name: /Start recording/ })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
    expect(screen.getByRole("link", { name: /Upload recording/ })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/attach`);
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
    fireEvent.click(await screen.findByRole("button", { name: /^Cancel visit$/ }));
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByRole("button", { name: "Keep visit" })).toBeInTheDocument();
    fireEvent.click(within(tray).getByRole("button", { name: "Cancel visit" }));
    await waitFor(() => expect(L.cancelSchedule).toHaveBeenCalledWith(VISIT_ID));
    expect(await screen.findByText("my schedule")).toBeInTheDocument();
  });

  it("a done visit offers no Start recording/Upload recording", async () => {
    C.getVisit.mockResolvedValue({ success: true, visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "done" }, teacher: null, lastVisit: null });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("link", { name: /Start recording/ })).toBeNull();
  });
});
