import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-f5a245 (queue #245; #244's finding 10; the operator 24 Nov ~06:25: "3 ok with your recom") — a visit whose analysis
 * stopped (failed, or abandoned by the system) is hers to act on. On the portal_coach_flow_v2 switch, coach and
 * principal, English and Urdu:
 *   1. Needs you lists it: the teacher, the "Analysis stopped" chip (red), opening its observation; My observations'
 *      card says what to do next ("Next: Upload recording"); the Home's Focus card opens it without a progress line.
 *   2. Its observation page says "Analysis stopped", one plain line and ONE button, Upload recording (the vocabulary's word): the coach's goes to
 *      Schedule an observation with that teacher picked (Now: Record or Upload); the principal's to that teacher's page.
 *      No empty "AI score" ring under it. A visit she cancelled keeps "Observation stopped".
 *   3. The visit page (her schedule entry) says "Analysis stopped" with Upload recording, never "Done".
 * The server puts the row in Needs you (tests/portal/bd-f5a245-failed-analysis-listed.test.js); off the switch nothing
 * changes here.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock("../training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  coach: { getObservation: vi.fn(), getVisit: vi.fn(), getReports: vi.fn(), getSchedule: vi.fn(), getPending: vi.fn(), getHome: vi.fn(() => Promise.resolve({ success: true })) },
  leader: { getObservation: vi.fn(), cancelSchedule: vi.fn() },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../report/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getCoachReport: vi.fn(), markOpened: vi.fn(async () => {}) }));
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.mock("../ui", async (orig) => ({ ...(await orig<object>()), readPending: vi.fn(() => Promise.resolve({ waiting: 1, ids: ["cs-1"] })) }));
vi.mock("../observe/sender", async (orig) => ({ ...(await orig<object>()), useSendJob: () => null, retrySend: vi.fn() }));
vi.setConfig({ testTimeout: 20_000 });
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on, useCoachFlowV2: () => flow.on }));

import { coach, leader } from "../../services/api";
import CoachObservation from "../pages/CoachObservation";
import CoachVisit from "../pages/CoachVisit";
import { ObserveRoute } from "./routes";
import { FocusCard } from "./FocusCard";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";
import { nextWords, reportChip } from "../reports/ReportRows";
import { REPORTS_EN, REPORTS_UR } from "../reports/copy";
import { FLOW_V7_COPY } from "./copyV7";
import { karachiDay } from "../time";

const C = coach as unknown as Record<string, Mock>;
const L = leader as unknown as { getObservation: Mock };

