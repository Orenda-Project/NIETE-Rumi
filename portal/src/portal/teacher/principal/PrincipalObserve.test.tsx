import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-33wxxi.4 — the principal app's Observations (#55 P3, Observations A), on the coach's own observe screens:
 *
 *   Observations   two tiles — My own lesson (→ Digital Coaching's New observation) and One of my teachers (→ Pick the
 *                  teacher, with "N waiting") — then the observations SHE made (the coach Reports' rows, opening here),
 *                  then the page's own sections about her (Next visit…). A teacher's page is unchanged.
 *   Pick           her own school's teachers A to Z (GET /principal/school/card), "last observed …" / "not observed
 *                  yet", a row opening Check and send for that teacher.
 *   Check and send the coach's screen for the picked teacher: NO visit is read or made (no /coach/visit, no POST
 *                  /leader/schedules: nothing goes to the teacher); Start recording / Upload recording stay here.
 *   Anyone else    on a principal route → Observations.
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
import { COACHING_NEW } from "../coaching/paths";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

preloadFirst(() => preloadAll({ pages: true }), 120_000);

const H = http as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TEACHER = { ...PRINCIPAL, role: "teacher", phoneNumber: "test-teacher-1" };
const TODAY = new Date().toISOString();

const teacher = (ext: string, name: string, levels: string[]) => ({
  id: `u-${ext}`, teacherExtId: ext, name, isPrincipal: false, levels, counts: { lp: 0, dc: 0, training: 0, papers: 0 },
  total: 0, contributionPct: null, star: false, lastVisitDaysAgo: null,
});
const CARD = {
  success: true, school: { emis: "1126", name: "GGPS Sample", teachers: 3, lastVisitDaysAgo: null },
  teachers: [teacher("900002", "Bina Sample", ["MIDDLE"]), teacher("900001", "Ayesha Sample", ["PRIMARY"]), teacher("900003", "Comal Sample", [])],
  scores: { dc: { count: 0, makers: 0 }, coach: { count: 0, makers: 0 } },
};
const report = (id: string, ext: string, name: string, step: string) => ({
  id, createdAt: TODAY, teacherName: name, teacherPhone: null, teacherExtId: ext, schoolName: "GGPS Sample", schoolExtId: "niete:1126",
  status: step === "sent" ? "completed" : "observer_review_pending", step, score: step === "sent" ? 61 : null, portal: true,
});
const REPORTS = {
  success: true,
  waiting: [report("aaaaaaaa-0000-4000-8000-000000000001", "900001", "Ayesha Sample", "talk")],
  inProgress: [],
  all: { total: 2, page: 1, pageSize: 30, items: [report("aaaaaaaa-0000-4000-8000-000000000001", "900001", "Ayesha Sample", "talk"), report("aaaaaaaa-0000-4000-8000-000000000002", "900002", "Bina Sample", "sent")] },
};

let where = "";
function Where() { const l = useLocation(); where = l.pathname; return null; }

function serve(principalApp = true) {
  api.portal.getConfig.mockResolvedValue({ features: { teacherV2: true, principalApp } });
  api.portal.getCoachingSessions.mockResolvedValue({ sessions: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } });
  api.coach.getReports.mockResolvedValue(REPORTS);
  H.get.mockImplementation(async (url: string) => {
    if (url === "/principal/school/card") return { data: CARD };
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

const T = { timeout: 8000 };

describe("the principal app's Observations", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    forgetConfig();
    await i18n.changeLanguage("en");
  });

  it("two tiles: My own lesson (her Digital Coaching) and One of my teachers (Pick), with the waiting chip", async () => {
    serve();
    open(OBS_HOME);
    const tiles = await screen.findByTestId("principal-observe-tiles", {}, T);
    const own = within(tiles).getByRole("link", { name: /My own lesson/ });
    expect(own.getAttribute("href")).toBe(COACHING_NEW);
    const one = within(tiles).getByRole("link", { name: /One of my teachers/ });
    expect(one.getAttribute("href")).toBe("/portal/teacher/principal/pick");
    expect(await within(tiles).findByText("1 waiting", {}, T)).toBeTruthy();
  });

  it("the observations she made open HER observation page; the page's own sections follow", async () => {
    serve();
    open(OBS_HOME);
    const mine = await screen.findByTestId("principal-observations", {}, T);
    await waitFor(() => expect(within(mine).getByText("Ayesha Sample")).toBeTruthy(), T);
    const hrefs = within(mine).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/portal/teacher/principal/observation/aaaaaaaa-0000-4000-8000-000000000001");
    expect(hrefs.every((h) => !String(h).startsWith("/portal/coach"))).toBe(true);
    expect(screen.getByText("Next visit")).toBeTruthy();
    // #55 Q1 (no raw scores) and the approved mockup: a sent one says Sent, never its score
    expect(within(mine).getByText("Sent")).toBeTruthy();
    expect(within(mine).queryByText(/%/)).toBeNull();
  });

  it("a teacher's Observations is unchanged: no tiles, no reports of hers asked", async () => {
    serve(false);
    open(OBS_HOME, TEACHER);
    await screen.findByText("Next visit", {}, T);
    expect(screen.queryByTestId("principal-observe-tiles")).toBeNull();
    expect(api.coach.getReports).not.toHaveBeenCalled();
  });

  it("Pick the teacher: her school's teachers A to Z, last observed / not observed yet, each opening Check and send", async () => {
    serve();
    open("/portal/teacher/principal/pick");
    await screen.findByText("Ayesha Sample", {}, T);
    const names = screen.getAllByRole("link").map((a) => a.textContent || "").filter((t) => /Sample/.test(t));
    expect(names.map((n) => n.match(/(Ayesha|Bina|Comal) Sample/)?.[0])).toEqual(["Ayesha Sample", "Bina Sample", "Comal Sample"]);
    expect(screen.getByText("Primary · last observed Today")).toBeTruthy();
    expect(screen.getByText("Middle · last observed Today")).toBeTruthy();
    expect(screen.getByText("not observed yet")).toBeTruthy();
    const ayesha = screen.getAllByRole("link").find((a) => /Ayesha/.test(a.textContent || ""));
    expect(ayesha?.getAttribute("href")).toBe("/portal/teacher/principal/observe/900001");
  });

  it("Check and send for a picked teacher: no visit is read or made; Start recording / Upload recording stay in her app", async () => {
    serve();
    open("/portal/teacher/principal/observe/900001");
    const start = await screen.findByRole("link", { name: "Start recording" }, T);
    expect(start.getAttribute("href")).toBe("/portal/teacher/principal/observe/900001/record");
    expect(screen.getByRole("link", { name: "Upload recording" }).getAttribute("href")).toBe("/portal/teacher/principal/observe/900001/attach");
    expect(screen.getAllByText(/Ayesha Sample/).length).toBeGreaterThan(0);
    expect(api.coach.getVisit).not.toHaveBeenCalled();
    expect(H.post).not.toHaveBeenCalled();
  });

  it("anyone the principal app does not name is sent to Observations from a principal route", async () => {
    serve(false);
    open("/portal/teacher/principal/pick");
    await waitFor(() => expect(where).toBe(OBS_HOME), T);
  });

  it("in Urdu: the two tiles", async () => {
    await i18n.changeLanguage("ur");
    serve();
    open(OBS_HOME);
    const tiles = await screen.findByTestId("principal-observe-tiles", {}, T);
    expect(within(tiles).getByText("میرا اپنا سبق")).toBeTruthy();
    expect(within(tiles).getByText("کسی ٹیچر کا سبق")).toBeTruthy();
  });
});
