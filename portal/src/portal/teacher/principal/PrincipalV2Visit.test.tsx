import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-33wxxi.9.3 — the principal app v2: a picked teacher opens the COACH's visit screen (#78; the operator, 10 Nov: "The
 * UI for recording/attach recording ... Too bland. It needs to look similar to the Coach's flow"):
 *   the squares   Start recording / Upload recording (RecordUploadPair), going to her own record / attach steps
 *   no actions    no Reschedule, no Cancel visit (she has no booked visit), no Last visit row, no coach Teacher profile
 *   Teacher card  name, "last observed …" (her own observations), school, Today; this week's counts from her school
 *                 card's row (lesson plans, Digital Coaching, modules, assessments): counts only, never a score (#55 Q1)
 *   Back          Pick the teacher; Check and send's Back is this screen
 * Nothing is read from the coach's visit API and nothing is posted (no visit is made, no notice reaches the teacher).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// the coach's own screen is drawn bare here (the coach app's gate is not what this suite is about)
vi.mock("../../coach/CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const api = vi.hoisted(() => ({
  portal: { getCoachingSessions: vi.fn(), getConfig: vi.fn() },
  coach: { getReports: vi.fn(), getVisit: vi.fn(), getObservation: vi.fn(), getPending: vi.fn() },
  leader: { getObserveRecentPlans: vi.fn(), cancelSchedule: vi.fn() },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ...api }));

import "../routes";
import http from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import i18n from "@/i18n/config";
import { TEACHER_ROUTES } from "../routes";
import CoachVisit from "../../coach/pages/CoachVisit";
import { beforeAll as preloadFirst } from "vitest";
import * as lazyPage from "@/lib/lazyPage";

const { preloadAll } = lazyPage as { preloadAll?: (w: { pages?: boolean }) => Promise<unknown> };
preloadFirst(() => preloadAll?.({ pages: true }), 120_000);
vi.setConfig({ testTimeout: 20_000 });

const H = http as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TODAY = new Date().toISOString();

const teacher = (ext: string, name: string, counts: Record<string, number>) => ({
  id: `u-${ext}`, teacherExtId: ext, name, isPrincipal: false, levels: ["PRIMARY"], counts,
  total: 0, contributionPct: null, star: false, lastVisitDaysAgo: null,
});
const CARD = {
  success: true, school: { emis: "1126", name: "GGPS Sample", teachers: 2, lastVisitDaysAgo: null },
  teachers: [teacher("900001", "Ayesha Sample", { lp: 7, dc: 1, training: 2, papers: 3 }), teacher("900002", "Bina Sample", { lp: 0, dc: 0, training: 0, papers: 0 })],
  scores: { dc: { count: 1, makers: 1 }, coach: { count: 0, makers: 0 } },
};
const REPORTS = {
  success: true, waiting: [], inProgress: [],
  all: { total: 1, page: 1, pageSize: 30, items: [{
    id: "aaaaaaaa-0000-4000-8000-000000000001", createdAt: TODAY, teacherName: "Ayesha Sample", teacherPhone: null, teacherExtId: "900001",
    schoolName: "GGPS Sample", schoolExtId: "niete:1126", status: "completed", step: "sent", score: 61, portal: true,
  }] },
};

let where = "";
function Where() { const l = useLocation(); where = l.pathname; return null; }

function serve() {
  api.portal.getConfig.mockResolvedValue({ features: { teacherV2: true, principalApp: true } });
  api.coach.getReports.mockResolvedValue(REPORTS);
  H.get.mockImplementation(async (url: string) => {
    if (url === "/principal/school/card") return { data: CARD };
    return { data: { success: true } };
  });
}