const AT = "2026-11-24T03:30:00Z";
const LESSON_URL = "https://r2.example/lesson.webm?sig=1";
const STOPPED_ROW = {
  id: "cs-1", createdAt: AT, teacherName: "FLN QA Teacher EN G1", teacherPhone: null, teacherExtId: "929998100001",
  schoolName: "FLN QA School (synthetic)", schoolExtId: "niete:110", status: "failed", step: "stopped", stage: "stopped",
  score: null, portal: true, obs612: null, listening: false, grade: 1, subject: "english",
};
const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: AT, step: "stopped", portal: true, mine: true, score: null, dcScore: null, cancelled: false,
  summary: null, teacher: { name: "FLN QA Teacher EN G1", teacherExtId: "929998100001", schoolName: "FLN QA School (synthetic)", schoolExtId: "niete:110" },
  observer: { self: true, name: "Hina" }, sentAt: null, caption: null, imageUrl: null, audioUrl: LESSON_URL, obs612: null, ...extra,
});
const VIEW = (extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: AT, sessionStatus: "failed", step: "stopped", problem: null, preparing: false,
  teacher: { name: "FLN QA Teacher EN G1", phone: "929998100001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, audioUrl: null, feedback: null },
  report: { status: null, teacherName: "FLN QA Teacher EN G1", teacherPhone: "929998100001", caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  rubric: { id: "fico17_v6", label: "FICO17 v6" },
  ...extra,
});
const VISIT = {
  id: "v1", teacherName: "FLN QA Teacher EN G1", teacherExtId: "929998100001", schoolName: "FLN QA School (synthetic)", schoolExtId: "niete:110",
  scheduledFor: "2026-11-24", scheduledSlot: "08:30", status: "done", sessionId: "cs-1",
};
const NEW_VISIT_AGAIN = "/portal/coach/new-visit?school=niete%3A110&teacher=929998100001";

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const urdu = async () => { await act(async () => { await i18n.changeLanguage("ur"); }); };

describe("the row's words (one rule for every list)", () => {
  it("the chip is 'Analysis stopped', red, on and off the switch", () => {
    const row = STOPPED_ROW as never;
    expect(reportChip(row, REPORTS_EN as never, true)).toEqual({ text: "Analysis stopped", tone: "error" });
    expect(reportChip(row, REPORTS_EN as never)).toEqual({ text: "Analysis stopped", tone: "error" });
    expect(reportChip(row, REPORTS_UR as never, true)).toEqual({ text: "تجزیہ رک گیا", tone: "error" });
  });
  it("what is hers next: 'Next: Upload recording'", () => {
    expect(nextWords({ step: "stopped", listening: false }, REPORTS_EN as never, FLOW_V7_COPY as never)).toBe("Next: Upload recording");
    expect(nextWords({ step: "stopped", listening: false }, REPORTS_UR as never, FLOW_V7_COPY as never)).toBe("اگلا قدم: ریکارڈنگ اپ لوڈ کریں");
  });
});

describe("Observe: Needs you lists it", () => {
  const renderObserve = () => render(
    <MemoryRouter initialEntries={["/portal/coach/observe"]}>
      <Routes><Route path="/portal/coach/observe" element={<ObserveRoute />} /></Routes>
    </MemoryRouter>,
  );
  beforeEach(() => {
    const today = karachiDay();
    C.getSchedule.mockResolvedValue({ success: true, from: today, to: today, overdue: [], visits: [] });
    C.getReports.mockResolvedValue({ success: true, waiting: [STOPPED_ROW], inProgress: [], all: { total: 1, page: 1, pageSize: 30, items: [STOPPED_ROW] } });
    C.getPending.mockResolvedValue({ success: true, waiting: 1, ids: ["cs-1"] });
  });

  it("the teacher, 'Analysis stopped', opening its observation; In progress does not have it", async () => {
    renderObserve();
    const box = await screen.findByTestId("needs-you");
    const row = await within(box).findByRole("link", { name: /FLN QA Teacher EN G1/ });
    expect(row).toHaveTextContent("Analysis stopped");
    expect(row).toHaveAttribute("href", "/portal/coach/observation/cs-1");
    expect(screen.queryByTestId("in-progress")).toBeNull();
  });

  it("in Urdu", async () => {
    await urdu();
    renderObserve();
    const box = await screen.findByTestId("needs-you");
    expect(await within(box).findByText("تجزیہ رک گیا")).toBeInTheDocument();
  });

  it("the Home's Focus card opens it, with no progress line (nothing is in progress)", async () => {
    render(<MemoryRouter><FocusCard /></MemoryRouter>);
    const card = await screen.findByTestId("focus-waiting");
    expect(card).toHaveTextContent("Analysis stopped");
    expect(within(card).queryByTestId("report-segments")).toBeNull();
    expect(within(card).getByRole("link", { name: "Open the observation" })).toHaveAttribute("href", "/portal/coach/observation/cs-1");
  });
});

describe("its observation page", () => {
  const renderPage = (principal = false) => {
    const page = <CoachObservation />;
    return render(
      <MemoryRouter initialEntries={["/o/cs-1"]}>
        <Routes>
          <Route path="/o/:id" element={principal ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{page}</ObserveRoutesProvider> : page} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("coach: 'Analysis stopped', one plain line, Upload recording → Schedule an observation with that teacher; no empty AI score", async () => {
    C.getObservation.mockResolvedValue(OBS());
    L.getObservation.mockResolvedValue(VIEW());
    renderPage();
    const card = await screen.findByTestId("stage-stopped");
    expect(card).toHaveTextContent("Analysis stopped");
    expect(card).toHaveTextContent("The Digital Coach could not analyse this lesson. Upload the recording again.");
    expect(within(card).getByRole("link", { name: "Upload recording" })).toHaveAttribute("href", NEW_VISIT_AGAIN);
    expect(screen.queryByText("AI score")).toBeNull();
    expect(screen.queryByTestId("score-card")).toBeNull();
  });

  it("principal: Upload recording opens that teacher's page (her Record / Upload)", async () => {
    C.getObservation.mockResolvedValue(OBS());
    L.getObservation.mockResolvedValue(VIEW());
    renderPage(true);
    const card = await screen.findByTestId("stage-stopped");
    expect(within(card).getByRole("link", { name: "Upload recording" }).getAttribute("href")).toMatch(/929998100001$/);
  });

  it("in Urdu", async () => {
    await urdu();
    C.getObservation.mockResolvedValue(OBS());
    L.getObservation.mockResolvedValue(VIEW());
    renderPage();
    const card = await screen.findByTestId("stage-stopped");
    expect(card).toHaveTextContent("تجزیہ رک گیا");
    expect(within(card).getByRole("link", { name: "ریکارڈنگ اپ لوڈ کریں" })).toHaveAttribute("href", NEW_VISIT_AGAIN);
  });

  it("a visit she cancelled keeps 'Observation stopped', with no Upload recording", async () => {
    C.getObservation.mockResolvedValue(OBS({ cancelled: true }));
    L.getObservation.mockResolvedValue(VIEW({ sessionStatus: "cancelled" }));
    renderPage();
    const card = await screen.findByTestId("stage-stopped");
    expect(card).toHaveTextContent("Observation stopped");
    expect(within(card).queryByRole("link", { name: "Upload recording" })).toBeNull();
  });
});

describe("the visit page (her schedule entry)", () => {
  const renderVisit = () => render(
    <MemoryRouter initialEntries={["/portal/coach/visit/v1"]}>
      <Routes><Route path="/portal/coach/visit/:id" element={<CoachVisit />} /></Routes>
    </MemoryRouter>,
  );

  it("its analysis stopped: 'Analysis stopped' and Upload recording, never 'Done'; its observation still opens", async () => {
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: null, visit: { ...VISIT, sessionStep: "stopped" } });
    renderVisit();
    const card = await screen.findByTestId("visit-analysis-stopped");
    expect(card).toHaveTextContent("Analysis stopped");
    expect(card).toHaveTextContent("The Digital Coach could not analyse this lesson. Upload the recording again.");
    expect(within(card).getByRole("link", { name: "Upload recording" })).toHaveAttribute("href", NEW_VISIT_AGAIN);
    const teacherCard = screen.getByTestId("teacher-card");
    expect(teacherCard).toHaveTextContent("Analysis stopped");
    expect(teacherCard).not.toHaveTextContent("Done");
    expect(screen.getByTestId("visit-open-observation")).toHaveAttribute("href", "/portal/coach/observation/cs-1");
  });

  it("in Urdu", async () => {
    await urdu();
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: null, visit: { ...VISIT, sessionStep: "stopped" } });
    renderVisit();
    const card = await screen.findByTestId("visit-analysis-stopped");
    expect(card).toHaveTextContent("تجزیہ رک گیا");
  });

  it("a done visit whose observation is going well still says Done", async () => {
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: null, visit: { ...VISIT, sessionStep: "draft" } });
    renderVisit();
    await screen.findByTestId("visit-open-observation");
    expect(screen.queryByTestId("visit-analysis-stopped")).toBeNull();
    expect(screen.getByTestId("teacher-card")).toHaveTextContent("Done");
  });

  it("off the switch: unchanged", async () => {
    flow.on = false;
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: null, visit: { ...VISIT, sessionStep: "stopped" } });
    renderVisit();
    await screen.findByTestId("teacher-card");
    expect(screen.queryByTestId("visit-analysis-stopped")).toBeNull();
    expect(screen.getByTestId("teacher-card")).toHaveTextContent("Done");
  });
});
