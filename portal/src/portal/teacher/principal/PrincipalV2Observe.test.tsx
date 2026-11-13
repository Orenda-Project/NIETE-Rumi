import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-33wxxi.9.2 — the principal app v2 Observe page (#78; the operator, 10 Nov: "observation and digital coach being
 * separate does not make sense now"). For a principal on the principal app, Observations becomes ONE place, titled
 * Observe:
 *   the pair                  My own lesson / One of my teachers (as #55)
 *   My observations           her teachers' observations, the step each waits on, never a score (as #55)
 *   Recent DC Observations    HER OWN Digital Coaching lessons (GET /teacher/coaching/history), each opening its lesson,
 *                             See all → All DC Observations
 *   From WhatsApp             her classroom recordings sent on WhatsApp and not sent yet, as on the DC page
 *   about her                 the page's own sections, unchanged
 * Digital Coaching's main page sends her to Observe, so every Back inside DC lands there. A teacher's Observations and
 * Digital Coaching are unchanged.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  portal: { getCoachingSessions: vi.fn(), getConfig: vi.fn() },
  coach: { getReports: vi.fn(), getVisit: vi.fn(), getObservation: vi.fn(), getPending: vi.fn() },
  leader: { getObserveRecentPlans: vi.fn() },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, ...api }));

import "../routes";
import http from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import i18n from "@/i18n/config";
import { TEACHER_ROUTES } from "../routes";
import { OBS_HOME } from "../observations/paths";
import { COACHING_ALL, COACHING_HOME, COACHING_NEW, lessonPath } from "../coaching/paths";
import { beforeAll as preloadFirst } from "vitest";
import * as lazyPage from "@/lib/lazyPage";

const { preloadAll } = lazyPage as { preloadAll?: (w: { pages?: boolean }) => Promise<unknown> };
preloadFirst(() => preloadAll?.({ pages: true }), 120_000);

const H = http as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TEACHER = { ...PRINCIPAL, role: "teacher", phoneNumber: "test-teacher-1" };
const TODAY = new Date().toISOString();
const DAY = TODAY.slice(0, 10);

const report = (id: string, ext: string, name: string, step: string) => ({
  id, createdAt: TODAY, teacherName: name, teacherPhone: null, teacherExtId: ext, schoolName: "GGPS Sample", schoolExtId: "niete:1126",
  status: step === "sent" ? "completed" : "observer_review_pending", step, score: step === "sent" ? 61 : null, portal: true,
});
const REPORTS = {
  success: true, waiting: [], inProgress: [],
  all: { total: 1, page: 1, pageSize: 30, items: [report("aaaaaaaa-0000-4000-8000-000000000002", "900002", "Bina Sample", "sent")] },
};
const lesson = (id: string, topic: string, percentage: number | null) => ({
  id, date: DAY, topic, subject: "Mathematics", grade: 5, minutes: 30, percentage, reportReady: percentage != null,
});
const HISTORY = {
  success: true, range: { key: "all", from: null, to: null }, previous: null,
  kpis: { sessions: { value: 2, previous: null }, minutes: { value: 60, previous: null }, reports: { value: 1, previous: null } },
  trend: { bucketDays: 7, points: [] }, total: 2, truncated: false,
  items: [lesson("dc-1", "Fractions", 72), lesson("dc-2", "Shapes", null)],
};
const PENDING = { success: true, recordings: [{ key: "k1", id: "rec-1", seconds: 1500, receivedAt: TODAY, listenUrl: null, duplicateOf: null }] };

let where = "";
function Where() { const l = useLocation(); where = l.pathname; return null; }

function serve(principalApp = true) {
  api.portal.getConfig.mockResolvedValue({ features: { teacherV2: true, principalApp } });
  api.portal.getCoachingSessions.mockResolvedValue({ sessions: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } });
  api.coach.getReports.mockResolvedValue(REPORTS);
  H.get.mockImplementation(async (url: string) => {
    if (url === "/teacher/coaching/history") return { data: HISTORY };
    if (url === "/coaching-upload/pending") return { data: PENDING };
    if (url === "/teacher/visits") return { data: { success: true, next: null, inProgress: [] } };
    return { data: { success: true } };
  });
}

function open(path: string, user = PRINCIPAL) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>{TEACHER_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
    </MemoryRouter>,
  );
}

const T = { timeout: 15_000 };
// a slow, shared machine: the page loads its lazy chunks and three reads before the first assertion
vi.setConfig({ testTimeout: 40_000 });

describe("the principal app v2 Observe page", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    forgetConfig();
    await i18n.changeLanguage("en");
  });

  it("titled Observe; the pair, her teachers' observations, then her own DC lessons in that order", async () => {
    serve();
    open(OBS_HOME);
    const dc = await screen.findByTestId("principal-dc", {}, T);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Observe");
    const tiles = screen.getByTestId("principal-observe-tiles");
    const mine = screen.getByTestId("principal-observations");
    expect(!!(tiles.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(!!(mine.compareDocumentPosition(dc) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    await waitFor(() => expect(within(dc).getByText("Fractions")).toBeTruthy(), T);
    expect(within(dc).getByText("Recent DC Observations")).toBeTruthy();
    // each lesson opens its own report; See all opens All DC Observations
    const hrefs = within(dc).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(lessonPath("dc-1"));
    expect(hrefs).toContain(COACHING_ALL);
    // her own DC lessons say a band, never a number
    expect(within(dc).queryByText(/72/)).toBeNull();
  });

  it("her recordings sent on WhatsApp and not sent yet are here too, each opening My own lesson with it", async () => {
    serve();
    open(OBS_HOME);
    const dc = await screen.findByTestId("principal-dc", {}, T);
    const rec = await within(dc).findByRole("link", { name: /from WhatsApp/i }, T);
    expect(rec.getAttribute("href")).toBe(`${COACHING_NEW}?recording=rec-1`);
  });

  it("Digital Coaching's main page sends her to Observe (every Back inside DC lands there)", async () => {
    serve();
    open(COACHING_HOME);
    await waitFor(() => expect(where).toBe(OBS_HOME), T);
  });

  it("a teacher: Observations has no DC section, and Digital Coaching stays its own page", async () => {
    serve(false);
    open(OBS_HOME, TEACHER);
    await screen.findByText("Next visit", {}, T);
    expect(screen.queryByTestId("principal-dc")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("Observe");
    const view = open(COACHING_HOME, TEACHER);
    await screen.findByTestId("dc-home", {}, T);
    expect(where).toBe(COACHING_HOME);
    view.unmount();
  });

  it("in Urdu: the coach's Observe word as the title, the DC heading in Urdu", async () => {
    await i18n.changeLanguage("ur");
    serve();
    open(OBS_HOME);
    const dc = await screen.findByTestId("principal-dc", {}, T);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("مشاہدہ");
    await waitFor(() => expect(within(dc).getByText("حالیہ ڈیجیٹل کوچنگ مشاہدات")).toBeTruthy(), T);
  });
});