function open(path: string) {
  vi.mocked(useAuth).mockReturnValue({ user: PRINCIPAL, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>{TEACHER_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
    </MemoryRouter>,
  );
}

const T = { timeout: 8000 };
const VISIT = "/portal/teacher/principal/visit/900001";

describe("the principal app v2: a picked teacher opens the coach's visit screen", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    forgetConfig();
    await i18n.changeLanguage("en");
  });

  it("Pick the teacher: a row opens her visit screen", async () => {
    serve();
    open("/portal/teacher/principal/pick");
    await screen.findByText("Ayesha Sample", {}, T);
    const ayesha = screen.getAllByRole("link").find((a) => /Ayesha/.test(a.textContent || ""));
    expect(ayesha?.getAttribute("href")).toBe(VISIT);
  });

  it("the squares go to her own record / upload steps; no Reschedule, no Cancel visit; nothing read or made at the coach's visit API", async () => {
    serve();
    open(VISIT);
    const start = await screen.findByRole("link", { name: "Start recording" }, T);
    expect(start.getAttribute("href")).toBe("/portal/teacher/principal/observe/900001/record");
    expect(screen.getByRole("link", { name: "Upload recording" }).getAttribute("href")).toBe("/portal/teacher/principal/observe/900001/attach");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ayesha Sample");
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.queryByText("Cancel visit")).toBeNull();
    expect(screen.queryByText("Teacher profile")).toBeNull();
    expect(screen.queryByTestId("last-visit-row")).toBeNull();
    expect(api.coach.getVisit).not.toHaveBeenCalled();
    expect(H.post).not.toHaveBeenCalled();
  });

  it("the crumb says One of my teachers · Today, and Back is Pick the teacher", async () => {
    serve();
    open(VISIT);
    await screen.findByRole("link", { name: "Start recording" }, T);
    expect(document.body.textContent).toContain("One of my teachers · Today");
    const back = document.querySelector('a[href="/portal/teacher/principal/pick"]');
    expect(back).toBeTruthy();
  });

  it("the Teacher card: last observed, the school, Today, and this week's counts from her school card; never a score", async () => {
    serve();
    open(VISIT);
    const card = await screen.findByTestId("teacher-card", {}, T);
    await waitFor(() => expect(within(card).getByText("last observed Today")).toBeTruthy(), T);
    expect(within(card).getByText("GGPS Sample")).toBeTruthy();
    const stats = within(card).getByTestId("visit-stats");
    for (const [n, label] of [["7", "Lesson plans"], ["1", "Digital Coaching"], ["2", "Modules completed"], ["3", "Assessments"]]) {
      expect(within(stats).getByText(n)).toBeTruthy();
      expect(within(stats).getByText(label)).toBeTruthy();
    }
    expect(within(card).queryByText(/%/)).toBeNull();
    expect(within(card).queryByText("61")).toBeNull();
    // no dangling "·" before Today (she has no visit time)
    expect(within(card).queryByText(/^·/)).toBeNull();
  });

  it("a teacher she has not observed: not observed yet", async () => {
    serve();
    open("/portal/teacher/principal/visit/900002");
    const card = await screen.findByTestId("teacher-card", {}, T);
    await waitFor(() => expect(within(card).getByText("not observed yet")).toBeTruthy(), T);
  });

  it("Check and send's Back is her visit screen", async () => {
    serve();
    open("/portal/teacher/principal/observe/900001");
    await screen.findByRole("link", { name: "Start recording" }, T);
    expect(document.querySelector(`a[href="${VISIT}"]`)).toBeTruthy();
  });

  it("in Urdu: the coach's square words and the principal's crumb", async () => {
    await i18n.changeLanguage("ur");
    serve();
    open(VISIT);
    await screen.findByTestId("teacher-card", {}, T);
    await waitFor(() => expect(document.body.textContent).toContain("کسی ٹیچر کا سبق"), T);
  });
});

describe("the coach's visit screen is unchanged", () => {
  it("Reschedule and Cancel visit, the coach's own visit paths, the coach's visit read", async () => {
    vi.clearAllMocks();
    forgetConfig();
    await i18n.changeLanguage("en");
    api.portal.getConfig.mockResolvedValue({ features: { coachV2: true } });
    api.coach.getVisit.mockResolvedValue({
      success: true,
      visit: { id: "v1", teacherName: "Farah Sample", schoolName: "GGPS Sample", schoolExtId: "niete:1", teacherExtId: "t1", scheduledFor: "2099-01-01", scheduledSlot: "08:30", status: "upcoming" },
      teacher: { teacherExtId: "t1", name: "Farah Sample", phone: "923001234567", schoolName: "GGPS Sample", emis: "1", schoolExtId: "niete:1", hitl: 3, dc: 1, avgHitl: 70, daysSinceVisit: null, daysSinceTraining: 2 },
      lastVisit: null,
    });
    vi.mocked(useAuth).mockReturnValue({ user: { ...PRINCIPAL, role: "coach" }, loading: false } as unknown as ReturnType<typeof useAuth>);
    render(
      <MemoryRouter initialEntries={["/portal/coach/visit/v1"]}>
        <Routes><Route path="/portal/coach/visit/:id" element={<CoachVisit />} /></Routes>
      </MemoryRouter>,
    );
    const start = await screen.findByRole("link", { name: "Start recording" }, T);
    expect(start.getAttribute("href")).toBe("/portal/coach/visit/v1/record");
    expect(screen.getByRole("link", { name: "Upload recording" }).getAttribute("href")).toBe("/portal/coach/visit/v1/attach");
    expect(screen.getByText("Reschedule")).toBeTruthy();
    expect(screen.getAllByText("Cancel visit").length).toBeGreaterThan(0);
    expect(screen.getByText("Teacher profile")).toBeTruthy();
    expect(api.coach.getVisit).toHaveBeenCalledWith("v1");
  });
});
